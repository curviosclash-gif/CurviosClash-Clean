import * as THREE from 'three';
import { createVehicleMesh } from '../../../src/entities/vehicle-registry.js';
import { disposeObject3DResources } from '../../../src/shared/rendering/ThreeDisposal.js';

export class GameVehicleReferenceMesh extends THREE.Group {
    constructor({ id, label }, color = 0x60a5fa) {
        super();
        this.isModularVehicle = true;
        this.isGameVehicleReference = true;
        this.config = { id, label, primaryColor: color, parts: [] };
        this.referenceMesh = createVehicleMesh(id, color);
        this.add(this.referenceMesh);
        this._disposed = false;
        const readiness = this.referenceMesh?.whenReady?.() || this.referenceMesh?.ready;
        this.ready = Promise.resolve(readiness).catch(() => false).then(() => !this._disposed);
    }

    tick(dt) {
        this.referenceMesh?.tick(dt);
    }

    setWireframe(enabled) {
        this.traverse((node) => {
            if (!node.isMesh) return;
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach((material) => {
                if (material && 'wireframe' in material) material.wireframe = enabled;
            });
        });
    }

    setSelectedSelection() {}

    dispose() {
        this._disposed = true;
        this.referenceMesh?.cancelPendingLoad?.();
        disposeObject3DResources(this);
        this.clear();
    }
}
