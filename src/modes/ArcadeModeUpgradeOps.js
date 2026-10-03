import {
    normalizeArcadeUpgradeBonusMap,
    normalizeArcadeUpgradeBonuses,
    resolveArcadePlayerUpgradeBonuses,
} from './ArcadeVehicleStatOps.js';

export function resolveArcadeModePlayerUpgradeBonuses(strategy, player, fallback) {
    if (player?.isBot === true) return fallback;
    const byPlayerIndex = strategy._slotBonusesByPlayerIndex;
    if (byPlayerIndex) return byPlayerIndex[String(player?.index)] || fallback;
    return strategy._slotBonusesByVehicle
        ? (strategy._slotBonusesByVehicle[String(player?.vehicleId || '').trim()] || fallback)
        : resolveArcadePlayerUpgradeBonuses(player, strategy._slotBonuses);
}

export function applyArcadeModeUpgradeBonuses(strategy, bonuses, fallback) {
    const isNormalRun = strategy.isNormalArcadeRun();
    const byPlayerIndex = bonuses?.byPlayerIndex;
    if (byPlayerIndex && typeof byPlayerIndex === 'object' && !Array.isArray(byPlayerIndex)) {
        strategy._slotBonusesByPlayerIndex = Object.fromEntries(Object.entries(byPlayerIndex)
            .map(([index, value]) => [index, normalizeArcadeUpgradeBonuses(value, fallback, isNormalRun)]));
        strategy._slotBonusesByVehicle = null;
        strategy._slotBonuses = fallback;
        return;
    }
    strategy._slotBonusesByPlayerIndex = null;
    const byVehicleId = bonuses?.byVehicleId;
    if (byVehicleId && typeof byVehicleId === 'object' && !Array.isArray(byVehicleId)) {
        strategy._slotBonusesByVehicle = normalizeArcadeUpgradeBonusMap(byVehicleId, isNormalRun);
        strategy._slotBonuses = fallback;
        return;
    }
    strategy._slotBonusesByVehicle = null;
    strategy._slotBonuses = normalizeArcadeUpgradeBonuses(bonuses, fallback, isNormalRun);
}
