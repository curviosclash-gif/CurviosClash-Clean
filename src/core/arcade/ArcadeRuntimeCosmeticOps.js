import { loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { applyArcadeCosmeticLoadoutToPlayer } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';

export function applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig) {
    const entityManager = runtimeState?.entityManager;
    const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
    if (!players.length) return;
    const vehicleId = support?._resolveActiveVehicleId?.(runtimeConfig) || 'ship5';
    const recordStore = support?.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
    const profile = loadVehicleProfiles(recordStore)[vehicleId] || null;
    for (const player of players) applyArcadeCosmeticLoadoutToPlayer(player, profile, runtimeConfig?.arcade?.enabled === true);
}
