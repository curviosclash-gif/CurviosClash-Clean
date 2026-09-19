import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class EditorCore {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.runtimeStateAccessors = {
            isFlyModeEnabled: () => false,
            getArenaHeight: () => 950
        };
        this.viewMode = 'perspective';
        this._scratchCenter = new THREE.Vector3();
        this._scratchOffset = new THREE.Vector3();
        this._scratchDirection = new THREE.Vector3();
        this._scratchRight = new THREE.Vector3();
        this._scratchMove = new THREE.Vector3();
        this._scratchSpherical = new THREE.Spherical();
        this._focusBox = new THREE.Box3();
        this._focusSphere = new THREE.Sphere();

        this.keys = { w: false, a: false, s: false, d: false, q: false, e: false, x: false, y: false, shift: false };
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = true;
            if (e.key === 'Shift') this.keys.shift = true;
        });
        document.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = false;
            if (e.key === 'Shift') this.keys.shift = false;
        });

        this.setupScene();
    }

    setRuntimeStateAccessors(accessors = {}) {
        if (typeof accessors.isFlyModeEnabled === 'function') {
            this.runtimeStateAccessors.isFlyModeEnabled = accessors.isFlyModeEnabled;
        }
        if (typeof accessors.getArenaHeight === 'function') {
            this.runtimeStateAccessors.getArenaHeight = accessors.getArenaHeight;
        }
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

        // Im Fly-Mode wollen wir nur umherblicken (Mouselook), nicht pannen
        this.orbit.listenToKeyEvents(window);

        this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControl.addEventListener('dragging-changed', (event) => {
            const flyMode = !!this.runtimeStateAccessors.isFlyModeEnabled?.();
            if (!flyMode) this.orbit.enabled = !event.value;
        });

        this.scene.add(this.transformControl.getHelper());
        this.transformControl.setTranslationSnap(null); // default off

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
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

        const dt = (time - this.lastTime) / 1000 || 0.016;
        this.lastTime = time;

        const flyMode = !!this.runtimeStateAccessors.isFlyModeEnabled?.();
        if (flyMode) {
            const speed = (this.keys.shift ? 600 : 250) * dt;
            const orbitSpeed = (this.keys.shift ? 1.4 : 0.8) * dt;
            const arenaHeight = Number(this.runtimeStateAccessors.getArenaHeight?.()) || 950;
            const mapCenter = this._scratchCenter.set(0, arenaHeight * 0.5, 0);

            // W/S = vertical orbit (pitch), Q/E = horizontal orbit (yaw) around map center.
            const pitchInput = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
            const yawInput = (this.keys.e ? 1 : 0) - (this.keys.q ? 1 : 0);
            if (pitchInput !== 0 || yawInput !== 0) {
                const offset = this._scratchOffset.copy(this.camera.position).sub(mapCenter);
                if (offset.lengthSq() > 1e-6) {
                    const spherical = this._scratchSpherical.setFromVector3(offset);

                    if (yawInput !== 0) {
                        spherical.theta -= yawInput * orbitSpeed;
                    }

                    if (pitchInput !== 0) {
                        spherical.phi = THREE.MathUtils.clamp(
                            spherical.phi - (pitchInput * orbitSpeed),
                            0.05,
                            Math.PI - 0.05
                        );
                    }

                    offset.setFromSpherical(spherical);
                    this.camera.position.copy(mapCenter).add(offset);
                    this.orbit.target.copy(mapCenter);
                    this.camera.lookAt(mapCenter);
                }
            }

            const dir = this._scratchDirection;
            this.camera.getWorldDirection(dir);
            dir.normalize();

            const right = this._scratchRight;
            right.crossVectors(dir, this.camera.up).normalize();

            const move = this._scratchMove.set(0, 0, 0);
            if (this.keys.d) move.add(right);
            if (this.keys.a) move.sub(right);
            if (this.keys.y) move.y += 1;
            if (this.keys.x) move.y -= 1;
            if (move.lengthSq() > 0) {
                move.normalize().multiplyScalar(speed);
                this.camera.position.add(move);
                this.orbit.target.add(move);
            }
        }

        this.orbit.update();
        this.renderer.render(this.scene, this.camera);
    }
}
