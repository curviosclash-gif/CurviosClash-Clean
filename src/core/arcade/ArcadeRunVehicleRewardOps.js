import { getArcadeRunVehicleBonuses, getOrCreateProfile } from '../../state/arcade/ArcadeVehicleProfile.js';
import { bindArcadeVehicleRewards } from '../../state/arcade/ArcadeVehicleRewardBinding.js';

function weaponFieldsFromBuild(build) {
    return Object.freeze({
        vehicleLevel: build.level,
        mgLevel: build.mgLevel,
        rocketLevel: build.rocketLevel,
        shieldLevel: build.shieldLevel,
        selectedMachineGunId: build.selectedMachineGunId,
    });
}

export function bindArcadeRunVehicleRewards(runtime, runType = runtime?._config?.runType) {
    runtime._rewardBinding = bindArcadeVehicleRewards({
        runType,
        vehicleId: runtime?._state?.vehicleId || runtime?._activeVehicleId || 'ship1',
    });
    if (runtime._state) runtime._state.vehicleId = runtime._rewardBinding?.vehicleId || null;
    return runtime._rewardBinding;
}

export function ensureArcadeRunVehicleRewards(runtime) {
    if (!runtime?._rewardBinding && runtime?._enabled && runtime?._state) {
        return bindArcadeRunVehicleRewards(runtime, runtime._state.config?.runType || runtime._config.runType);
    }
    return runtime?._rewardBinding || null;
}

/**
 * XP binding for one local pilot: a split-screen partner in another plane levels that
 * plane; the run's own plane keeps the mastery perks of the run.
 * @returns {{ binding: object|null, ownsRunPerks: boolean }}
 */
export function resolveArcadePlayerRewardBinding(runtime, playerVehicleId = null) {
    const runBinding = ensureArcadeRunVehicleRewards(runtime);
    const ownVehicleId = String(playerVehicleId || '').trim();
    if (!runBinding || !ownVehicleId || ownVehicleId === runBinding.vehicleId) {
        return { binding: runBinding, ownsRunPerks: true };
    }
    return { binding: { ...runBinding, vehicleId: ownVehicleId }, ownsRunPerks: false };
}

export function getArcadeRunVehicleId(runtime) {
    return ensureArcadeRunVehicleRewards(runtime)?.vehicleId || runtime?._activeVehicleId || null;
}

export function getArcadeRunVehicleProfile(runtime) {
    const vehicleId = getArcadeRunVehicleId(runtime);
    if (!runtime?._vehicleProfiles || !vehicleId) return null;
    return getOrCreateProfile(runtime._vehicleProfiles, vehicleId);
}

/** Resolve one vehicle's build against its settings store and freeze the stone pool for this run. */
export function getArcadeRunVehicleBonusesForRun(runtime, profile) {
    const state = runtime?._state;
    const runId = state && !state.finishedAtIso ? String(state.runId || '') : '';
    const kept = runtime?._runStoneSteps;
    const sameRun = !!runId && kept?.runId === runId && kept.vehicleId === String(profile?.vehicleId || '');
    const bonuses = getArcadeRunVehicleBonuses(
        profile,
        runtime?._resolveSettingsRecordStore?.() || null,
        sameRun ? kept.stoneSteps : null,
        sameRun ? kept.weapons : null,
    );
    if (runId && bonuses.build) {
        runtime._runStoneSteps = {
            runId,
            vehicleId: bonuses.build.vehicleId,
            stoneSteps: bonuses.build.stoneSteps,
            weapons: weaponFieldsFromBuild(bonuses.build),
        };
    }
    return bonuses;
}

/**
 * Build a deduplicated bonus map for the vehicle profiles flown by local humans.
 * @param {Record<string, any>} profiles
 * @param {any[]} players
 * @param {{ buildOnly?: boolean, store?: any, stoneStepsByVehicleId?: Record<string, any>, weaponFieldsByVehicleId?: Record<string, any> }} [options]
 */
export function createArcadeVehicleUpgradeBonusMap(profiles, players, {
    buildOnly = false,
    store = null,
    stoneStepsByVehicleId = null,
    weaponFieldsByVehicleId = null,
} = {}) {
    const byVehicleId = Object.create(null);
    for (const player of Array.isArray(players) ? players : []) {
        if (!player || player.isBot === true) continue;
        const vehicleId = String(player.vehicleId || '').trim();
        if (!vehicleId || Object.prototype.hasOwnProperty.call(byVehicleId, vehicleId)) continue;
        const profile = profiles ? (profiles[vehicleId] || getOrCreateProfile(profiles, vehicleId)) : null;
        const bonuses = getArcadeRunVehicleBonuses(
            profile,
            store,
            stoneStepsByVehicleId?.[vehicleId] || null,
            weaponFieldsByVehicleId?.[vehicleId] || null,
        );
        if (bonuses.build && stoneStepsByVehicleId && !stoneStepsByVehicleId[vehicleId]) {
            stoneStepsByVehicleId[vehicleId] = bonuses.build.stoneSteps;
        }
        if (bonuses.build && weaponFieldsByVehicleId && !weaponFieldsByVehicleId[vehicleId]) {
            weaponFieldsByVehicleId[vehicleId] = weaponFieldsFromBuild(bonuses.build);
        }
        byVehicleId[vehicleId] = buildOnly ? { build: bonuses.build } : bonuses;
    }
    return { byVehicleId };
}

/**
 * Build bonuses independently for each local player, even when profiles share a vehicle ID.
 * @param {Record<number, Record<string, any>>} profilesByPlayerIndex
 * @param {any[]} players
 * @param {{ buildOnly?: boolean, storesByPlayerIndex?: Record<number, any>, stoneStepsByPlayerIndex?: Record<number, {vehicleId: string, stoneSteps: any, weapons?: any}> }} [options]
 */
export function createArcadePlayerUpgradeBonusMap(profilesByPlayerIndex, players, {
    buildOnly = false,
    storesByPlayerIndex = null,
    stoneStepsByPlayerIndex = null,
} = {}) {
    const byPlayerIndex = Object.create(null);
    for (const player of Array.isArray(players) ? players : []) {
        if (!player || player.isBot === true) continue;
        const playerIndex = Number(player.index);
        if (!Number.isInteger(playerIndex)) continue;
        const vehicleId = String(player.vehicleId || '').trim();
        const profiles = profilesByPlayerIndex?.[playerIndex];
        const bonuses = getArcadeRunVehicleBonuses(
            profiles?.[vehicleId] || null,
            storesByPlayerIndex?.[playerIndex] || null,
            stoneStepsByPlayerIndex?.[playerIndex]?.vehicleId === vehicleId
                ? stoneStepsByPlayerIndex[playerIndex].stoneSteps
                : null,
            stoneStepsByPlayerIndex?.[playerIndex]?.vehicleId === vehicleId
                ? stoneStepsByPlayerIndex[playerIndex].weapons
                : null,
        );
        if (bonuses.build && stoneStepsByPlayerIndex
            && !stoneStepsByPlayerIndex[playerIndex]) {
            stoneStepsByPlayerIndex[playerIndex] = {
                vehicleId: bonuses.build.vehicleId,
                stoneSteps: bonuses.build.stoneSteps,
                weapons: weaponFieldsFromBuild(bonuses.build),
            };
        }
        byPlayerIndex[playerIndex] = buildOnly ? { build: bonuses.build } : bonuses;
    }
    return { byPlayerIndex };
}

export function resolveArcadeRunStrategyUpgradeBonuses(runtime, players, fallbackBonuses, disabled = false) {
    if (disabled) return fallbackBonuses;
    if (runtime?._playerProfileBindingsActive) {
        return createArcadePlayerUpgradeBonusMap(runtime._playerProfilesByIndex, players, {
            storesByPlayerIndex: runtime._playerStoresByIndex,
            stoneStepsByPlayerIndex: runtime._runStoneStepsByPlayerIndex,
        });
    }
    const profiles = runtime?._vehicleProfiles;
    if (!profiles || !Array.isArray(players)
        || !players.some((player) => player && player.isBot !== true && String(player.vehicleId || '').trim())) {
        return fallbackBonuses;
    }
    return createArcadeVehicleUpgradeBonusMap(profiles, players, {
        store: runtime?._resolveSettingsRecordStore?.() || null,
        stoneStepsByVehicleId: runtime?._runVehicleStoneStepsById || null,
        weaponFieldsByVehicleId: runtime?._runVehicleWeaponsById || null,
    });
}
