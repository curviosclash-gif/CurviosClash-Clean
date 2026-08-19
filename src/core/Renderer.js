// ============================================
// Renderer.js - Three.js Rendering & Kameras
// ============================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
    resolveFogRange,
} from '../shared/contracts/ViewDistanceContract.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;

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

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(CONFIG.COLORS.BACKGROUND, 50, 200);
        this._modernBackgroundColor = new THREE.Color(0x050816);
        this._environmentRenderTarget = null;
        this._skyDome = null;
        this._starField = null;
        this._graphicsStyle = GRAPHICS_STYLES.MODERN;
        this._mapBrightness = DEFAULT_MAP_BRIGHTNESS;
        this._viewDistance = DEFAULT_VIEW_DISTANCE;
        this._baseToneMappingExposure = 1.05;
        this._baseAmbientIntensity = 0.58;
        this._baseFogNear = 55;
        this._baseFogFar = 190;

        this._setupLights();
        this._setupEnvironment();
        this._setupAtmosphere();
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

    _setupLights() {
        this._ambientLight = new THREE.HemisphereLight(0x9bc8ff, CONFIG.COLORS.AMBIENT_LIGHT, 0.58);
        this.scene.add(this._ambientLight);

        this._keyLight = new THREE.DirectionalLight(0xfff4e8, 1.35);
        this._keyLight.position.set(30, 50, 30);
        this._keyLight.castShadow = true;
        this._keyLight.shadow.mapSize.set(CONFIG.RENDER.SHADOW_MAP_SIZE, CONFIG.RENDER.SHADOW_MAP_SIZE);
        this._keyLight.shadow.camera.near = 1;
        this._keyLight.shadow.camera.far = 150;
        this._keyLight.shadow.camera.left = -60;
        this._keyLight.shadow.camera.right = 60;
        this._keyLight.shadow.camera.top = 60;
        this._keyLight.shadow.camera.bottom = -60;
        this.scene.add(this._keyLight);

        this._fillLight = new THREE.DirectionalLight(0x4f86d9, 0.32);
        this._fillLight.position.set(-20, 30, -10);
        this._rimLight = new THREE.DirectionalLight(0x39d9ff, 0.62);
        this._rimLight.position.set(-35, 18, -45);
        this.scene.add(this._fillLight, this._rimLight);
    }

    _setupEnvironment() {
        const environment = new RoomEnvironment();
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        try {
            this._environmentRenderTarget = pmremGenerator.fromScene(environment, 0.04);
            this.scene.environment = this._environmentRenderTarget.texture;
        } finally {
            environment.dispose();
            pmremGenerator.dispose();
        }
    }

    _setupAtmosphere() {
        const radius = Math.max(120, (Number(CONFIG.CAMERA.FAR) || 200) - 5);
        const skyGeometry = new THREE.SphereGeometry(radius, 32, 18);
        const positions = skyGeometry.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const zenith = new THREE.Color(0x02050f);
        const horizon = new THREE.Color(0x17355a);
        const nadir = new THREE.Color(0x070914);
        const sample = new THREE.Color();
        for (let i = 0; i < positions.count; i++) {
            const y = THREE.MathUtils.clamp(positions.getY(i) / radius, -1, 1);
            if (y >= 0) {
                sample.copy(horizon).lerp(zenith, Math.pow(y, 0.62));
            } else {
                sample.copy(horizon).lerp(nadir, Math.pow(-y, 0.7));
            }
            colors[i * 3] = sample.r;
            colors[i * 3 + 1] = sample.g;
            colors[i * 3 + 2] = sample.b;
        }
        skyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const skyMaterial = new THREE.MeshBasicMaterial({
            side: THREE.BackSide,
            vertexColors: true,
            depthWrite: false,
            fog: false,
            toneMapped: false,
        });
        this._skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
        this._skyDome.name = 'scene-atmosphere-sky';
        this._skyDome.renderOrder = -1000;
        this.scene.add(this._skyDome);

        const starCount = 360;
        const starPositions = new Float32Array(starCount * 3);
        let seed = 0x5f3759df;
        const nextRandom = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        for (let i = 0; i < starCount; i++) {
            const theta = nextRandom() * Math.PI * 2;
            const y = nextRandom() * 2 - 1;
            const ring = Math.sqrt(Math.max(0, 1 - y * y));
            const distance = radius * (0.86 + nextRandom() * 0.08);
            starPositions[i * 3] = Math.cos(theta) * ring * distance;
            starPositions[i * 3 + 1] = y * distance;
            starPositions[i * 3 + 2] = Math.sin(theta) * ring * distance;
        }
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        const starMaterial = new THREE.PointsMaterial({
            color: 0xb9dcff,
            size: 0.42,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            fog: false,
            toneMapped: false,
        });
        this._starField = new THREE.Points(starGeometry, starMaterial);
        this._starField.name = 'scene-atmosphere-stars';
        this._starField.renderOrder = -900;
        this.scene.add(this._starField);
    }

    setGraphicsStyle(style) {
        const normalized = normalizeGraphicsStyle(style);
        const modern = normalized === GRAPHICS_STYLES.MODERN;
        this._graphicsStyle = normalized;

        this._baseToneMappingExposure = modern ? 1.05 : 1.2;
        this._baseAmbientIntensity = modern ? 0.58 : 0.8;
        this.scene.background = modern ? this._modernBackgroundColor : null;
        this.scene.fog.color.setHex(modern ? 0x0b1020 : CONFIG.COLORS.BACKGROUND);
        this._baseFogNear = modern ? 55 : 50;
        this._baseFogFar = modern ? 190 : 200;

        this._ambientLight.color.setHex(modern ? 0x9bc8ff : CONFIG.COLORS.AMBIENT_LIGHT);
        this._ambientLight.groundColor.setHex(CONFIG.COLORS.AMBIENT_LIGHT);
        this._keyLight.color.setHex(modern ? 0xfff4e8 : 0xffffff);
        this._keyLight.intensity = modern ? 1.35 : 0.8;
        this._keyLight.shadow.bias = modern ? -0.0002 : 0;
        this._keyLight.shadow.normalBias = modern ? 0.025 : 0;
        this._fillLight.color.setHex(modern ? 0x4f86d9 : 0x4466aa);
        this._fillLight.intensity = modern ? 0.32 : 0.3;
        this._rimLight.visible = modern;
        this._skyDome.visible = modern;
        this._starField.visible = modern;

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

    // Der Grafikstil liefert die Basiswerte, die Helligkeitsstufe einen Faktor darauf, und
    // eine explizit gesetzte Sichtweite ersetzt die Fog-Reichweite ganz. Nur diese eine
    // Stelle schreibt - sonst ueberschreiben sich die Quellen gegenseitig.
    _applySceneAppearance() {
        const factors = resolveMapBrightnessFactors(this._mapBrightness);
        this.renderer.toneMappingExposure = this._baseToneMappingExposure * factors.exposure;
        this._ambientLight.intensity = this._baseAmbientIntensity * factors.ambient;

        const fog = resolveFogRange({
            viewDistance: this._viewDistance,
            brightnessFogFactor: factors.fog,
            baseNear: this._baseFogNear,
            baseFar: this._baseFogFar,
        });
        this.scene.fog.near = fog.near;
        this.scene.fog.far = fog.far;
    }

    createCamera(_index) {
        return this.cameraRigSystem.createCamera(this._getAspect());
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

    dispose() {
        if (this._onWindowResize) {
            window.removeEventListener('resize', this._onWindowResize);
            this._onWindowResize = null;
        }
        this.recordingCapturePipeline.dispose();
        this.clearScene();
        for (const atmosphereObject of [this._skyDome, this._starField]) {
            if (!atmosphereObject) continue;
            this.scene.remove(atmosphereObject);
            atmosphereObject.geometry?.dispose?.();
            atmosphereObject.material?.dispose?.();
        }
        this._skyDome = null;
        this._starField = null;
        this.scene.environment = null;
        this._environmentRenderTarget?.dispose?.();
        this._environmentRenderTarget = null;
        this.postProcessingPipeline.dispose();
        this.renderer.dispose();
    }
}
