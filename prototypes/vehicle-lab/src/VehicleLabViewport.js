import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class VehicleLabViewport {
    constructor(core, onSelect) {
        this.core = core;
        this.onSelect = onSelect;
        this.isFlyMode = false;

        this.controls = new OrbitControls(core.camera, core.canvas);
        this.controls.enableDamping = true;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };

        this.gizmo = new TransformControls(core.camera, core.canvas);
        this.gizmo.addEventListener('dragging-changed', (e) => {
            this.controls.enabled = !e.value;
            if (!e.value && this.onChanged) this.onChanged();
        });
        core.scene.add(this.gizmo);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        core.canvas.addEventListener('click', (e) => this.onClick(e));

        window.addEventListener('keydown', (e) => {
            if (e.key === 't') this.gizmo.setMode('translate');
            if (e.key === 'r') this.gizmo.setMode('rotate');
            if (e.key === 's') this.gizmo.setMode('scale');
        });

        // Hitbox Preview (AABB/OBB style)
        this.hitboxPreview = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ color: 0x34d399, wireframe: true, transparent: true, opacity: 0.25 })
        );
        this.hitboxPreview.visible = false; // Off by default
        core.scene.add(this.hitboxPreview);
    }

    attach(object) {
        if (object) this.gizmo.attach(object);
        else this.gizmo.detach();
    }

    onClick(event) {
        try {
            if (this.gizmo.dragging) return;

            const rect = this.core.canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.core.camera);
            const vehicle = this.core.scene.children.find(c => c.isModularVehicle);
            if (!vehicle) return;

            const intersects = this.raycaster.intersectObjects(vehicle.children, true);

            if (intersects.length > 0) {
                let p = intersects[0].object;
                while (p && p.userData.partIndex === undefined) p = p.parent;
                if (p && p.userData.partIndex !== undefined) {
                    this.onSelect(p.userData.partIndex, p.userData.path || []);
                }
            } else {
                this.onSelect(null, []);
            }
        } catch (err) {
            console.error("Selection error:", err);
        }
    }

    updateHitbox(vehicle) {
        if (!this.hitboxPreview.visible) return;

        // Simulate game's Player.js hitbox calculation
        // Calculate the bounding box of the entire vehicle group
        const box = new THREE.Box3();
        box.setFromObject(vehicle);

        if (box.isEmpty()) {
            this.hitboxPreview.visible = false;
            return;
        }

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        this.hitboxPreview.position.copy(center);
        this.hitboxPreview.scale.copy(size);
    }

    setHitboxVisible(visible) {
        this.hitboxPreview.visible = visible;
    }

    update(dt) {
        if (this.isFlyMode) {
            const keys = this.core.keys;
            const speed = (keys.shift ? 15 : 5) * dt;
            const orbitSpeed = (keys.shift ? 2.5 : 1.2) * dt;
            const center = this.controls.target.clone();

            // Orbit (WASD + QE)
            const pitchInput = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
            const yawInput = (keys.e ? 1 : 0) - (keys.q ? 1 : 0);

            if (pitchInput !== 0 || yawInput !== 0) {
                const offset = this.core.camera.position.clone().sub(center);
                if (offset.lengthSq() > 0.0001) {
                    const spherical = new THREE.Spherical().setFromVector3(offset);

                    if (yawInput !== 0) spherical.theta -= yawInput * orbitSpeed;
                    if (pitchInput !== 0) {
                        spherical.phi = THREE.MathUtils.clamp(
                            spherical.phi - (pitchInput * orbitSpeed),
                            0.05,
                            Math.PI - 0.05
                        );
                    }

                    offset.setFromSpherical(spherical);
                    this.core.camera.position.copy(center).add(offset);
                    this.core.camera.lookAt(center);
                }
            }

            // Strafe / Plane Movement (A/D/X/Y)
            const dir = new THREE.Vector3();
            this.core.camera.getWorldDirection(dir);
            const right = new THREE.Vector3().crossVectors(dir, this.core.camera.up).normalize();

            // Re-calculate effective up for vertical movement relative to camera
            const camUp = new THREE.Vector3().crossVectors(right, dir).normalize();

            const move = new THREE.Vector3();
            if (keys.d) move.add(right);
            if (keys.a) move.sub(right);
            if (keys.y) move.add(camUp);
            if (keys.x) move.sub(camUp);

            if (move.lengthSq() > 0) {
                move.normalize().multiplyScalar(speed);
                this.core.camera.position.add(move);
                this.controls.target.add(move); // Move focus point with the camera
            }
        }
        this.controls.update();
    }
}
