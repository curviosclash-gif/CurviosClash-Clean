import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';
import { getRegisteredArcadeLabShip } from '../../shared/contracts/ArcadeLabRegistryContract.js';

export function resolveHangarPartSource(vehicleId) {
    const id = String(vehicleId || '');
    const lab = getRegisteredArcadeLabShip(id);
    return lab ? { id, label: lab.label, parts: lab.config.parts }
        : listPlayerShipPartDonors().find((donor) => donor.id === id) || null;
}
