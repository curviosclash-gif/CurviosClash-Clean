import * as THREE from 'three';
import { ModularVehicleMesh } from '../shared/vehicle-lab/ModularVehicleMeshBridge.js';
import { attachPlayerVehicleWeaponVisuals } from './PlayerVehicleWeaponVisuals.js';

function cloneVehicleConfig(config) {
    try {
        return JSON.parse(JSON.stringify(config || {}));
    } catch {
        return { label: 'Custom Vehicle', primaryColor: 0x60a5fa, parts: [] };
    }
}

export class RuntimeModularVehicleMesh extends ModularVehicleMesh {
    constructor(color, config = {}, options = {}) {
        const runtimeConfig = cloneVehicleConfig(config);
        const colorValue = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim())
            ? Number.parseInt(color.trim().slice(1), 16)
            : Number(color);
        if (Number.isFinite(colorValue)) {
            runtimeConfig.primaryColor = colorValue;
        }

        super(runtimeConfig, options);

        this.playerColor = color;
        this.muzzle = new THREE.Object3D();
        this.muzzle.userData.runtimeHelper = true;

        this.firstPersonAnchor = new THREE.Object3D();
        this.firstPersonAnchor.userData.runtimeHelper = true;

        this._runtimeAnchorsReady = true;
        this.add(this.muzzle);
        this.add(this.firstPersonAnchor);
        this.refreshRuntimeMetadata();
        attachPlayerVehicleWeaponVisuals(this);
        this.refreshRuntimeMetadata();
    }

    build() {
        const machineGunId = this.weaponVisuals?._machineGunId;
        const rocketInventory = this.weaponVisuals?._inventory;
        this.weaponVisuals?.dispose();
        this.weaponVisuals = null;
        super.build();
        if (!this._runtimeAnchorsReady) return;

        if (this.muzzle && this.muzzle.parent !== this) this.add(this.muzzle);
        if (this.firstPersonAnchor && this.firstPersonAnchor.parent !== this) this.add(this.firstPersonAnchor);
        this.refreshRuntimeMetadata();
        attachPlayerVehicleWeaponVisuals(this);
        if (machineGunId) this.setMachineGunModel(machineGunId);
        if (rocketInventory) this.syncRocketInventory(rocketInventory);
    }

    refreshRuntimeMetadata() {
        this.updateMatrixWorld(true);

        const box = new THREE.Box3();
        const inverseWorld = new THREE.Matrix4().copy(this.matrixWorld).invert();
        const relative = new THREE.Matrix4();
        const partBounds = new THREE.Box3();
        this.traverse((child) => {
            const mesh = /** @type {THREE.Mesh} */ (child);
            if (!mesh.isMesh || !mesh.geometry) return;
            for (let node = child; node && node !== this; node = node.parent) {
                if (node.userData?.runtimeVisual === true || node.userData?.runtimeHelper === true) return;
            }
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (!mesh.geometry.boundingBox) return;
            relative.multiplyMatrices(inverseWorld, child.matrixWorld);
            partBounds.copy(mesh.geometry.boundingBox).applyMatrix4(relative);
            box.union(partBounds);
        });
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

    setMachineGunModel(machineGunId) {
        this.weaponVisuals?.setMachineGunModel(machineGunId);
    }

    syncRocketInventory(inventory) {
        this.weaponVisuals?.syncRockets(inventory);
    }

    dispose() {
        this.weaponVisuals?.dispose();
        this.weaponVisuals = null;
        super.dispose();
    }
}

export default RuntimeModularVehicleMesh;
