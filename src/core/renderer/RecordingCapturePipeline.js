// @ts-nocheck
/* eslint-disable max-lines */
import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import { CameraRigSystem } from './CameraRigSystem.js';
import { renderShortsFallbackFromSource } from './RecordingCaptureFallbackOps.js';
import { drawHudOverlay, drawLetterboxOverlay, storeCaptureMeta } from './RecordingCaptureOverlayOps.js';
import { RecordingOrbitCameraDirector, SLOT_STYLE } from './camera/RecordingOrbitCameraDirector.js';
import {
    createDefaultRecordingCaptureSettings,
    RECORDING_CINEMATIC_QUALITY_PROFILE,
    normalizeRecordingCaptureSettings,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_HUD_MODE,
} from '../../shared/contracts/RecordingCaptureContract.js';
import { cloneJsonValue } from '../../shared/utils/JsonClone.js';
import {
    CAMERA_PERSPECTIVE_MODE,
    createDefaultCameraPerspectiveSettings,
    normalizeCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';

const SHORTS_OUTPUT_ASPECT = Object.freeze({
    width: 9,
    height: 16,
});

function toPositiveEven(value, fallback) {
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) && numeric >= 2 ? Math.floor(numeric) : fallback;
    return Math.max(2, safe - (safe % 2));
}

function toPositiveFloor(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function toRatio(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function applyProjectionVector3(target, source, fallbackX = 0, fallbackY = 0, fallbackZ = 0) {
    if (!target) return null;
    const x = Number(source?.x);
    const y = Number(source?.y);
    const z = Number(source?.z);
    target.set(
        Number.isFinite(x) ? x : fallbackX,
        Number.isFinite(y) ? y : fallbackY,
        Number.isFinite(z) ? z : fallbackZ
    );
    return target;
}

function applyProjectionQuaternion(target, source) {
    if (!target) return null;
    const x = Number(source?.x);
    const y = Number(source?.y);
    const z = Number(source?.z);
    const w = Number(source?.w);
    target.set(
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0,
        Number.isFinite(z) ? z : 0,
        Number.isFinite(w) ? w : 1
    );
    return target;
}

function createCanvasClone(sourceCanvas, width, height) {
    let canvasClone = null;
    if (sourceCanvas && typeof sourceCanvas.cloneNode === 'function') {
        canvasClone = sourceCanvas.cloneNode(false);
    } else if (typeof OffscreenCanvas === 'function') {
        canvasClone = new OffscreenCanvas(Math.max(2, Math.floor(width)), Math.max(2, Math.floor(height)));
    }
    if (!canvasClone) return null;
    canvasClone.width = Math.max(2, Math.floor(width));
    canvasClone.height = Math.max(2, Math.floor(height));
    return canvasClone;
}

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
        this._cinematicRendererUnavailable = false;
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
        this._lastMeta = null;
    }

    setActive(active) {
        const next = !!active;
        if (next === this._active) return;
        this._active = next;
        if (!next) {
            // Retry shorts-renderer creation on the next recording session.
            this._shortsRendererUnavailable = false;
        }
        this._orbitDirector.reset();
        this._shortsCameraRig.resetCameras();
        this._cinematicOrbitDirector.reset();
        this._cinematicCameraRig.resetCameras();
    }

    setSettings(settings = null) {
        this._settings = normalizeRecordingCaptureSettings(settings, this._settings);
        return { ...this._settings };
    }

    setCameraPerspectiveSettings(settings = null) {
        this._cameraPerspectiveSettings = normalizeCameraPerspectiveSettings(
            settings,
            this._cameraPerspectiveSettings
        );
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
        if (!player) return false;
        this._shortsCameraRig.cameraModes[slotIndex] = 0;
        const slotStyle = this._resolveShortsSlotStyle();
        const useRecordingOrbit = typeof slotStyle === 'string' && slotStyle.length > 0;
        applyProjectionVector3(this._tmpPosition, player?.position);
        applyProjectionQuaternion(this._tmpQuaternion, player?.quaternion);
        applyProjectionVector3(this._tmpDirection, player?.direction, 0, 0, -1);
        if (this._tmpDirection.lengthSq() <= 0.000001) {
            this._tmpDirection.set(0, 0, -1);
        } else {
            this._tmpDirection.normalize();
        }
        this._shortsCameraRig.updateCamera(
            slotIndex,
            this._tmpPosition,
            this._tmpDirection,
            renderDelta,
            this._tmpQuaternion,
            false,
            player?.isBoosting === true,
            arena,
            null
        );

        // Resolve other player's position for duel-focus detection.
        let otherPos = null;
        if (otherPlayer?.position) {
            otherPos = applyProjectionVector3(this._tmpOtherPosition, otherPlayer.position);
        }

        const camera = this._shortsCameraRig.cameras[slotIndex];
        if (!camera) return false;
        if (!useRecordingOrbit) {
            return true;
        }
        const baseFov = camera.fov || CONFIG.CAMERA.FOV;
        const perspectiveDt = this._resolveShortsDt(renderDelta);
        this._orbitDirector.apply({
            playerIndex: slotIndex,
            camera,
            fallbackTarget: this._shortsCameraRig.cameraTargets[slotIndex],
            playerPosition: this._tmpPosition,
            playerDirection: this._tmpDirection,
            dt: perspectiveDt,
            arena,
            slotStyle,
            playerState: {
                hp: Number(player?.hp) || 0,
                maxHp: Number(player?.maxHp) || 1,
                score: Number(player?.score) || 0,
                speed: Number(player?.speed) || 0,
                isBoosting: player?.isBoosting === true,
            },
            otherPlayerPosition: otherPos,
            baseFov,
        });
        return true;
    }

    _storeMeta(baseMeta, segments) {
        this._lastMeta = storeCaptureMeta(baseMeta, segments);
    }

    _prepareStandardSurface({ renderProjection, splitScreen }) {
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

        const player1 = players.find((entry) => entry.playerIndex === 0) || players[0];
        const player2 = players.find((entry) => entry.playerIndex === 1) || players[1] || null;
        const segments = [];
        if (splitScreen && player2) {
            const halfWidth = Math.floor(width * 0.5);
            segments.push({ x: 0, y: 0, width: halfWidth, height, player: player1, label: 'P1' });
            segments.push({ x: halfWidth, y: 0, width: width - halfWidth, height, player: player2, label: 'P2' });
        } else {
            segments.push({ x: 0, y: 0, width, height, player: player1, label: 'P1' });
        }

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
            layout: splitScreen && player2 ? 'split_horizontal' : 'single',
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
    } = {}) {
        if (!recordingActive) return;
        if (!this._active) {
            this.setActive(true);
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
        this._prepareStandardSurface({ renderProjection, splitScreen });
    }


    _ensureCinematicRenderer(width, height) {
        if (this._cinematicRendererUnavailable) return null;
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
            } catch {
                this._cinematicRendererUnavailable = true;
                this._cinematicRenderer = null;
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
        } catch {
            this._cinematicRendererUnavailable = true;
            this._cinematicRenderer = null;
            return null;
        }
        return this._cinematicRenderer;
    }

    _resolveCinematicCaptureSize() {
        // Use the visible viewport as baseline so cinematic export does not
        // inherit a throttled live backbuffer size.
        const sourceWidth = toPositiveFloor(this.sourceCanvas?.width, 0);
        const sourceHeight = toPositiveFloor(this.sourceCanvas?.height, 0);
        const clientWidth = toPositiveFloor(this.sourceCanvas?.clientWidth, 0);
        const clientHeight = toPositiveFloor(this.sourceCanvas?.clientHeight, 0);
        const rawWidth = toPositiveEven(Math.max(sourceWidth, clientWidth), 2);
        const rawHeight = toPositiveEven(Math.max(sourceHeight, clientHeight), 2);
        const supersampleScale = toRatio(
            RECORDING_CINEMATIC_QUALITY_PROFILE?.supersampleScale,
            1
        );
        const maxW = toPositiveEven(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxWidth, 1920);
        const maxH = toPositiveEven(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxHeight, 1080);
        const supersampledWidth = toPositiveEven(Math.floor(rawWidth * supersampleScale), 2);
        const supersampledHeight = toPositiveEven(Math.floor(rawHeight * supersampleScale), 2);
        const scale = Math.min(
            1,
            maxW / Math.max(1, supersampledWidth),
            maxH / Math.max(1, supersampledHeight)
        );
        return {
            width: toPositiveEven(Math.floor(supersampledWidth * scale), 2),
            height: toPositiveEven(Math.floor(supersampledHeight * scale), 2),
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

        const players = this._resolveRecordingPlayers(renderProjection);
        const player = players[0] || null;
        const otherPlayer = players[1] || null;

        const aspect = toRatio(width / Math.max(1, height), 16 / 9);
        while (this._cinematicCameraRig.cameras.length < 1) {
            this._cinematicCameraRig.createCamera(aspect);
        }
        const camera = this._cinematicCameraRig.cameras[0];
        if (!camera) return;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        this._cinematicCameraRig.cameraModes[0] = 0;

        if (player) {
            applyProjectionVector3(this._tmpPosition, player?.position);
            applyProjectionQuaternion(this._tmpQuaternion, player?.quaternion);
            applyProjectionVector3(this._tmpDirection, player?.direction, 0, 0, -1);
            if (this._tmpDirection.lengthSq() <= 0.000001) {
                this._tmpDirection.set(0, 0, -1);
            } else {
                this._tmpDirection.normalize();
            }

            this._cinematicCameraRig.updateCamera(
                0,
                this._tmpPosition,
                this._tmpDirection,
                renderDelta,
                this._tmpQuaternion,
                false,
                player?.isBoosting === true,
                arena,
                null
            );

            let otherPos = null;
            if (otherPlayer?.position) {
                otherPos = applyProjectionVector3(this._tmpOtherPosition, otherPlayer.position);
            }

            this._cinematicOrbitDirector.apply({
                playerIndex: 0,
                camera,
                fallbackTarget: this._cinematicCameraRig.cameraTargets[0],
                playerPosition: this._tmpPosition,
                playerDirection: this._tmpDirection,
                dt: Math.max(0, Number(renderDelta) || 0),
                arena,
                slotStyle: SLOT_STYLE.CINEMATIC,
                playerState: {
                    hp: Number(player?.hp) || 0,
                    maxHp: Number(player?.maxHp) || 1,
                    score: Number(player?.score) || 0,
                    speed: Number(player?.speed) || 0,
                    isBoosting: player?.isBoosting === true,
                },
                otherPlayerPosition: otherPos,
                baseFov: camera.fov || CONFIG.CAMERA.FOV,
            });
        }

        cinRenderer.render(this.scene, camera);
        cinRenderer.getContext()?.flush?.();

        captureCtx.clearRect(0, 0, width, height);
        captureCtx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in captureCtx) {
            captureCtx.imageSmoothingQuality = 'high';
        }
        captureCtx.drawImage(this._cinematicCanvas, 0, 0, width, height);

        this._storeMeta({
            profile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
            hudMode: RECORDING_HUD_MODE.CLEAN,
            overlay: 'clean',
            layout: 'cinematic_single',
            width,
            height,
        }, player ? [{ x: 0, y: 0, width, height, player, label: 'CINEMATIC' }] : []);
    }

    dispose() {
        if (this._shortsRenderer) {
            this._shortsRenderer.dispose();
        }
        this._shortsRenderer = null;
        this._shortsRendererUnavailable = false;
        this._shortsCanvas = null;
        if (this._cinematicRenderer) { this._cinematicRenderer.dispose(); }
        this._cinematicRenderer = null;
        this._cinematicRendererUnavailable = false;
        this._cinematicCanvas = null;
        this._captureCanvas = null;
        this._captureCtx = null;
        this._shortsCameraRig.resetCameras();
        this._orbitDirector.reset();
        this._cinematicCameraRig.resetCameras();
        this._cinematicOrbitDirector.reset();
        this._lastMeta = null;
    }
}
