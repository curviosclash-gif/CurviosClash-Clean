import { createBaseVehicleMesh } from '../../../src/entities/vehicle-registry.js';
import { isVehicleLabBaseMeshReferenceOnly } from '../../../src/shared/contracts/VehicleLabConfigContract.js';
import { ModularVehicleMesh } from './ModularVehicleMesh.js';

const REFERENCE_OPACITY = 0.18;

function createAuthoringConfig({ id, label }, color, config = null) {
    return config || {
        id,
        label,
        primaryColor: color,
        baseVehicleId: id,
        baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
        parts: [],
    };
}

function ghostMaterial(material) {
    const ghost = material.clone();
    ghost.transparent = true;
    ghost.opacity = Math.min(ghost.opacity ?? 1, REFERENCE_OPACITY);
    ghost.depthWrite = false;
    return ghost;
}

export class GameVehicleReferenceMesh extends ModularVehicleMesh {
    constructor(vehicle, color = 0x60a5fa, config = null) {
        const authoringConfig = createAuthoringConfig(vehicle, color, config);
        const baseMesh = createBaseVehicleMesh(authoringConfig.baseVehicleId || vehicle.id, authoringConfig.primaryColor);
        super(authoringConfig, { baseMesh });
        this.isGameVehicleReference = true;
        this.referenceVisible = true;
        this.ready = Promise.resolve(baseMesh?.whenReady?.() || baseMesh?.ready).then(() => true, () => false);
        // OBJ models attach their meshes only after loading.
        baseMesh?.addEventListener?.('loaded', () => this.applyReferenceStyle());
        this.applyReferenceStyle();
    }

    isReferenceOnly() {
        return isVehicleLabBaseMeshReferenceOnly(this.config);
    }

    build() {
        super.build();
        this.applyReferenceStyle?.();
    }

    /** Shows the old game model as a see-through, unclickable tracing aid. */
    applyReferenceStyle() {
        if (!this.baseMesh || !this.isReferenceOnly()) return;
        this.baseMesh.visible = this.referenceVisible !== false;
        this.baseMesh.traverse((child) => {
            if (!child.isMesh || child.userData.vehicleLabReferenceGhost) return;
            child.material = Array.isArray(child.material)
                ? child.material.map(ghostMaterial)
                : ghostMaterial(child.material);
            child.castShadow = false;
            child.raycast = () => {};
            child.userData.vehicleLabReferenceGhost = true;
        });
    }

    setReferenceVisible(visible) {
        this.referenceVisible = visible !== false;
        this.applyReferenceStyle();
    }
}
