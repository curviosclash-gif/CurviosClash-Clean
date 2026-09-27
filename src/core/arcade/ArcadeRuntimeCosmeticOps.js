import { loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { applyArcadeCosmeticLoadoutToPlayer } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { applyVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';

// Draws the hangar part style on a human's part-built vehicle in arcade runs. Always
// styles the factory config, so repeated runs never compound, and keeps the factory
// bounding box because the player hitbox is read from it.
function applyArcadePartStyle(player, style, vehicleId) {
    const mesh = player?.vehicleMesh;
    if (!mesh?.isModularVehicle || typeof mesh.updateConfig !== 'function') return;
    const data = mesh.userData;
    const active = !!style && Object.keys(style).length > 0 && player.isBot !== true
        && String(mesh.config?.id || '') === vehicleId;
    if (!active && !data.arcadePartStyleBase) return;
    data.arcadePartStyleBase ||= { config: JSON.parse(JSON.stringify(mesh.config)), localBox: mesh.localBox?.clone?.() || null };
    const base = data.arcadePartStyleBase;
    mesh.updateConfig(active ? applyVehiclePartStyle(base.config, style, listPlayerShipPartDonors()) : JSON.parse(JSON.stringify(base.config)));
    if (base.localBox) mesh.localBox = base.localBox.clone();
}

export function applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig) {
    const entityManager = runtimeState?.entityManager;
    const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
    if (!players.length) return;
    const vehicleId = support?._resolveActiveVehicleId?.(runtimeConfig) || 'ship5';
    const recordStore = support?.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
    const profile = loadVehicleProfiles(recordStore)[vehicleId] || null;
    const arcadeEnabled = runtimeConfig?.arcade?.enabled === true;
    for (const player of players) {
        applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled);
        applyArcadePartStyle(player, arcadeEnabled ? profile?.partStyle : null, vehicleId);
    }
}
