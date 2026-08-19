// @ts-nocheck
import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import { CameraRigSystem } from './CameraRigSystem.js';
import { renderShortsFallbackFromSource } from './RecordingCaptureFallbackOps.js';
import { drawHudOverlay, drawLetterboxOverlay, storeCaptureMeta } from './RecordingCaptureOverlayOps.js';
import { RecordingOrbitCameraDirector, SLOT_STYLE } from './camera/RecordingOrbitCameraDirector.js';
import { createDefaultRecordingCaptureSettings, RECORDING_CINEMATIC_QUALITY_PROFILE, normalizeRecordingCaptureSettings, RECORDING_CAPTURE_PROFILE, RECORDING_HUD_MODE } from '../../shared/contracts/RecordingCaptureContract.js';
import { cloneJsonValue } from '../../shared/utils/JsonClone.js';
import { CAMERA_PERSPECTIVE_MODE, createDefaultCameraPerspectiveSettings, normalizeCameraPerspectiveSettings } from '../../shared/contracts/CameraPerspectiveContract.js';
import { resolveBloomQualityPreset } from '../../shared/contracts/BloomQualityContract.js';
import { applyProjectionQuaternion, applyProjectionVector3, CinematicCaptureSubjectSelector, createCanvasClone, toPositiveEven, toRatio } from './RecordingCaptureProjectionOps.js';
import { createCaptureCameraContext, resetCapturePerspectiveState, setCaptureCameraFrameTiming, syncCinematicCaptureSubject, updateCaptureCameraContext, updateShortsCaptureCamera } from './RecordingCaptureCameraUpdateOps.js';
import { VIEWPORT_LAYOUTS, normalizeViewportLayout } from '../../shared/contracts/ViewportLayoutContract.js';
import { buildStandardCaptureSegments } from './RecordingCaptureLayoutOps.js';
import { ScenePostProcessingPipeline } from './ScenePostProcessingPipeline.js';

const SHORTS_OUTPUT_ASPECT = Object.freeze({ width: 9, height: 16 });

export class RecordingCapturePipeline {
    constructor({
        sourceCanvas,
        sourceRenderer,
        scene,
    }) {
        this.sourceCanvas = sourceCanvas || null;
        this.sourceRenderer = sourceRenderer || null;
        this.scene = scene || null;

        this._active = false;
        this._settings = createDefaultRecordingCaptureSettings();
        this._bloomPreset = resolveBloomQualityPreset();
        this._cameraPerspectiveSettings = createDefaultCameraPerspectiveSettings();
        this._captureCanvas = null;
        this._captureCtx = null;
        this._shortsCanvas = null;
        this._shortsRenderer = null;
        this._shortsRendererUnavailable = false;
        this._shortsCameraRig = new CameraRigSystem({
            cinematicEnabled: true,
            livePerspectiveEnabled: false,
        });
        this._orbitDirector = new RecordingOrbitCameraDirector();
        // Dedicated cinematic renderer state for high-quality capture.
        this._cinematicCanvas = null;
        this._cinematicRenderer = null;
        this._cinematicPostProcessingPipeline = null;
        this._cinematicRendererUnavailable = false;
        this._cinematicBaseFov = Math.max(1, Number(CONFIG?.CAMERA?.FOV) || 60);
        this._cinematicSubjectSelector = new CinematicCaptureSubjectSelector();
        this._cinematicCameraRig = new CameraRigSystem({
            cinematicEnabled: true,
            livePerspectiveEnabled: false,
        });
        this._cinematicOrbitDirector = new RecordingOrbitCameraDirector();
        this._tmpPosition = new THREE.Vector3();
        this._tmpQuaternion = new THREE.Quaternion();
        this._tmpDirection = new THREE.Vector3();
        this._tmpColor = new THREE.Color();
        this._tmpOtherPosition = new THREE.Vector3();
        this._tmpCameraPosition = new THREE.Vector3();
        this._tmpCameraQuaternion = new THREE.Quaternion();
        this._captureFrameTiming = { rawDt: 1 / 60, dt: 1 / 60 };
        this._shortsCameraContexts = [];
        this._cinematicCameraContext = createCaptureCameraContext();
        this._shortsOrbitPoseReady = [];
        this._cinematicOrbitPoseReady = false;
        this._cinematicSubjectPlayerIndex = null;
        this._lastMeta = null;
    }

    setActive(active) {
        const next = !!active;
        if (next === this._active) return;
        this._active = next;
        if (!next) {
            // Retry shorts-renderer creation on the next recording session.
            this._shortsRendererUnavailable = false;
            this._cinematicRendererUnavailable = false;
        }
        this._orbitDirector.reset();
        this._shortsCameraRig.resetCameras();
        this._cinematicOrbitDirector.reset();
        this._cinematicCameraRig.resetCameras();
        this._cinematicSubjectSelector.reset();
        this._shortsOrbitPoseReady.length = 0;
        this._cinematicOrbitPoseReady = false;
        this._cinematicSubjectPlayerIndex = null;
    }

    setSettings(settings = null) {
        this._settings = normalizeRecordingCaptureSettings(settings, this._settings);
        return { ...this._settings };
    }

    setCameraPerspectiveSettings(settings = null) {
        const previous = this._cameraPerspectiveSettings;
        const next = normalizeCameraPerspectiveSettings(
            settings,
            previous
        );
        resetCapturePerspectiveState(this, previous, next);
        this._cameraPerspectiveSettings = next;
        return { ...this._cameraPerspectiveSettings };
    }

    getCameraPerspectiveSettings() {
        return { ...this._cameraPerspectiveSettings };
    }

    getSettings() {
        return { ...this._settings };
    }

    getLastMeta() {
        if (!this._lastMeta) return null;
        return cloneJsonValue(this._lastMeta);
    }

    _resolveProjectedPlayers(renderProjection) {
        const players = Array.isArray(renderProjection?.players)
            ? renderProjection.players.filter(Boolean)
            : [];
        players.sort((left, right) => (left.playerIndex || 0) - (right.playerIndex || 0));
        return players;
    }

    setBloomQuality(level) {
        this._bloomPreset = resolveBloomQualityPreset(level);
        this._cinematicPostProcessingPipeline?.setQualityPreset?.(this._bloomPreset);
    }

    _resolveRecordingPlayers(renderProjection) {
        const players = Array.isArray(renderProjection?.players)
            ? renderProjection.players.filter((player) => player && player.isBot !== true)
            : [];
        players.sort((left, right) => (left.playerIndex || 0) - (right.playerIndex || 0));
        return players;
    }

    _ensureCaptureCanvas(width, height) {
        const safeWidth = toPositiveEven(width, 2);
        const safeHeight = toPositiveEven(height, 2);
        if (!this._captureCanvas) {
            this._captureCanvas = createCanvasClone(this.sourceCanvas, safeWidth, safeHeight);
            this._captureCtx = this._captureCanvas?.getContext?.('2d', { alpha: false }) || null;
        }
        if (!this._captureCanvas || !this._captureCtx) {
            return null;
        }
        if (this._captureCanvas.width !== safeWidth || this._captureCanvas.height !== safeHeight) {
            this._captureCanvas.width = safeWidth;
            this._captureCanvas.height = safeHeight;
        }
        return this._captureCanvas;
    }

    _ensureShortsRenderer(width, height) {
        if (this._shortsRendererUnavailable) return null;
        const safeWidth = toPositiveEven(width, 2);
        const safeHeight = toPositiveEven(height, 2);
        if (!this._shortsCanvas) {
            this._shortsCanvas = createCanvasClone(this.sourceCanvas, safeWidth, safeHeight);
        }
        if (!this._shortsCanvas) return null;

        if (!this._shortsRenderer) {
            try {
                this._shortsRenderer = new THREE.WebGLRenderer({
                    canvas: this._shortsCanvas,
                    antialias: false,
                    alpha: false,
                    // Required for reliable WebGL -> 2D canvas capture on some runtimes.
                    // Without preserving the buffer, drawImage() may intermittently read black frames.
                    preserveDrawingBuffer: true,
                });
                this._shortsRenderer.setPixelRatio(1);
                this._shortsRenderer.shadowMap.enabled = true;
                this._shortsRenderer.shadowMap.type = THREE.BasicShadowMap;
                this._shortsRenderer.toneMapping = THREE.ACESFilmicToneMapping;
                this._shortsRenderer.toneMappingExposure = this.sourceRenderer?.toneMappingExposure || 1.2;
                this._shortsRenderer.setClearColor(CONFIG.COLORS.BACKGROUND);
            } catch {
                this._shortsRendererUnavailable = true;
                this._shortsRenderer = null;
                return null;
            }
        }

        try {
            this._shortsRenderer.shadowMap.enabled = this.sourceRenderer?.shadowMap?.enabled === true;
            this._shortsRenderer.shadowMap.type = this.sourceRenderer?.shadowMap?.type || THREE.BasicShadowMap;
            this._shortsRenderer.toneMapping = this.sourceRenderer?.toneMapping ?? THREE.ACESFilmicToneMapping;
            this._shortsRenderer.toneMappingExposure = this.sourceRenderer?.toneMappingExposure || 1.2;
            this._shortsRenderer.setClearColor(CONFIG.COLORS.BACKGROUND);
            this._shortsRenderer.setSize(safeWidth, safeHeight, false);
        } catch {
            this._shortsRendererUnavailable = true;
            this._shortsRenderer = null;
            return null;
        }
        return this._shortsRenderer;
    }

    _resolveShortsCaptureSize() {
        const baseHeight = toPositiveEven(this.sourceCanvas?.height, 2);
        const targetHeight = toPositiveEven(baseHeight * 2, 4);
        const targetWidth = toPositiveEven(
            (targetHeight * SHORTS_OUTPUT_ASPECT.width) / SHORTS_OUTPUT_ASPECT.height,
            2
        );
        return { width: targetWidth, height: targetHeight };
    }

    _renderShortsFallbackFromSource({ sizes, splitScreen = true }) {
        const captureCanvas = this._ensureCaptureCanvas(sizes.width, sizes.height);
        const captureCtx = this._captureCtx;
        const sourceCanvas = this.sourceCanvas;
        if (!captureCanvas || !captureCtx || !sourceCanvas) return false;
        return renderShortsFallbackFromSource({
            captureCtx,
            sourceCanvas,
            sizes,
            splitScreen,
        });
    }

    _ensureShortsCameraCount(count, aspect) {
        const safeCount = Math.max(1, Math.trunc(count));
        const safeAspect = toRatio(aspect, 1);
        while (this._shortsCameraRig.cameras.length < safeCount) {
            this._shortsCameraRig.createCamera(safeAspect);
        }
        for (let i = 0; i < safeCount; i += 1) {
            const camera = this._shortsCameraRig.cameras[i];
            if (!camera) continue;
            camera.aspect = safeAspect;
            camera.updateProjectionMatrix();
            this._shortsCameraRig.cameraModes[i] = 0;
        }
        this._shortsCameraRig.setCinematicEnabled(true);
    }

    _resolveShortsSlotStyle() {
        const mode = /** @type {string} */ (this._cameraPerspectiveSettings?.normal || CAMERA_PERSPECTIVE_MODE.CLASSIC);
        if (mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT) {
            return SLOT_STYLE.CINEMATIC;
        }
        if (mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION) {
            return SLOT_STYLE.ACTION;
        }
        return null;
    }

    _resolveShortsDt(renderDelta) {
        const mode = /** @type {string} */ (this._cameraPerspectiveSettings?.normal || CAMERA_PERSPECTIVE_MODE.CLASSIC);
        const reduceMotion = this._cameraPerspectiveSettings?.reduceMotion === true;
        const baseScale = mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION
            ? 0.96
            : (mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT ? 0.78 : 0.86);
        const scaled = reduceMotion ? (baseScale * 0.72) : baseScale;
        return Math.max(0, Number(renderDelta) || 0) * scaled;
    }

    _updateShortsCamera({ slotIndex, player, otherPlayer, renderDelta, arena }) {
        return updateShortsCaptureCamera(this, {
            slotIndex,
            player,
            otherPlayer,
            renderDelta,
            arena,
        });
    }

    _storeMeta(baseMeta, segments) {
        this._lastMeta = storeCaptureMeta(baseMeta, segments);
    }

    _prepareStandardSurface({ renderProjection, viewportLayout }) {
        const targetCanvas = this._ensureCaptureCanvas(this.sourceCanvas?.width, this.sourceCanvas?.height);
        const ctx = this._captureCtx;
        if (!targetCanvas || !ctx || !this.sourceCanvas) return;

        const width = targetCanvas.width;
        const height = targetCanvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(this.sourceCanvas, 0, 0, width, height);

        const players = this._resolveRecordingPlayers(renderProjection);
        if (players.length === 0) {
            this._storeMeta({
                profile: RECORDING_CAPTURE_PROFILE.STANDARD,
                hudMode: this._settings.hudMode,
                overlay: /** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD ? 'hud' : 'clean',
                layout: 'single',
                width,
                height,
            }, []);
            return;
        }

        const segments = buildStandardCaptureSegments({
            players,
            viewportLayout,
            width,
            height,
            localPlayerIndex: renderProjection?.localPlayerIndex,
        });

        if (/** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD) {
            drawHudOverlay({
                ctx,
                width,
                height,
                segments,
                tmpColor: this._tmpColor,
            });
        }

        this._storeMeta({
            profile: RECORDING_CAPTURE_PROFILE.STANDARD,
            hudMode: this._settings.hudMode,
            overlay: /** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD ? 'hud' : 'clean',
            layout: viewportLayout,
            width,
            height,
        }, segments);
    }

    _renderShortsToCapture({ sizes, topCamera, bottomCamera }) {
        const shortsRenderer = this._ensureShortsRenderer(sizes.width, sizes.height);
        const captureCanvas = this._ensureCaptureCanvas(sizes.width, sizes.height);
        const captureCtx = this._captureCtx;
        if (!shortsRenderer || !captureCanvas || !captureCtx || !this.scene) return false;

        const halfHeight = Math.floor(sizes.height / 2);
        shortsRenderer.setScissorTest(true);
        shortsRenderer.setViewport(0, halfHeight, sizes.width, halfHeight);
        shortsRenderer.setScissor(0, halfHeight, sizes.width, halfHeight);
        shortsRenderer.render(this.scene, topCamera);
        shortsRenderer.setViewport(0, 0, sizes.width, halfHeight);
        shortsRenderer.setScissor(0, 0, sizes.width, halfHeight);
        shortsRenderer.render(this.scene, bottomCamera);
        shortsRenderer.setScissorTest(false);
        shortsRenderer.getContext()?.flush?.();

        captureCtx.clearRect(0, 0, sizes.width, sizes.height);
        captureCtx.drawImage(this._shortsCanvas, 0, 0, sizes.width, sizes.height);
        return true;
    }

    _prepareShortsSurface({ renderProjection, renderDelta, splitScreen, arena = null }) {
        const sizes = this._resolveShortsCaptureSize();
        const halfHeight = Math.floor(sizes.height / 2);
        const viewAspect = toRatio(sizes.width / Math.max(1, halfHeight), 1);
        const players = this._resolveRecordingPlayers(renderProjection);

        if (players.length === 0) {
            // No human players — render scene with a static fallback camera
            // so the capture canvas is not left black.
            this._ensureShortsCameraCount(1, viewAspect);
            const fallbackCamera = this._shortsCameraRig.cameras[0];
            if (fallbackCamera) {
                const rendered = this._renderShortsToCapture({
                    sizes,
                    topCamera: fallbackCamera,
                    bottomCamera: fallbackCamera,
                });
                if (!rendered) {
                    this._renderShortsFallbackFromSource({ sizes, splitScreen: splitScreen !== false });
                }
            } else {
                this._renderShortsFallbackFromSource({ sizes, splitScreen: splitScreen !== false });
            }
            this._storeMeta({
                profile: RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT,
                hudMode: this._settings.hudMode,
                overlay: /** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD ? 'hud' : 'clean',
                layout: 'shorts_vertical_split',
                width: sizes.width,
                height: sizes.height,
            }, []);
            return;
        }

        const player1 = players.find((entry) => entry.playerIndex === 0) || players[0];
        const player2 = players.find((entry) => entry.playerIndex === 1) || players[1] || player1;
        this._ensureShortsCameraCount(2, viewAspect);
        this._updateShortsCamera({
            slotIndex: 0,
            player: player1,
            otherPlayer: player2 !== player1 ? player2 : null,
            renderDelta,
            arena,
        });
        this._updateShortsCamera({
            slotIndex: 1,
            player: player2,
            otherPlayer: player2 !== player1 ? player1 : null,
            renderDelta,
            arena,
        });

        const cameras = this._shortsCameraRig.cameras;
        const topCamera = cameras[0] || cameras[1];
        const bottomCamera = cameras[1] || cameras[0];
        if (!topCamera || !bottomCamera) return;

        if (!this._renderShortsToCapture({ sizes, topCamera, bottomCamera })) {
            this._renderShortsFallbackFromSource({
                sizes,
                splitScreen: splitScreen !== false && players.length > 1,
            });
        }

        const segments = [
            { x: 0, y: 0, width: sizes.width, height: halfHeight, player: player1, label: 'P1 oben', slotIndex: 0 },
            { x: 0, y: halfHeight, width: sizes.width, height: halfHeight, player: player2, label: 'P2 unten', slotIndex: 1 },
        ];
        if (/** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD) {
            drawHudOverlay({
                ctx: this._captureCtx,
                width: sizes.width,
                height: sizes.height,
                segments,
                tmpColor: this._tmpColor,
            });
        }
        // Letterbox bars are drawn on every shot transition, regardless of HUD mode.
        drawLetterboxOverlay({
            ctx: this._captureCtx,
            segments,
            resolveLetterboxProgress: (slotIndex) => this._orbitDirector.getLetterboxProgress(slotIndex),
        });

        this._storeMeta({
            profile: RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT,
            hudMode: this._settings.hudMode,
            overlay: /** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD ? 'hud' : 'clean',
            layout: 'shorts_vertical_split',
            width: sizes.width,
            height: sizes.height,
        }, [
            { ...segments[0], label: 'top' },
            { ...segments[1], label: 'bottom' },
        ]);
    }

    getCaptureCanvas() {
        if (/** @type {string} */ (this._settings.profile) === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT) {
            const sizes = this._resolveShortsCaptureSize();
            return this._ensureCaptureCanvas(sizes.width, sizes.height) || this.sourceCanvas;
        }
        if (/** @type {string} */ (this._settings.profile) === RECORDING_CAPTURE_PROFILE.CINEMATIC) {
            const sizes = this._resolveCinematicCaptureSize();
            return this._ensureCaptureCanvas(sizes.width, sizes.height) || this.sourceCanvas;
        }
        // Always use a dedicated 2D capture canvas during recording so that
        // content is preserved regardless of the WebGL preserveDrawingBuffer flag.
        return this._ensureCaptureCanvas(this.sourceCanvas?.width, this.sourceCanvas?.height) || this.sourceCanvas;
    }

    prepareFrame({
        recordingActive = false,
        renderProjection = null,
        arena = null,
        renderDelta = 1 / 60,
        splitScreen = false,
        viewportLayout = null,
    } = {}) {
        if (!recordingActive) return;
        if (!this._active) {
            this.setActive(true);
        }
        const resolvedViewportLayout = normalizeViewportLayout(
            viewportLayout,
            splitScreen ? VIEWPORT_LAYOUTS.TWO_COLUMNS : VIEWPORT_LAYOUTS.SINGLE
        );
        if (resolvedViewportLayout === VIEWPORT_LAYOUTS.FOUR_GRID) {
            this._prepareStandardSurface({
                renderProjection,
                viewportLayout: resolvedViewportLayout,
            });
            return;
        }
        if (/** @type {string} */ (this._settings.profile) === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT) {
            this._prepareShortsSurface({ renderProjection, renderDelta, splitScreen, arena });
            return;
        }
        if (/** @type {string} */ (this._settings.profile) === RECORDING_CAPTURE_PROFILE.CINEMATIC) {
            this._prepareCinematicSurface({ renderProjection, renderDelta, arena });
            return;
        }
        // Always copy the WebGL source canvas to a preserved 2D capture canvas.
        // Without this, preserveDrawingBuffer:false on the main renderer can
        // cause black frames on some browsers/drivers (notably Windows + ANGLE).
        this._prepareStandardSurface({ renderProjection, viewportLayout: resolvedViewportLayout });
    }


    _ensureCinematicRenderer(width, height) {
        if (this._cinematicRendererUnavailable) {
            // A single transient WebGL failure must only skip one frame. The
            // next frame gets a clean creation attempt instead of disabling
            // cinematic capture for the rest of the application session.
            this._cinematicRendererUnavailable = false;
            return null;
        }
        const safeWidth = toPositiveEven(width, 2);
        const safeHeight = toPositiveEven(height, 2);
        if (!this._cinematicCanvas) {
            this._cinematicCanvas = createCanvasClone(this.sourceCanvas, safeWidth, safeHeight);
        }
        if (!this._cinematicCanvas) return null;
        if (!this._cinematicRenderer) {
            try {
                this._cinematicRenderer = new THREE.WebGLRenderer({
                    canvas: this._cinematicCanvas,
                    antialias: true,
                    alpha: false,
                    preserveDrawingBuffer: true,
                });
                this._cinematicRenderer.setPixelRatio(1);
                this._cinematicRenderer.shadowMap.enabled = true;
                this._cinematicRenderer.shadowMap.type = THREE.BasicShadowMap;
                this._cinematicRenderer.toneMapping = THREE.ACESFilmicToneMapping;
                this._cinematicRenderer.toneMappingExposure = this.sourceRenderer?.toneMappingExposure || 1.2;
                this._cinematicRenderer.setClearColor(CONFIG.COLORS.BACKGROUND);
                this._cinematicPostProcessingPipeline = new ScenePostProcessingPipeline(
                    this._cinematicRenderer,
                    { width: safeWidth, height: safeHeight }
                );
                this._cinematicPostProcessingPipeline.setQualityPreset(this._bloomPreset);
            } catch {
                this._cinematicRendererUnavailable = true;
                this._cinematicRenderer = null;
                this._cinematicCanvas = null;
                return null;
            }
        }
        try {
            this._cinematicRenderer.shadowMap.enabled = this.sourceRenderer?.shadowMap?.enabled === true;
            this._cinematicRenderer.shadowMap.type = this.sourceRenderer?.shadowMap?.type || THREE.BasicShadowMap;
            this._cinematicRenderer.toneMapping = this.sourceRenderer?.toneMapping ?? THREE.ACESFilmicToneMapping;
            this._cinematicRenderer.toneMappingExposure = this.sourceRenderer?.toneMappingExposure || 1.2;
            this._cinematicRenderer.setClearColor(CONFIG.COLORS.BACKGROUND);
            this._cinematicRenderer.setSize(safeWidth, safeHeight, false);
            this._cinematicPostProcessingPipeline?.setSize?.(safeWidth, safeHeight);
        } catch {
            try {
                this._cinematicRenderer?.dispose?.();
            } catch {
                // The failed context is discarded below.
            }
            this._cinematicRendererUnavailable = true;
            this._cinematicPostProcessingPipeline?.dispose?.();
            this._cinematicPostProcessingPipeline = null;
            this._cinematicRenderer = null;
            this._cinematicCanvas = null;
            return null;
        }
        return this._cinematicRenderer;
    }

    _resolveCinematicCaptureSize() {
        const maxW = toPositiveEven(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxWidth, 1920);
        const maxH = toPositiveEven(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxHeight, 1080);
        return {
            width: maxW,
            height: maxH,
        };
    }

    _prepareCinematicSurface({ renderProjection, renderDelta, arena = null }) {
        // Cap to 1920×1080 to stay within AVC Level 4.2 limits and ensure even dimensions.
        const { width, height } = this._resolveCinematicCaptureSize();
        const cinRenderer = this._ensureCinematicRenderer(width, height);
        const captureCanvas = this._ensureCaptureCanvas(width, height);
        const captureCtx = this._captureCtx;
        if (!cinRenderer || !captureCanvas || !captureCtx || !this.scene) {
            if (captureCanvas && captureCtx && this.sourceCanvas) {
                captureCtx.clearRect(0, 0, width, height);
                captureCtx.drawImage(this.sourceCanvas, 0, 0, width, height);
            }
            return;
        }

        const players = this._resolveProjectedPlayers(renderProjection);
        const humanPlayers = players.filter((candidate) => candidate?.isBot !== true);
        const recordedCamera = renderProjection?.recordedCamera || null;
        const perspectiveMode = /** @type {string} */ (
            this._cameraPerspectiveSettings?.normal || CAMERA_PERSPECTIVE_MODE.CLASSIC
        );
        const usesRecordedCamera = perspectiveMode === CAMERA_PERSPECTIVE_MODE.CLASSIC
            && recordedCamera?.position
            && recordedCamera?.quaternion;
        let aliveCount = 0;
        for (let index = 0; index < players.length; index++) {
            if (players[index]?.alive !== false) aliveCount++;
        }
        let player = this._cinematicSubjectSelector.select(players, aliveCount, renderDelta);
        const otherPlayer = this._cinematicSubjectSelector.findNearest(players, player, aliveCount);

        const aspect = toRatio(width / Math.max(1, height), 16 / 9);
        while (this._cinematicCameraRig.cameras.length < 1) {
            this._cinematicCameraRig.createCamera(aspect);
        }
        const camera = this._cinematicCameraRig.cameras[0];
        if (!camera) return;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        this._cinematicCameraRig.cameraModes[0] = 0;

        if (usesRecordedCamera) {
            this._cinematicOrbitPoseReady = false;
            this._cinematicSubjectPlayerIndex = null;
            applyProjectionVector3(camera.position, recordedCamera.position);
            applyProjectionQuaternion(camera.quaternion, recordedCamera.quaternion);
            camera.fov = Math.max(1, Number(recordedCamera.fov) || this._cinematicBaseFov);
            camera.near = Math.max(0.001, Number(recordedCamera.near) || camera.near);
            camera.far = Math.max(camera.near + 1, Number(recordedCamera.far) || camera.far);
            camera.zoom = Math.max(0.01, Number(recordedCamera.zoom) || 1);
            camera.updateProjectionMatrix();
            player = humanPlayers.find(
                (candidate) => Number(candidate?.playerIndex) === Number(recordedCamera.index)
            ) || humanPlayers[0] || players[0] || null;
        } else if (player) {
            const directorPlayerIndex = syncCinematicCaptureSubject(this, player);
            applyProjectionVector3(this._tmpPosition, player?.position);
            applyProjectionQuaternion(this._tmpQuaternion, player?.quaternion);
            applyProjectionVector3(this._tmpDirection, player?.direction, 0, 0, -1);
            if (this._tmpDirection.lengthSq() <= 0.000001) {
                this._tmpDirection.set(0, 0, -1);
            } else {
                this._tmpDirection.normalize();
            }

            const preserveOrbitPose = this._cinematicOrbitPoseReady === true;
            let preservedFov = camera.fov;
            if (preserveOrbitPose) {
                this._tmpCameraPosition.copy(camera.position);
                this._tmpCameraQuaternion.copy(camera.quaternion);
                preservedFov = camera.fov;
            }
            updateCaptureCameraContext(this._cinematicCameraContext, player);
            setCaptureCameraFrameTiming(this, this._cinematicCameraRig, renderDelta);
            this._cinematicCameraRig.updateCamera(
                0,
                this._tmpPosition,
                this._tmpDirection,
                renderDelta,
                this._tmpQuaternion,
                false,
                player?.isBoosting === true,
                arena,
                null,
                this._cinematicCameraContext
            );
            if (preserveOrbitPose) {
                camera.position.copy(this._tmpCameraPosition);
                camera.quaternion.copy(this._tmpCameraQuaternion);
                if (Math.abs(camera.fov - preservedFov) > 0.01) {
                    camera.fov = preservedFov;
                    camera.updateProjectionMatrix();
                }
            }

            let otherPos = null;
            if (otherPlayer?.position) {
                otherPos = applyProjectionVector3(this._tmpOtherPosition, otherPlayer.position);
            }

            const slotStyle = perspectiveMode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION
                ? SLOT_STYLE.ACTION
                : SLOT_STYLE.CINEMATIC;
            const perspectiveDt = this._resolveShortsDt(renderDelta);
            this._cinematicOrbitDirector.apply({
                playerIndex: directorPlayerIndex,
                camera,
                fallbackTarget: this._cinematicCameraRig.cameraTargets[0],
                playerPosition: this._tmpPosition,
                playerDirection: this._tmpDirection,
                dt: perspectiveDt,
                arena,
                slotStyle,
                playerState: this._cameraPerspectiveSettings?.reduceMotion === true ? null : this._cinematicCameraContext.playerState,
                otherPlayerPosition: this._cameraPerspectiveSettings?.reduceMotion === true
                    ? null
                    : otherPos,
                discontinuityVersion: this._cinematicCameraContext.discontinuityVersion,
                baseFov: this._cinematicBaseFov,
                dynamicFovEnabled: this._cameraPerspectiveSettings?.reduceMotion !== true
                    && this._cameraPerspectiveSettings?.speedFovEnabled !== false,
                dynamicFovIntensity: Math.max(
                    0,
                    Number(this._cameraPerspectiveSettings?.speedFovIntensity) || 0
                ),
            });
            this._cinematicOrbitPoseReady = true;
        }

        if (!this._cinematicPostProcessingPipeline?.render?.(this.scene, camera)) {
            cinRenderer.render(this.scene, camera);
        }
        cinRenderer.getContext()?.flush?.();

        captureCtx.clearRect(0, 0, width, height);
        captureCtx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in captureCtx) {
            captureCtx.imageSmoothingQuality = 'high';
        }
        captureCtx.drawImage(this._cinematicCanvas, 0, 0, width, height);

        const hudEnabled = /** @type {string} */ (this._settings.hudMode) === RECORDING_HUD_MODE.WITH_HUD;
        const segments = player
            ? [{ x: 0, y: 0, width, height, player, label: 'CINEMATIC', slotIndex: Number(player?.playerIndex) || 0 }]
            : [];
        if (hudEnabled) {
            drawHudOverlay({
                ctx: captureCtx,
                width,
                height,
                segments,
                tmpColor: this._tmpColor,
            });
        }
        drawLetterboxOverlay({
            ctx: captureCtx,
            segments,
            resolveLetterboxProgress: (slotIndex) => this._cinematicOrbitDirector.getLetterboxProgress(slotIndex),
        });
        this._storeMeta({
            profile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
            hudMode: hudEnabled ? RECORDING_HUD_MODE.WITH_HUD : RECORDING_HUD_MODE.CLEAN,
            overlay: hudEnabled ? 'hud' : 'clean',
            layout: 'cinematic_single',
            width,
            height,
        }, segments);
    }

    dispose() {
        if (this._shortsRenderer) {
            this._shortsRenderer.dispose();
        }
        this._shortsRenderer = null;
        this._shortsRendererUnavailable = false;
        this._shortsCanvas = null;
        this._cinematicPostProcessingPipeline?.dispose?.();
        this._cinematicPostProcessingPipeline = null;
        if (this._cinematicRenderer) { this._cinematicRenderer.dispose(); }
        this._cinematicRenderer = null;
        this._cinematicRendererUnavailable = false;
        this._cinematicCanvas = null;
        this._cinematicSubjectSelector.reset();
        this._captureCanvas = null;
        this._captureCtx = null;
        this._shortsCameraRig.resetCameras();
        this._orbitDirector.reset();
        this._shortsOrbitPoseReady.length = 0;
        this._cinematicCameraRig.resetCameras();
        this._cinematicOrbitDirector.reset();
        this._cinematicOrbitPoseReady = false;
        this._cinematicSubjectPlayerIndex = null;
        this._lastMeta = null;
    }
}
