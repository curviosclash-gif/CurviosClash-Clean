// ============================================
// Renderer.js - Three.js Rendering & Kameras
// ============================================

import * as THREE from 'three';
import { configurePlayerHealthAuraCamera } from '../shared/rendering/PlayerHealthAuraLayers.js';
import {
    applyAtmosphericFogLayer,
    installAtmosphericFog,
    setAtmosphericFogClipDistance,
} from './renderer/AtmosphericFogShaderPatch.js';
import { MapFogLayerDriver } from './renderer/MapFogLayerDriver.js';
import { SceneLightingRig } from './renderer/SceneLightingRig.js';
import { SceneEnvironmentController } from './renderer/SceneEnvironmentFactory.js';
import { resolveSandstormLighting } from './renderer/SandstormLightingOps.js';
import { CONFIG } from './Config.js';
import { CameraRigSystem } from './renderer/CameraRigSystem.js';
import { RenderViewportSystem } from './renderer/RenderViewportSystem.js';
import { SceneRootManager } from './renderer/SceneRootManager.js';
import { RenderQualityController } from './renderer/RenderQualityController.js';
import { RecordingCapturePipeline } from './renderer/RecordingCapturePipeline.js';
import { ScenePostProcessingPipeline } from './renderer/ScenePostProcessingPipeline.js';
import {
    GRAPHICS_STYLES,
    normalizeGraphicsStyle,
} from '../shared/contracts/GraphicsStyleContract.js';
import {
    DEFAULT_MAP_BRIGHTNESS,
    normalizeMapBrightness,
    resolveMapBrightnessFactors,
} from '../shared/contracts/MapBrightnessContract.js';
import {
    DEFAULT_VIEW_DISTANCE,
    normalizeViewDistance,
} from '../shared/contracts/ViewDistanceContract.js';
import { resolveMapLighting } from '../shared/contracts/MapLightingContract.js';
import {
    createGlobalFogEffectState,
    resolveGlobalFogMapRange,
} from '../shared/contracts/GlobalFogEffectContract.js';
import { MAP_SANDSTORM_PHASES, createMapSandstormState } from '../shared/contracts/MapSandstormContract.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        // Has to happen before the first material compiles, otherwise three caches a program built
        // from its own fog chunks and the scene keeps the flat distance-only fog.
        installAtmosphericFog();
        // The fog has to be fully closed by the time the camera stops drawing, otherwise geometry
        // vanishes while still faintly visible - a hard ring at a fixed distance.
        setAtmosphericFogClipDistance(CONFIG.CAMERA.FAR);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
        });
        this._recordingActive = false;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.RENDER.MAX_PIXEL_RATIO));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.setClearColor(CONFIG.COLORS.BACKGROUND);
        // three verifies every freshly linked program with a synchronous getProgramInfoLog and waits
        // for the driver to finish. That is a development aid; in the shipped build it only turns the
        // first frame that uses a material into a stall.
        this.renderer.debug.checkShaderErrors = Boolean(import.meta?.env?.DEV);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(CONFIG.COLORS.BACKGROUND, 50, 200);
        /** @type {'classic'|'modern'} */
        this._graphicsStyle = GRAPHICS_STYLES.MODERN;
        /** @type {string} */
        this._mapBrightness = DEFAULT_MAP_BRIGHTNESS;
        this._viewDistance = DEFAULT_VIEW_DISTANCE;
        // The map may carry its own lighting profile; undefined means the style base stands.
        this._mapLighting = undefined;
        this._mapScale = 1;
        // A map whose fog travels during the round owns the two height edges; the lighting rig
        // owns everything else about the fog. Maps without one never reach the driver at all.
        this._mapFogLayerDriver = new MapFogLayerDriver({ apply: applyAtmosphericFogLayer });
        this._globalFogEffect = createGlobalFogEffectState();
        this._globalFogVisibilityRange = 0;
        this._mapSandstormEffect = createMapSandstormState();
        this._mapSandstormRanges = { outdoorNear: 0, outdoorFar: 0, shelterNear: 0, shelterFar: 0 };
        this._mapSandstormLightingStep = 0;
        this._lightingRig = new SceneLightingRig({
            scene: this.scene,
            renderer: this.renderer,
            config: CONFIG,
        });
        this._environmentController = new SceneEnvironmentController(this.renderer, this.scene);
        this.setGraphicsStyle(this._graphicsStyle);

        this.sceneRootManager = new SceneRootManager(this.scene);
        this.persistentRoot = this.sceneRootManager.persistentRoot;
        this.matchRoot = this.sceneRootManager.matchRoot;
        this.debugRoot = this.sceneRootManager.debugRoot;

        this.cameraRigSystem = new CameraRigSystem({
            cinematicEnabled: CONFIG?.CAMERA?.CINEMATIC_ENABLED !== false,
            livePerspectiveEnabled: false,
        });
        this.cameras = this.cameraRigSystem.cameras;
        this.cameraTargets = this.cameraRigSystem.cameraTargets;
        this.cameraModes = this.cameraRigSystem.cameraModes;
        this.cameraBoostBlend = this.cameraRigSystem.cameraBoostBlend;
        this.cameraShakeTimers = this.cameraRigSystem.cameraShakeTimers;
        this.cameraShakeDurations = this.cameraRigSystem.cameraShakeDurations;
        this.cameraShakeIntensities = this.cameraRigSystem.cameraShakeIntensities;

        this.postProcessingPipeline = new ScenePostProcessingPipeline(this.renderer, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        this.viewportSystem = new RenderViewportSystem(this.renderer, {
            width: window.innerWidth,
            height: window.innerHeight,
            splitScreen: false,
            postProcessingPipeline: this.postProcessingPipeline,
            beforeCameraRender: (_scene, camera) => this._applyCameraWaterVisibility(camera),
            afterCameraRender: () => this._restoreCameraWaterVisibility(),
        });
        this._width = this.viewportSystem.width;
        this._height = this.viewportSystem.height;
        this.splitScreen = this.viewportSystem.splitScreen;
        this.viewportLayout = this.viewportSystem.layout;

        this.qualityController = new RenderQualityController(
            this.renderer,
            this.scene,
            this.postProcessingPipeline
        );
        this.recordingCapturePipeline = new RecordingCapturePipeline({
            sourceCanvas: this.canvas,
            sourceRenderer: this.renderer,
            scene: this.scene,
        });

        this._onWindowResize = () => this._onResize();
        window.addEventListener('resize', this._onWindowResize);
    }

    setGraphicsStyle(style) {
        const normalized = normalizeGraphicsStyle(style);
        this._graphicsStyle = normalized;
        this._applySceneAppearance();

        if (typeof document !== 'undefined') {
            document.documentElement.dataset.graphicsStyle = normalized;
        }
        return normalized;
    }

    getGraphicsStyle() {
        return this._graphicsStyle;
    }

    setMapBrightness(level) {
        const normalized = normalizeMapBrightness(level);
        this._mapBrightness = normalized;
        this._applySceneAppearance();
        return normalized;
    }

    getMapBrightness() {
        return this._mapBrightness;
    }

    setViewDistance(value) {
        const normalized = normalizeViewDistance(value);
        this._viewDistance = normalized;
        this._applySceneAppearance();
        return normalized;
    }

    getViewDistance() {
        return this._viewDistance;
    }

    // Called by the arena on every map build, with undefined for maps that state no profile --
    // otherwise a map without one would keep the lighting of whichever map ran before it.
    // mapScale is the factor the arena applies to everything a map authors. The fog's height terms
    // are authored in that same space, but the shader compares them against world coordinates, so
    // they have to travel with it - otherwise a map scaled by three has its fog layer sitting at a
    // third of the height it states, and everything above stays unfogged.
    setMapLighting(profile, mapScale = 1) {
        this._mapLighting = profile;
        const numericScale = Number(mapScale);
        this._mapScale = Number.isFinite(numericScale) && numericScale > 0 ? numericScale : 1;
        this._mapFogLayerDriver.setScale(this._mapScale);
        this._applySceneAppearance();
        return this._mapLighting;
    }

    /**
     * The travelling fog layer of the map being built, or null for every other map.
     * @param {unknown} layer as authored in the preset, normalized by MapFogLayerContract
     */
    setMapFogLayer(layer) {
        return this._mapFogLayerDriver.setLayer(layer);
    }

    /** Called from the map clock, so the fog cannot disagree with the rest of the round. */
    updateMapFogLayer(elapsedSeconds) {
        return this._mapFogLayerDriver.update(elapsedSeconds);
    }

    getMapLighting() {
        return this._mapLighting;
    }

    getMapScale() {
        return this._mapScale;
    }

    getLightingRig() {
        return this._lightingRig;
    }

    setGlobalFogEffect(value = null) {
        const next = createGlobalFogEffectState(value);
        const activeChanged = this._globalFogEffect.active !== next.active;
        this._globalFogEffect = next;
        if (activeChanged) this._applySceneAppearance();
        return this.getGlobalFogEffect();
    }

    getGlobalFogEffect() {
        return { ...this._globalFogEffect };
    }

    getGlobalFogVisibilityRange() {
        return this._globalFogVisibilityRange;
    }

    getBaseFogVisibilityRange() {
        return Math.max(0, Number(this.scene?.fog?.far) || 0);
    }

    setMapSandstormEffect(value = null) {
        const source = value && typeof value === 'object' ? value : {};
        const previousActive = this._mapSandstormEffect.phase === MAP_SANDSTORM_PHASES.ACTIVE;
        this._mapSandstormEffect = createMapSandstormState(source);
        this._mapSandstormRanges.outdoorNear = Math.max(0, Number(source.outdoorNear) || 0);
        this._mapSandstormRanges.outdoorFar = Math.max(0, Number(source.outdoorFar) || 0);
        this._mapSandstormRanges.shelterNear = Math.max(0, Number(source.shelterNear) || 0);
        this._mapSandstormRanges.shelterFar = Math.max(0, Number(source.shelterFar) || 0);
        const nextActive = this._mapSandstormEffect.phase === MAP_SANDSTORM_PHASES.ACTIVE;
        this._mapSandstormLightingStep = Math.round(this._mapSandstormEffect.intensity * 20);
        if (previousActive !== nextActive) this._applySceneAppearance();
        return { ...this._mapSandstormEffect };
    }

    getMapSandstormEffect() {
        return { ...this._mapSandstormEffect };
    }

    setMapSandstormIntensity(value = 0) {
        const intensity = Math.max(0, Math.min(1, Number(value) || 0));
        this._mapSandstormEffect.intensity = intensity;
        const lightingStep = Math.round(intensity * 20);
        if (
            lightingStep !== this._mapSandstormLightingStep
            && this._mapSandstormEffect.phase === MAP_SANDSTORM_PHASES.ACTIVE
        ) {
            this._mapSandstormLightingStep = lightingStep;
            this._applySceneAppearance();
        }
    }

    getEffectiveCameraFogRange(camera) {
        this._applyCameraWaterVisibility(camera);
        const result = { near: this.scene.fog.near, far: this.scene.fog.far };
        this._restoreCameraWaterVisibility();
        return result;
    }

    setCameraWaterVisibility(playerIndex, multiplier = 1) {
        const camera = this.cameras?.[playerIndex];
        if (!camera) return false;
        const numeric = Number(multiplier);
        camera.userData.waterVisibilityMultiplier = Number.isFinite(numeric)
            ? Math.min(1, Math.max(0.05, numeric))
            : 1;
        return true;
    }

    _applyCameraWaterVisibility(camera) {
        if (!this.scene?.fog) return;
        this._renderFogNear = this.scene.fog.near;
        this._renderFogFar = this.scene.fog.far;
        let near = this._renderFogNear;
        let far = this._renderFogFar;
        const stormActive = this._mapSandstormEffect?.phase === MAP_SANDSTORM_PHASES.ACTIVE;
        const stormRange = Number(camera?.userData?.sandstormVisibilityRange);
        if (stormActive && Number.isFinite(stormRange) && stormRange > 0) {
            const sheltered = stormRange > this._mapSandstormRanges.outdoorFar;
            const stormNear = sheltered
                ? this._mapSandstormRanges.shelterNear
                : this._mapSandstormRanges.outdoorNear;
            const intensity = Math.max(0, Math.min(1, Number(this._mapSandstormEffect.intensity) || 0));
            far = Math.min(far, THREE.MathUtils.lerp(far, stormRange, intensity));
            near = Math.min(near, THREE.MathUtils.lerp(near, stormNear, intensity));
        }
        const multiplier = Number(camera?.userData?.waterVisibilityMultiplier);
        if (Number.isFinite(multiplier) && multiplier < 1) {
            far = Math.max(6, far * Math.max(0.05, multiplier));
            near = Math.min(near, far * 0.18);
        }
        this.scene.fog.far = far;
        this.scene.fog.near = Math.min(near, far);
    }

    _restoreCameraWaterVisibility() {
        if (!this.scene?.fog || !Number.isFinite(this._renderFogFar)) return;
        this.scene.fog.near = this._renderFogNear;
        this.scene.fog.far = this._renderFogFar;
    }

    // Der Grafikstil liefert die Basiswerte, die Helligkeitsstufe einen Faktor darauf, und
    // eine explizit gesetzte Sichtweite ersetzt die Fog-Reichweite ganz. Nur diese eine
    // Stelle schreibt - sonst ueberschreiben sich die Quellen gegenseitig.
    // Vier Quellen treffen sich hier und nur hier: der Grafikstil liefert die Basiswerte, das
    // Kartenprofil ueberschreibt davon was es nennt, die Helligkeitsstufe ist ein Faktor darauf,
    // und eine gesetzte Sichtweite ersetzt die Fog-Reichweite ganz. Schriebe eine der Quellen
    // woanders, wuerde sie von der naechsten ueberschrieben.
    _applySceneAppearance() {
        const normalMapLighting = resolveMapLighting(this._mapLighting);
        const globalFogRange = resolveGlobalFogMapRange(normalMapLighting, CONFIG.CAMERA.FAR);
        this._globalFogVisibilityRange = globalFogRange.far;
        const sandstormActive = this._mapSandstormEffect?.phase === MAP_SANDSTORM_PHASES.ACTIVE;
        const stormBlend = sandstormActive
            ? Math.max(0, Math.min(1, Number(this._mapSandstormEffect.intensity) || 0))
            : 0;
        const stormLighting = sandstormActive
            ? resolveSandstormLighting(normalMapLighting, stormBlend)
            : normalMapLighting;
        const lighting = this._lightingRig.apply({
            graphicsStyle: this._graphicsStyle,
            mapLighting: stormLighting,
            mapScale: this._mapScale,
            brightnessFactors: resolveMapBrightnessFactors(this._mapBrightness),
            viewDistance: this._viewDistance,
            globalFogRange: this._globalFogEffect?.active === true ? globalFogRange : null,
        });
        // Authored long-range fog needs matching clipping, including after a map switch.
        this._cameraFar = Math.max(CONFIG.CAMERA.FAR, this.scene.fog.far);
        setAtmosphericFogClipDistance(this._cameraFar);
        if (this.cameras) {
            for (const camera of this.cameras) {
                if (camera.far === this._cameraFar) continue;
                camera.far = this._cameraFar;
                camera.updateProjectionMatrix();
            }
        }
        // The reflection has to follow the same lighting the rig just applied, otherwise the metal
        // in the scene keeps mirroring whatever sky the previous map had.
        this._environmentController.apply(this._graphicsStyle, lighting);
        // The rig just rewrote the static height terms. A brightness or view distance change mid
        // round would otherwise drop a travelling layer back onto its map's authored height until
        // the band next moves, which on a held stage is never.
        this._mapFogLayerDriver.refresh();
    }

    getEnvironmentKey() {
        return this._environmentController.getActiveKey();
    }

    // Called by the arena once it knows how large the map actually is, so shadows cover the whole
    // level instead of a fixed box around the origin.
    setShadowCoverage(bounds) {
        return this._lightingRig.setShadowCoverage(bounds);
    }

    getShadowCoverage() {
        return this._lightingRig.getShadowCoverage();
    }

    // The four values _applySceneAppearance writes, in one read. It exists so a caller can check
    // what the scene ended up at without reaching into whichever object currently holds the lights.
    getSceneAppearance() {
        return {
            exposure: this.renderer.toneMappingExposure,
            ambient: this._lightingRig.ambientLight.intensity,
            fogNear: this.scene.fog.near,
            fogFar: this.scene.fog.far,
        };
    }
    createCamera(index) {
        const camera = this.cameraRigSystem.createCamera(this._getAspect());
        const playerIndex = Number.isInteger(index) ? index : this.cameras.length - 1;
        configurePlayerHealthAuraCamera(camera, playerIndex);
        camera.far = this._cameraFar;
        camera.updateProjectionMatrix();
        return camera;
    }

    setSplitScreen(enabled) {
        this.viewportSystem.setSplitScreen(enabled, this.cameras);
        this.splitScreen = this.viewportSystem.splitScreen;
        this.viewportLayout = this.viewportSystem.layout;
    }

    setViewportLayout(layout) {
        this.viewportSystem.setViewportLayout(layout, this.cameras);
        this.splitScreen = this.viewportSystem.splitScreen;
        this.viewportLayout = this.viewportSystem.layout;
        return this.viewportLayout;
    }

    cycleCamera(playerIndex) {
        if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= this.cameraModes.length) {
            return;
        }
        this.cameraRigSystem.cycleCamera(playerIndex);
    }

    getCameraMode(playerIndex) {
        return this.cameraRigSystem.getCameraMode(playerIndex);
    }

    triggerCameraShake(playerIndex, intensity = 0.2, duration = 0.2) {
        this.cameraRigSystem.triggerCameraShake(playerIndex, intensity, duration);
        this.reportImpact(playerIndex, intensity, duration);
    }

    // Non-visual impact feedback (controller rumble). Also called where reduced
    // motion skips the visual shake: a comfort setting for the picture must not
    // silence the controller.
    reportImpact(playerIndex, intensity, duration) {
        this._impactListener?.(playerIndex, intensity, duration);
    }

    setImpactListener(listener) {
        this._impactListener = typeof listener === 'function' ? listener : null;
    }

    applyCameraShake(playerIndex, camera, dt, out) {
        const offset = this.cameraRigSystem.shakeSolver.resolveOffset(playerIndex, dt, out);
        if (camera && offset) camera.position.add(offset);
    }

    resolveCameraCollision(playerIndex, mode, origin, desiredPosition, arena) {
        this.cameraRigSystem.collisionSolver.resolve(playerIndex, mode, origin, desiredPosition, arena);
    }

    setCinematicEnabled(enabled) {
        this.cameraRigSystem.setCinematicEnabled(enabled);
    }

    getCinematicEnabled() {
        return this.cameraRigSystem.getCinematicEnabled();
    }

    setRecordingActive(active) {
        this._recordingActive = !!active;
        this.recordingCapturePipeline.setActive(this._recordingActive);
    }

    getRecordingActive() {
        return this._recordingActive;
    }

    setRecordingCaptureSettings(settings = null) {
        return this.recordingCapturePipeline.setSettings(settings);
    }

    getRecordingCaptureSettings() {
        return this.recordingCapturePipeline.getSettings();
    }

    setCameraPerspectiveSettings(settings = null) {
        const normalized = this.cameraRigSystem.setCameraPerspectiveSettings(settings);
        this.recordingCapturePipeline.setCameraPerspectiveSettings(normalized);
        return normalized;
    }

    getCameraPerspectiveSettings() {
        return this.cameraRigSystem.getCameraPerspectiveSettings();
    }

    getLastRecordingCaptureMeta() {
        return this.recordingCapturePipeline.getLastMeta();
    }

    getRecordingCaptureCanvas() {
        return this.recordingCapturePipeline.getCaptureCanvas();
    }

    prepareRecordingCaptureFrame(options = null) {
        this.recordingCapturePipeline.prepareFrame(options || null);
    }

    updateCamera(
        playerIndex,
        playerPosition,
        playerDirection,
        dt,
        playerQuaternion = null,
        cockpitCamera = false,
        isBoosting = false,
        arena = null,
        firstPersonAnchor = null,
        cameraContext = null
    ) {
        this.cameraRigSystem.updateCamera(
            playerIndex,
            playerPosition,
            playerDirection,
            dt,
            playerQuaternion,
            cockpitCamera,
            isBoosting,
            arena,
            firstPersonAnchor,
            cameraContext
        );
    }

    render() {
        this.viewportSystem.render(this.scene, this.cameras);
    }

    /**
     * Builds the shader programs of the current match scene ahead of the first drawn frame.
     * Deliberately the synchronous compile: compileAsync polls currentProgram.isReady() on its own
     * timer, and a match that tears down its scene before that poll finishes leaves the program
     * undefined, which throws outside any promise chain.
     * @returns {boolean} whether a compile ran for this scene
     */
    precompileMatchScene() {
        const camera = this.cameras?.[0] || null;
        if (!camera) return false;
        try {
            this.renderer.compile(this.scene, camera);
            return true;
        } catch {
            return false;
        }
    }

    _getAspect() {
        return this.viewportSystem.getAspect();
    }

    _updateCameraAspects() {
        this.viewportSystem.updateCameraAspects(this.cameras);
    }

    _onResize() {
        this.viewportSystem.onResize(this.cameras);
        this._width = this.viewportSystem.width;
        this._height = this.viewportSystem.height;
    }

    addToScene(obj) {
        this.sceneRootManager.addToScene(obj);
    }

    addToPersistentScene(obj) {
        this.sceneRootManager.addToPersistentScene(obj);
    }

    addToDebugScene(obj) {
        this.sceneRootManager.addToDebugScene(obj);
    }

    removeFromScene(obj) {
        this.sceneRootManager.removeFromScene(obj);
    }

    _clearRoot(root) {
        this.sceneRootManager.clearRoot(root);
    }

    _resetCameras() {
        this.cameraRigSystem.resetCameras();
    }

    clearMatchScene() {
        this.sceneRootManager.clearMatchScene();
        this._resetCameras();
    }

    clearScene() {
        this.sceneRootManager.clearScene();
        this._resetCameras();
    }

    setQuality(quality) {
        this.qualityController.setQuality(quality);
    }

    setRecordingQualityLock(active, reason = 'cinematic-recording') {
        return this.qualityController.setQualityLock(active === true, reason);
    }

    getQualityState() {
        return this.qualityController.getQualityState();
    }

    setShadowQuality(level) {
        this.qualityController.setShadowQuality(level);
    }

    getShadowQuality() {
        return this.qualityController.getShadowQuality();
    }

    setBloomQuality(level) {
        this.qualityController.setBloomQuality(level);
        this.recordingCapturePipeline.setBloomQuality?.(level);
    }

    getBloomQuality() {
        return this.qualityController.getBloomQuality();
    }

    // Anisotropic filtering is a hardware limit, so only the renderer knows it. Scene builders
    // read it from here instead of importing three's capabilities themselves - entities must not
    // reach into core.
    getMaxAnisotropy() {
        const supported = Number(this.renderer.capabilities?.getMaxAnisotropy?.());
        return Number.isFinite(supported) && supported > 1 ? Math.trunc(supported) : 1;
    }

    dispose() {
        if (this._onWindowResize) {
            window.removeEventListener('resize', this._onWindowResize);
            this._onWindowResize = null;
        }
        this.recordingCapturePipeline.dispose();
        this.clearScene();
        this._lightingRig.dispose();
        this._environmentController.dispose();
        this.postProcessingPipeline.dispose();
        this.renderer.dispose();
    }
}
