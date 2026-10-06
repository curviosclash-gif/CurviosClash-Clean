import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class EditorCore {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.viewMode = 'perspective';
        // Set by the ship flight controls; while it returns true it owns the camera for that frame.
        this.cameraFrameHook = null;
        // Run after the camera moved, right before the frame is drawn.
        this.beforeRenderCallbacks = new Set();
        this.shipFlightActive = false;
        this._scratchDirection = new THREE.Vector3();
        this._focusBox = new THREE.Box3();
        this._focusSphere = new THREE.Sphere();

        this.setupScene();
    }

    setCameraFrameHook(hook) {
        this.cameraFrameHook = typeof hook === 'function' ? hook : null;
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x020617);
        this.scene.fog = new THREE.Fog(0x020617, 3000, 6000);

        this.perspectiveCamera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 1, 10000);
        this.perspectiveCamera.position.set(0, 2000, 2000);
        this.orthographicCamera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 1, 20000);
        this.orthographicCamera.position.set(0, 4000, 0);
        this.orthographicCamera.up.set(0, 0, -1);
        this.camera = this.perspectiveCamera;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbit.enableDamping = true;
        this.orbit.dampingFactor = 0.05;
        this.orbit.maxDistance = 6000;
        this.orbit.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE
        };

        this.orbit.listenToKeyEvents(window);

        this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControl.addEventListener('dragging-changed', (event) => {
            if (!this.shipFlightActive) this.orbit.enabled = !event.value;
        });

        this.scene.add(this.transformControl.getHelper());
        this.transformControl.setTranslationSnap(null); // default off

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        // The game view swaps these for the match lighting rig.
        this.editorLights = [ambientLight, dirLight];
        dirLight.position.set(1000, 2000, 500);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 2000;
        dirLight.shadow.camera.bottom = - 2000;
        dirLight.shadow.camera.left = - 2000;
        dirLight.shadow.camera.right = 2000;
        this.scene.add(dirLight);

        // Grid & Ground Area
        const gridHelper = new THREE.GridHelper(4000, 40, 0x1f2937, 0x111827);
        gridHelper.position.y = 0;
        this.scene.add(gridHelper);
        this.gridHelper = gridHelper;

        const groundGeo = new THREE.PlaneGeometry(10000, 10000);
        groundGeo.rotateX(-Math.PI / 2);
        this.groundMesh = new THREE.Mesh(groundGeo, new THREE.ShadowMaterial({ opacity: 0.2 }));
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        // Y-Level Grid (for building on floors)
        this.yGridHelper = new THREE.GridHelper(4000, 40, 0x3b82f6, 0x1e3a8a);
        this.yGridHelper.position.y = 0;
        this.yGridHelper.visible = false;
        this.scene.add(this.yGridHelper);

        this.yGroundMesh = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ visible: false }));
        this.yGroundMesh.position.y = 0;
        this.scene.add(this.yGroundMesh);

        // Objects container
        this.objectsContainer = new THREE.Group();
        this.scene.add(this.objectsContainer);

        // Tunnel Visuals Layer
        this.tunnelLines = new THREE.Group();
        this.scene.add(this.tunnelLines);

        // Resize
        window.addEventListener('resize', () => {
            this.updateCameraProjection();
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        });

        this.lastTime = performance.now();
    }

    updateCameraProjection() {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.perspectiveCamera.aspect = width / height;
        this.perspectiveCamera.updateProjectionMatrix();
        const halfHeight = 1000;
        const halfWidth = halfHeight * (width / height);
        this.orthographicCamera.left = -halfWidth;
        this.orthographicCamera.right = halfWidth;
        this.orthographicCamera.top = halfHeight;
        this.orthographicCamera.bottom = -halfHeight;
        this.orthographicCamera.updateProjectionMatrix();
    }

    setViewMode(mode = 'perspective') {
        const normalized = ['top', 'front', 'side'].includes(mode) ? mode : 'perspective';
        const target = this.orbit.target.clone();
        this.viewMode = normalized;
        if (normalized === 'perspective') {
            this.camera = this.perspectiveCamera;
            if (this.camera.position.distanceToSquared(target) < 1) {
                this.camera.position.set(target.x + 1400, target.y + 1200, target.z + 1400);
            }
            this.camera.up.set(0, 1, 0);
        } else {
            this.camera = this.orthographicCamera;
            this.camera.zoom = 1;
            if (normalized === 'top') {
                this.camera.position.set(target.x, target.y + 5000, target.z);
                this.camera.up.set(0, 0, -1);
            } else if (normalized === 'front') {
                this.camera.position.set(target.x, target.y, target.z + 5000);
                this.camera.up.set(0, 1, 0);
            } else {
                this.camera.position.set(target.x + 5000, target.y, target.z);
                this.camera.up.set(0, 1, 0);
            }
            this.camera.lookAt(target);
        }
        this.orbit.object = this.camera;
        this.orbit.enableRotate = normalized === 'perspective';
        this.transformControl.camera = this.camera;
        this.updateCameraProjection();
        this.orbit.update();
        return this.viewMode;
    }

    focusObject(object) {
        if (!object) return false;
        this._focusBox.setFromObject(object);
        if (this._focusBox.isEmpty()) return false;
        this._focusBox.getBoundingSphere(this._focusSphere);
        const center = this._focusSphere.center;
        const radius = Math.max(40, this._focusSphere.radius);
        this.orbit.target.copy(center);
        if (this.camera.isOrthographicCamera) {
            this.camera.zoom = Math.max(0.15, Math.min(12, 650 / radius));
            if (this.viewMode === 'top') this.camera.position.set(center.x, center.y + 5000, center.z);
            else if (this.viewMode === 'front') this.camera.position.set(center.x, center.y, center.z + 5000);
            else this.camera.position.set(center.x + 5000, center.y, center.z);
            this.camera.lookAt(center);
            this.camera.updateProjectionMatrix();
        } else {
            this._scratchDirection.copy(this.camera.position).sub(center);
            if (this._scratchDirection.lengthSq() < 1) this._scratchDirection.set(1, 0.8, 1);
            this._scratchDirection.normalize().multiplyScalar(radius * 3.2);
            this.camera.position.copy(center).add(this._scratchDirection);
            this.camera.lookAt(center);
        }
        this.orbit.update();
        return true;
    }

    captureViewState() {
        return {
            mode: this.viewMode,
            position: this.camera.position.toArray(),
            target: this.orbit.target.toArray(),
            zoom: Number(this.camera.zoom) || 1,
        };
    }

    restoreViewState(state) {
        if (!state || typeof state !== 'object') return false;
        this.setViewMode(state.mode);
        if (Array.isArray(state.position) && state.position.length === 3) this.camera.position.fromArray(state.position);
        if (Array.isArray(state.target) && state.target.length === 3) this.orbit.target.fromArray(state.target);
        if (this.camera.isOrthographicCamera && Number(state.zoom) > 0) {
            this.camera.zoom = Number(state.zoom);
            this.camera.updateProjectionMatrix();
        }
        this.camera.lookAt(this.orbit.target);
        this.orbit.update();
        return true;
    }

    animate(time) {
        requestAnimationFrame((t) => this.animate(t));

        const elapsed = (time - this.lastTime) / 1000;
        this.lastTime = time;
        // A hidden tab pauses requestAnimationFrame; the first frame back must not jump.
        const dt = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, 0.1) : 0.016;

        // OrbitControls.update() re-aims the camera at its target, so it must not run
        // while the ship flight owns the camera.
        if (this.cameraFrameHook?.(dt) !== true) this.orbit.update();
        this.beforeRenderCallbacks.forEach((callback) => callback(dt));
        this.renderer.render(this.scene, this.camera);
    }
}
