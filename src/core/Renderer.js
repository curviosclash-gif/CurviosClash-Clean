// ============================================
// Renderer.js - Three.js Rendering & Kameras
// ============================================

import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { CameraRigSystem } from './renderer/CameraRigSystem.js';
import { RenderViewportSystem } from './renderer/RenderViewportSystem.js';
import { SceneRootManager } from './renderer/SceneRootManager.js';
import { RenderQualityController } from './renderer/RenderQualityController.js';
import { RecordingCapturePipeline } from './renderer/RecordingCapturePipeline.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: window.devicePixelRatio <= 1,
            alpha: false,
            preserveDrawingBuffer: false,
        });
        this._recordingActive = false;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.RENDER.MAX_PIXEL_RATIO));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.setClearColor(CONFIG.COLORS.BACKGROUND);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(CONFIG.COLORS.BACKGROUND, 50, 200);

        this._setupLights();

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

        this.viewportSystem = new RenderViewportSystem(this.renderer, {
            width: window.innerWidth,
            height: window.innerHeight,
            splitScreen: false,
        });
        this._width = this.viewportSystem.width;
        this._height = this.viewportSystem.height;
        this.splitScreen = this.viewportSystem.splitScreen;

        this.qualityController = new RenderQualityController(this.renderer, this.scene);
        this.recordingCapturePipeline = new RecordingCapturePipeline({
            sourceCanvas: this.canvas,
            sourceRenderer: this.renderer,
            scene: this.scene,
        });

        this._onWindowResize = () => this._onResize();
        window.addEventListener('resize', this._onWindowResize);
    }

    _setupLights() {
        const ambient = new THREE.AmbientLight(CONFIG.COLORS.AMBIENT_LIGHT, 0.8);
        this.scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(30, 50, 30);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(CONFIG.RENDER.SHADOW_MAP_SIZE, CONFIG.RENDER.SHADOW_MAP_SIZE);
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 150;
        dirLight.shadow.camera.left = -60;
        dirLight.shadow.camera.right = 60;
        dirLight.shadow.camera.top = 60;
        dirLight.shadow.camera.bottom = -60;
        this.scene.add(dirLight);

        const fillLight = new THREE.DirectionalLight(0x4466aa, 0.3);
        fillLight.position.set(-20, 30, -10);
        this.scene.add(fillLight);
    }

    createCamera(_index) {
        return this.cameraRigSystem.createCamera(this._getAspect());
    }

    setSplitScreen(enabled) {
        this.viewportSystem.setSplitScreen(enabled, this.cameras);
        this.splitScreen = this.viewportSystem.splitScreen;
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

    dispose() {
        if (this._onWindowResize) {
            window.removeEventListener('resize', this._onWindowResize);
            this._onWindowResize = null;
        }
        this.recordingCapturePipeline.dispose();
        this.clearScene();
        this.renderer.dispose();
    }
}
