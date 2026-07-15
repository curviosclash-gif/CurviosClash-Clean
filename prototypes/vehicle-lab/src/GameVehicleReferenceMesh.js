import * as THREE from 'three';
import { OBJVehicleMesh } from '../../../src/entities/obj-vehicle-mesh.js';
import { disposeObject3DResources } from '../../../src/shared/rendering/ThreeDisposal.js';

export class GameVehicleReferenceMesh extends THREE.Group {
    constructor({ id, label }, color = 0x60a5fa) {
        super();
        this.isModularVehicle = true;
        this.isGameVehicleReference = true;
        this.config = { id, label, primaryColor: color, parts: [] };
        this.referenceMesh = new OBJVehicleMesh(color, id);
        this.add(this.referenceMesh);
        this._disposed = false;
        this.ready = new Promise((resolve) => {
            const finish = () => {
                this.referenceMesh?.removeEventListener?.('loaded', finish);
                if (this._disposed && this.referenceMesh) {
                    disposeObject3DResources(this.referenceMesh);
                    this.referenceMesh.clear();
                }
                resolve(!this._disposed);
            };
            this.referenceMesh.addEventListener('loaded', finish);
            if (this.referenceMesh._loaded) queueMicrotask(finish);
        });
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
        this.referenceMesh?.glowMat?.dispose?.();
        this.referenceMesh?.forceFieldMat?.dispose?.();
        disposeObject3DResources(this);
        this.clear();
    }
}
