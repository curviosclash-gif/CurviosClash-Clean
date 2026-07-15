import { listVehicleDescriptors } from '../../../src/entities/vehicle-registry.js';

export function listVehicleLabGameReferences() {
    return listVehicleDescriptors()
        .filter((vehicle) => vehicle.usesObjMesh === true)
        .map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.label,
            readOnly: true,
            source: 'game-reference',
        }));
}
