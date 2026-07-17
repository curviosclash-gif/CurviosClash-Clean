import { createBaseVehicleMesh } from '../../../src/entities/vehicle-registry.js';
import { ModularVehicleMesh } from './ModularVehicleMesh.js';

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

export class GameVehicleReferenceMesh extends ModularVehicleMesh {
    constructor(vehicle, color = 0x60a5fa, config = null) {
        const authoringConfig = createAuthoringConfig(vehicle, color, config);
        const baseMesh = createBaseVehicleMesh(authoringConfig.baseVehicleId || vehicle.id, authoringConfig.primaryColor);
        super(authoringConfig, { baseMesh });
        this.isGameVehicleReference = true;
        this.ready = Promise.resolve(baseMesh?.whenReady?.() || baseMesh?.ready).then(() => true, () => false);
    }
}
