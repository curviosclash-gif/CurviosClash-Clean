import { listBaseVehicleDescriptors } from '../../../src/entities/vehicle-registry.js';

export function listVehicleLabGameReferences() {
    return listBaseVehicleDescriptors()
        .map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.label,
            editableProduct: true,
            source: 'game-vehicle',
        }));
}
