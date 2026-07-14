import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PRESETS = Object.freeze({
    hero: Object.freeze({ position: [4.2, 2.1, 4.8], target: [0, 0.2, 0] }),
    front: Object.freeze({ position: [0, 0.55, -5.6], target: [0, 0.1, 0] }),
    top: Object.freeze({ position: [0, 6.2, 0.3], target: [0, 0, 0] }),
    rear: Object.freeze({ position: [0, 0.7, 5.8], target: [0, 0.1, 0] }),
});

export class HangarCameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.controls = new OrbitControls(camera, domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 2.3;
        this.controls.maxDistance = 9;
        this.controls.minPolarAngle = 0.12;
        this.controls.maxPolarAngle = Math.PI - 0.18;
        this.targetPosition = new THREE.Vector3();
        this.targetLookAt = new THREE.Vector3();
        this.transitioning = false;
        this.setPreset('hero', { immediate: true });
    }

    setPreset(presetId, options = {}) {
        const preset = PRESETS[presetId] || PRESETS.hero;
        this.targetPosition.fromArray(preset.position);
        this.targetLookAt.fromArray(preset.target);
        this.transitioning = options.immediate !== true;
        if (!this.transitioning) {
            this.camera.position.copy(this.targetPosition);
            this.controls.target.copy(this.targetLookAt);
            this.controls.update();
        }
    }

    reset() { this.setPreset('hero'); }

    update() {
        if (this.transitioning) {
            this.camera.position.lerp(this.targetPosition, 0.14);
            this.controls.target.lerp(this.targetLookAt, 0.14);
            if (this.camera.position.distanceToSquared(this.targetPosition) < 0.0008
                && this.controls.target.distanceToSquared(this.targetLookAt) < 0.0008) {
                this.camera.position.copy(this.targetPosition);
                this.controls.target.copy(this.targetLookAt);
                this.transitioning = false;
            }
        }
        this.controls.update();
    }

    dispose() { this.controls.dispose(); }
}
