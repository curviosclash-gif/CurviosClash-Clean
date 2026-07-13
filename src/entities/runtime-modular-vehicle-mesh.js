import * as THREE from 'three';
import { ModularVehicleMesh } from '../shared/vehicle-lab/ModularVehicleMeshBridge.js';

function cloneVehicleConfig(config) {
    try {
        return JSON.parse(JSON.stringify(config || {}));
    } catch {
        return { label: 'Custom Vehicle', primaryColor: 0x60a5fa, parts: [] };
    }
}

export class RuntimeModularVehicleMesh extends ModularVehicleMesh {
    constructor(color, config = {}) {
        const runtimeConfig = cloneVehicleConfig(config);
        if (Number.isFinite(Number(color))) {
            runtimeConfig.primaryColor = Number(color);
        }

        super(runtimeConfig);

        this.playerColor = color;
        this.muzzle = new THREE.Object3D();
        this.muzzle.userData.runtimeHelper = true;

        this.firstPersonAnchor = new THREE.Object3D();
        this.firstPersonAnchor.userData.runtimeHelper = true;

        this._runtimeAnchorsReady = true;
        this.add(this.muzzle);
        this.add(this.firstPersonAnchor);
        this.refreshRuntimeMetadata();
    }

    build() {
        super.build();
        if (!this._runtimeAnchorsReady) return;

        if (this.muzzle && this.muzzle.parent !== this) this.add(this.muzzle);
        if (this.firstPersonAnchor && this.firstPersonAnchor.parent !== this) this.add(this.firstPersonAnchor);
        this.refreshRuntimeMetadata();
    }

    refreshRuntimeMetadata() {
        this.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(this);
        if (box.isEmpty()) {
            this.localBox = new THREE.Box3(
                new THREE.Vector3(-1, -0.5, -1.5),
                new THREE.Vector3(1, 0.5, 1.5)
            );
            this.muzzle.position.set(0, 0, -1.6);
            this.firstPersonAnchor.position.set(0, 0.2, -1.2);
            return;
        }

        this.localBox = box.clone();
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        this.muzzle.position.set(
            center.x,
            center.y,
            box.min.z - Math.max(0.15, size.z * 0.08)
        );

        this.firstPersonAnchor.position.set(
            center.x,
            box.min.y + (size.y * 0.58),
            box.min.z + (size.z * 0.16)
        );
    }
}

export default RuntimeModularVehicleMesh;
