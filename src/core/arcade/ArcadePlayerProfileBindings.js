import { loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { resolveArcadeRunStrategyUpgradeBonuses } from './ArcadeRunVehicleRewardOps.js';
import { syncArcadeMasteryPerks } from './ArcadeMasteryPerkRuntimeOps.js';

export function initializeArcadePlayerProfileBindings(runtime, getRecordStoreForPlayerIndex) {
    runtime._getRecordStoreForPlayerIndex = typeof getRecordStoreForPlayerIndex === 'function'
        ? getRecordStoreForPlayerIndex
        : () => null;
    runtime._playerProfileBindingsActive = false;
    runtime._playerBindings = new Map();
    runtime._playerProfilesByIndex = Object.create(null);
    runtime._playerStoresByIndex = Object.create(null);
    runtime._runStoneStepsByPlayerIndex = Object.create(null);
}

export function prepareArcadePlayerProfileBindings(
    runtime,
    humanPlayers,
    profileIds,
    enabled = false,
    runActive = Boolean(runtime._state && !runtime._state.finishedAtIso),
) {
    if (!enabled) {
        clearArcadePlayerProfileBindings(runtime);
        return false;
    }
    if (runActive && runtime._playerProfileBindingsActive) return true;

    runtime._playerProfileBindingsActive = true;
    runtime._playerBindings = new Map();
    runtime._playerProfilesByIndex = Object.create(null);
    runtime._playerStoresByIndex = Object.create(null);
    runtime._runStoneStepsByPlayerIndex = Object.create(null);
    for (const player of Array.isArray(humanPlayers) ? humanPlayers : []) {
        if (!player || player.isBot === true) continue;
        const playerIndex = Number(player.index);
        const profileId = String(profileIds?.[playerIndex] || '').trim();
        const vehicleId = String(player.vehicleId || '').trim();
        if (!Number.isInteger(playerIndex) || !profileId || !vehicleId) continue;
        const store = runtime._getRecordStoreForPlayerIndex(playerIndex, profileId);
        if (!store) continue;
        const profiles = loadVehicleProfiles(store);
        runtime._playerBindings.set(playerIndex, { playerIndex, profileId, vehicleId, store });
        runtime._playerProfilesByIndex[playerIndex] = profiles;
        runtime._playerStoresByIndex[playerIndex] = store;
    }
    return true;
}

export function clearArcadePlayerProfileBindings(runtime) {
    runtime._playerProfileBindingsActive = false;
    runtime._playerBindings.clear();
    runtime._playerProfilesByIndex = Object.create(null);
    runtime._playerStoresByIndex = Object.create(null);
    runtime._runStoneStepsByPlayerIndex = Object.create(null);
}

export function loadArcadeRunVehicleProfiles(runtime, runConfig, options) {
    const store = runtime._resolveSettingsRecordStore();
    runtime._vehicleProfiles = loadVehicleProfiles(store);
    const activeProfile = runtime.getVehicleProfile();
    syncArcadeMasteryPerks(runtime._state, activeProfile);
    runtime._notifyVehicleUpgradesChanged(resolveArcadeRunStrategyUpgradeBonuses(runtime,
        options.entityManager?.humanPlayers,
        options.dailyChallenge || runConfig.dailyChallenge === true ? null : runtime._getVehicleBonuses(activeProfile),
        options.dailyChallenge === true || runConfig.dailyChallenge === true));
}
