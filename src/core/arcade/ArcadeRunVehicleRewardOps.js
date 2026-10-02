import { getArcadeRunVehicleBonuses, getOrCreateProfile } from '../../state/arcade/ArcadeVehicleProfile.js';
import { bindArcadeVehicleRewards } from '../../state/arcade/ArcadeVehicleRewardBinding.js';

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

/** Build a deduplicated bonus map for the vehicle profiles flown by local humans. */
export function createArcadeVehicleUpgradeBonusMap(profiles, players, { buildOnly = false } = {}) {
    const byVehicleId = Object.create(null);
    for (const player of Array.isArray(players) ? players : []) {
        if (!player || player.isBot === true) continue;
        const vehicleId = String(player.vehicleId || '').trim();
        if (!vehicleId || Object.prototype.hasOwnProperty.call(byVehicleId, vehicleId)) continue;
        const bonuses = getArcadeRunVehicleBonuses(profiles?.[vehicleId] || null);
        byVehicleId[vehicleId] = buildOnly ? { build: bonuses.build } : bonuses;
    }
    return { byVehicleId };
}

export function createArcadePlayerUpgradeBonusMap(profilesByPlayerIndex, players, { buildOnly = false } = {}) {
    const byPlayerIndex = Object.create(null);
    for (const player of Array.isArray(players) ? players : []) {
        if (!player || player.isBot === true) continue;
        const playerIndex = Number(player.index);
        if (!Number.isInteger(playerIndex)) continue;
        const vehicleId = String(player.vehicleId || '').trim();
        const profiles = profilesByPlayerIndex?.[playerIndex];
        const bonuses = getArcadeRunVehicleBonuses(profiles?.[vehicleId] || null);
        byPlayerIndex[playerIndex] = buildOnly ? { build: bonuses.build } : bonuses;
    }
    return { byPlayerIndex };
}

export function resolveArcadeRunStrategyUpgradeBonuses(profiles, players, fallbackBonuses, disabled = false) {
    if (disabled || !profiles || !Array.isArray(players)
        || !players.some((player) => player && player.isBot !== true && String(player.vehicleId || '').trim())) {
        return fallbackBonuses;
    }
    return createArcadeVehicleUpgradeBonusMap(profiles, players);
}
