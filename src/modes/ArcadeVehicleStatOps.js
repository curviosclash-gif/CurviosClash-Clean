// ============================================
// ArcadeVehicleStatOps.js - Paket 1: vehicle-based stat resolution for ArcadeModeStrategy.
// ArcadeModeStrategy.js is at the max-lines cap and must not grow, so all new
// vehicle-balance math lives here; the strategy only calls these helpers.
// ============================================

import {
    clampArcadeStorageCapacity,
    clampArcadeVehicleSpeedMultiplier,
    resolveArcadeStatCapPct,
    resolveArcadeVehicleBaseStats,
} from '../shared/contracts/ArcadeVehicleBalanceContract.js';

const NORMAL_ARCADE_RUN_TYPES = Object.freeze(['gauntlet', 'endless_parcours', 'five_portals', 'arena_waves']);

// Tägliche Challenge und Waffenrennen behalten ihre heutigen festen Startbedingungen:
// gleicher Deckel wie vor Paket 1 (Grundwert 100 % + 50 Prozentpunkte Hangar-Bonus).
const LEGACY_STAT_CAP_BONUS_PCT = 50;

/**
 * "Normale Arcade-Runs" (gauntlet, endless_parcours, five_portals, arena_waves) bekommen
 * die Fahrzeugtabelle; tägliche Challenge und Waffenrennen bleiben unverändert.
 * @param {string} runType
 * @param {boolean} isDailyChallenge
 */
export function isNormalArcadeRunType(runType, isDailyChallenge) {
    return NORMAL_ARCADE_RUN_TYPES.includes(runType) && isDailyChallenge !== true;
}

/**
 * Leben aus Modus-Basis (heute 100 in Gauntlet wie im Hunt-Profil) und Fahrzeugtabelle.
 * @param {string} vehicleId
 * @param {number} modeBaseMaxHp
 * @param {boolean} isNormalRun
 */
export function resolveArcadeVehicleMaxHp(vehicleId, modeBaseMaxHp, isNormalRun) {
    if (!isNormalRun) return modeBaseMaxHp;
    const basePct = resolveArcadeVehicleBaseStats(vehicleId).maxHpPct;
    return Math.round(modeBaseMaxHp * basePct / 100);
}

/**
 * Tempo- bzw. Wendigkeitsprozent inklusive Hangar-Bonus, geklemmt auf die Fahrzeug-Obergrenze
 * (Grundwert + 100 Punkte). Außerhalb normaler Runs bleibt der alte flache Deckel (100 % + 50).
 * @param {string} vehicleId
 * @param {'speedPct'|'turnPct'} statKey
 * @param {number} bonusPct
 * @param {boolean} isNormalRun
 * @param {number} [cachedBasePct] beim Spawn gecachter Tabellenwert (spart die Tabellensuche pro Bild)
 */
export function resolveArcadeVehicleStatPct(vehicleId, statKey, bonusPct, isNormalRun, cachedBasePct) {
    const safeBonusPct = Number.isFinite(bonusPct) ? bonusPct : 0;
    if (!isNormalRun) {
        return 100 + Math.max(0, Math.min(LEGACY_STAT_CAP_BONUS_PCT, safeBonusPct));
    }
    const basePct = Number.isFinite(cachedBasePct) ? cachedBasePct : resolveArcadeVehicleBaseStats(vehicleId)[statKey];
    return Math.max(0, Math.min(resolveArcadeStatCapPct(basePct), basePct + safeBonusPct));
}

/** Tempo-Gesamtfaktor; in normalen Runs auf die Fahrzeug-Obergrenze geklemmt (siehe Contract). */
export function capArcadeVehicleSpeedMultiplier(vehicleId, multiplier, isNormalRun) {
    return isNormalRun ? clampArcadeVehicleSpeedMultiplier(vehicleId, multiplier) : multiplier;
}

/**
 * Setzt beim Spawn getrennte Item-/Raketen-Lagergrößen und cacht den Wendigkeits-Tabellenwert
 * (player._arcadeTurnPct), den getTurnRateMultiplier pro Bild liest (nur normale Runs).
 */
export function applyArcadeVehicleSpawnCapacities(player, isNormalRun) {
    if (!player || !isNormalRun) return;
    const base = resolveArcadeVehicleBaseStats(player.vehicleId);
    player.itemCapacity = clampArcadeStorageCapacity(base.itemCapacity);
    player.rocketCapacity = clampArcadeStorageCapacity(base.rocketCapacity);
    player._arcadeTurnPct = base.turnPct;
}

/**
 * Gauntlet-Zweig von ArcadeModeStrategy.resetPlayerHealth (kein Hunt-Kampfprofil).
 * Lebt hier statt in der Strategie, weil ArcadeModeStrategy.js an der max-lines-Grenze liegt.
 */
export function applyArcadeGauntletHealthReset(
    player, vehicleId, modeBaseMaxHp, isNormalRun, hangarMaxHpBonus, runRewardMaxHpBonus, hpBonusCapPct, defaultShieldHp
) {
    if (!player) return null;
    const baseMaxHp = resolveArcadeVehicleMaxHp(vehicleId, modeBaseMaxHp, isNormalRun);
    const hpBonus = Math.min(baseMaxHp * (hpBonusCapPct / 100), Math.max(0, hangarMaxHpBonus));
    player.maxHp = baseMaxHp + hpBonus + runRewardMaxHpBonus;
    player.hp = player.maxHp;
    player.maxShieldHp = defaultShieldHp;
    player.shieldHP = player.hasShield ? defaultShieldHp : 0;
    player.lastDamageTimestamp = -Infinity;
    player.shieldHitFeedback = 0;
    return player;
}
