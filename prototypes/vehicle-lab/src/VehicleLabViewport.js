import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
    VEHICLE_LAB_CAMERA_DISTANCE_LIMITS,
    resolveVehicleLabFitDistance,
    resolveVehicleLabViewPose,
} from './VehicleLabCameraPolicy.js';

export class VehicleLabViewport {
    constructor(core, onSelect) {
        this.core = core;
        this.onSelect = onSelect;
        this.isFlyMode = false;
        this.hitboxDirty = true;
        this.pointerStartX = 0;
        this.pointerStartY = 0;
        this.pointerIsDown = false;
        this.pointerDragged = false;
        this.suppressSelectionUntil = 0;
        this.scratch = {
            center: new THREE.Vector3(),
            offset: new THREE.Vector3(),
            direction: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(),
            move: new THREE.Vector3(),
            box: new THREE.Box3(),
            size: new THREE.Vector3(),
            sphere: new THREE.Sphere(),
        };

        this.controls = new OrbitControls(core.camera, core.canvas);
        this.controls.enableDamping = true;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = VEHICLE_LAB_CAMERA_DISTANCE_LIMITS.min;
        this.controls.maxDistance = VEHICLE_LAB_CAMERA_DISTANCE_LIMITS.max;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
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

        this.onCanvasClick = (e) => this.onClick(e);
        this.onPointerDown = (e) => {
            this.pointerIsDown = true;
            this.pointerStartX = e.clientX;
            this.pointerStartY = e.clientY;
            this.pointerDragged = false;
        };
        this.onPointerMove = (e) => {
            if (!this.pointerIsDown) return;
            const deltaX = e.clientX - this.pointerStartX;
            const deltaY = e.clientY - this.pointerStartY;
            if ((deltaX * deltaX) + (deltaY * deltaY) > 16) this.pointerDragged = true;
        };
        this.onPointerUp = () => {
            if (this.pointerDragged) this.suppressSelectionUntil = Date.now() + 120;
            this.pointerIsDown = false;
        };
        core.canvas.addEventListener('click', this.onCanvasClick);
        core.canvas.addEventListener('pointerdown', this.onPointerDown);
        core.canvas.addEventListener('pointermove', this.onPointerMove);
        core.canvas.addEventListener('pointerup', this.onPointerUp);
        core.canvas.addEventListener('pointercancel', this.onPointerUp);

        this.onShortcutKeyDown = (e) => {
            if (this.core.isEditingTarget(e.target) || this.isFlyMode || e.ctrlKey || e.metaKey) return;
            const key = e.key.toLowerCase();
            if (key === 't') this.setTransformMode('translate');
            if (key === 'r') this.setTransformMode('rotate');
            if (key === 's') this.setTransformMode('scale');
        };
        window.addEventListener('keydown', this.onShortcutKeyDown);

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
        this.gizmo.enabled = !this.isFlyMode;
        this.gizmo.visible = !this.isFlyMode && !!this.gizmo.object;
    }

    setTransformMode(mode) {
        if (!['translate', 'rotate', 'scale'].includes(mode)) return false;
        this.gizmo.setMode(mode);
        this.onModeChanged?.(mode);
        return true;
    }

    setFlyMode(enabled) {
        this.isFlyMode = enabled === true;
        this.gizmo.enabled = !this.isFlyMode;
        this.gizmo.visible = !this.isFlyMode && !!this.gizmo.object;
    }

    onClick(event) {
        try {
            if (this.gizmo.dragging || Date.now() < this.suppressSelectionUntil) return;

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

    setHitboxVisible(visible) {
        this.hitboxPreview.visible = visible;
        this.hitboxDirty = visible;
    }

    requestHitboxUpdate() {
        this.hitboxDirty = true;
    }

    updateHitboxIfNeeded(vehicle) {
        if (!this.hitboxDirty || !this.hitboxPreview.visible) return;
        this.hitboxDirty = false;
        const box = this.scratch.box.setFromObject(vehicle);
        if (box.isEmpty()) {
            this.hitboxPreview.visible = false;
            return;
        }
        box.getSize(this.scratch.size);
        box.getCenter(this.scratch.center);
        this.hitboxPreview.position.copy(this.scratch.center);
        this.hitboxPreview.scale.copy(this.scratch.size);
    }

    setSnapping(enabled, translateStep = 0.25, rotationDegrees = 15, scaleStep = 0.1) {
        this.gizmo.setTranslationSnap(enabled ? translateStep : null);
        this.gizmo.setRotationSnap(enabled ? THREE.MathUtils.degToRad(rotationDegrees) : null);
        this.gizmo.setScaleSnap(enabled ? scaleStep : null);
    }

    setCameraView(view, vehicle) {
        const target = this.controls.target;
        let distance = Math.max(6, this.core.camera.position.distanceTo(target));
        if (vehicle) {
            const box = this.scratch.box.setFromObject(vehicle);
            if (!box.isEmpty()) {
                box.getBoundingSphere(this.scratch.sphere);
                target.copy(this.scratch.sphere.center);
                distance = resolveVehicleLabFitDistance(
                    this.scratch.sphere.radius,
                    this.core.camera.fov,
                    this.core.camera.aspect
                );
            }
        }

        const pose = resolveVehicleLabViewPose(view, distance);
        this.core.camera.up.fromArray(pose.up);
        this.scratch.offset.fromArray(pose.offset);
        this.core.camera.position.copy(target).add(this.scratch.offset);
        this.core.camera.lookAt(target);
        this.controls.update();
    }

    update(dt) {
        if (this.isFlyMode) {
            const keys = this.core.keys;
            const speed = (keys.shift ? 15 : 5) * dt;
            const dir = this.scratch.direction;
            this.core.camera.getWorldDirection(dir);
            const right = this.scratch.right.crossVectors(dir, this.core.camera.up).normalize();
            const camUp = this.scratch.up.copy(this.core.camera.up).normalize();

            const move = this.scratch.move.set(0, 0, 0);
            if (keys.w) move.add(dir);
            if (keys.s) move.sub(dir);
            if (keys.d) move.add(right);
            if (keys.a) move.sub(right);
            if (keys.e) move.add(camUp);
            if (keys.q) move.sub(camUp);

            if (move.lengthSq() > 0) {
                move.normalize().multiplyScalar(speed);
                this.core.camera.position.add(move);
                this.controls.target.add(move); // Move focus point with the camera
            }
        }
        this.controls.update();
    }

    dispose() {
        this.attach(null);
        this.controls.dispose();
        this.gizmo.dispose();
        this.hitboxPreview.geometry.dispose();
        this.hitboxPreview.material.dispose();
        this.core.canvas.removeEventListener('click', this.onCanvasClick);
        this.core.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.core.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.core.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.core.canvas.removeEventListener('pointercancel', this.onPointerUp);
        window.removeEventListener('keydown', this.onShortcutKeyDown);
        this.core.scene.remove(this.gizmo);
        this.core.scene.remove(this.hitboxPreview);
    }
}
