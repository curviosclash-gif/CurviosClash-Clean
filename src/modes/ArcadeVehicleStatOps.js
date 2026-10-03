// ============================================
// ArcadeVehicleStatOps.js - Paket 1: vehicle-based stat resolution for ArcadeModeStrategy.
// ArcadeModeStrategy.js is at the max-lines cap and must not grow, so all new
// vehicle-balance math lives here; the strategy only calls these helpers.
// Paket 2a: the size build of the human's vehicle (resolveArcadeVehicleBuildStats) joins in.
// ============================================

import {
    clampArcadeStorageCapacity,
    clampArcadeVehicleSpeedMultiplier,
    resolveArcadeStatCapPct,
    resolveArcadeVehicleBaseStats,
} from '../shared/contracts/ArcadeVehicleBalanceContract.js';
import { normalizeArcadeSizeProfileFields } from '../shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadeVehicleActiveStats } from '../shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { normalizeArcadePartSizes } from '../shared/contracts/ArcadeVehicleSizeContract.js';

const NORMAL_ARCADE_RUN_TYPES = Object.freeze(['gauntlet', 'endless_parcours', 'five_portals', 'arena_waves']);

// Tägliche Challenge und Waffenrennen behalten ihre heutigen festen Startbedingungen:
// gleicher Deckel wie vor Paket 1 (Grundwert 100 % + 50 Prozentpunkte Hangar-Bonus).
const LEGACY_STAT_CAP_BONUS_PCT = 50;
const NULL_UPGRADE_BONUSES = Object.freeze({ turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 0 });

/**
 * "Normale Arcade-Runs" (gauntlet, endless_parcours, five_portals, arena_waves) bekommen
 * die Fahrzeugtabelle; tägliche Challenge und Waffenrennen bleiben unverändert.
 * @param {string} runType
 * @param {boolean} isDailyChallenge
 */
export function isNormalArcadeRunType(runType, isDailyChallenge) {
    return NORMAL_ARCADE_RUN_TYPES.includes(runType) && isDailyChallenge !== true;
}

/** @param {unknown} value */
function finiteOrZero(value) {
    return Number.isFinite(value) ? /** @type {number} */ (value) : 0;
}

/**
 * Normalisiert die Run-Start-Boni für ArcadeModeStrategy.applyVehicleUpgrades. In normalen Runs
 * rechnet der Größen-Build (bonuses.build, Profilfelder) mit: Tempo und Wendigkeit fließen als
 * Prozentpunkte über dem Tabellenwert in die Hangar-Boni (die Obergrenze klemmt danach die Summe),
 * der übrige Wertesatz liegt als `build`, die Gruppen-Größen als `partSizes` bereit - aus denselben
 * normalisierten Profilfeldern wie der Wertesatz, damit Trefferzone und Werte nie auseinanderlaufen
 * (gesperrte Werkstatt oder mehr belegte als gekaufte Schritte: beide Werksgröße). `otherVehicle`
 * sind dieselben Hangar-Boni ohne Größen-Build für einen Menschen in einem anderen Fahrzeug.
 * @param {any} bonuses
 * @param {any} fallback
 * @param {boolean} isNormalRun
 */
export function normalizeArcadeUpgradeBonuses(bonuses, fallback, isNormalRun) {
    if (!bonuses || typeof bonuses !== 'object') return fallback;
    const source = isNormalRun && bonuses.build && typeof bonuses.build === 'object' ? bonuses.build : null;
    const vehicleId = String(source?.vehicleId || '');
    // Paket 3: the stones of the pool join as extra steps; the hitbox below keeps the profile sizes.
    const build = source ? resolveArcadeVehicleActiveStats(vehicleId, source, source.stoneSteps) : null;
    const base = build ? resolveArcadeVehicleBaseStats(vehicleId) : null;
    const slots = {
        turningBonusPct: finiteOrZero(bonuses.turningBonusPct),
        speedBonusPct: finiteOrZero(bonuses.speedBonusPct),
        maxHpBonus: finiteOrZero(bonuses.maxHpBonus),
    };
    const otherVehicle = Object.freeze({ ...slots, build: null, buildVehicleId: '', partSizes: null });
    if (!build || !base || !source) return otherVehicle;
    return Object.freeze({
        ...slots,
        turningBonusPct: slots.turningBonusPct + build.turnPct - base.turnPct,
        speedBonusPct: slots.speedBonusPct + build.speedPct - base.speedPct,
        build,
        buildVehicleId: vehicleId.toLowerCase(),
        partSizes: normalizeArcadeSizeProfileFields(source).partSizes,
        otherVehicle,
    });
}

/** Normalize the per-vehicle profile lookup once when a run starts, never on the update path. */
export function normalizeArcadeUpgradeBonusMap(byVehicleId, isNormalRun) {
    const normalized = Object.create(null);
    for (const [vehicleId, bonuses] of Object.entries(byVehicleId || {})) {
        const key = String(vehicleId || '').trim();
        if (key) normalized[key] = normalizeArcadeUpgradeBonuses(bonuses, NULL_UPGRADE_BONUSES, isNormalRun);
    }
    return Object.freeze(normalized);
}

/**
 * Boni genau dieses Menschen: der ganze Größen-Build (auch Tempo und Wendigkeit) gilt nur im
 * Fahrzeug des Profils; ein anderes Fahrzeug (Splitscreen) bekommt `otherVehicle`. Ohne Allokation,
 * weil getTurnRateMultiplier das jedes Bild fragt.
 * @param {any} player
 * @param {any} bonuses
 */
export function resolveArcadePlayerUpgradeBonuses(player, bonuses) {
    return bonuses?.otherVehicle && !resolveArcadePlayerBuild(player, bonuses) ? bonuses.otherVehicle : bonuses;
}

/**
 * Build-Wertesatz für genau diesen Spieler: nur wenn er das Fahrzeug des Profils fliegt,
 * sonst null (Werkswerte seines eigenen Fahrzeugs).
 * @param {any} player
 * @param {any} bonuses
 */
export function resolveArcadePlayerBuild(player, bonuses) {
    const build = bonuses?.build || null;
    return build && bonuses.buildVehicleId === String(player?.vehicleId || '').toLowerCase() ? build : null;
}

/**
 * Setzt in normalen Runs die Größen und Build-Multiplikatoren an den Spieler. Menschen bekommen
 * ihren Build, Bots die Werksgröße und 1. Andere Runs lassen die Felder unberührt, damit Systeme
 * außerhalb normaler Arcade-Runs exakt wie bisher rechnen. Paket 2b liest arcadePartSizes.
 * @param {any} player
 * @param {any} bonuses
 * @param {boolean} isNormalRun
 */
export function applyArcadeBuildToPlayer(player, bonuses, isNormalRun) {
    if (!player || !isNormalRun) return;
    const build = resolveArcadePlayerBuild(player, bonuses);
    const factor = (/** @type {number} */ pct) => (build ? pct / 100 : 1);
    player.arcadePartSizes = normalizeArcadePartSizes(build ? bonuses.partSizes : null);
    // Without a build the mode's own regen delay stays in charge (bots, like before).
    player.arcadeRegenDelay = build ? build.regenDelay : undefined;
    player.arcadeDamageMultiplier = factor(build?.damagePct);
    player.arcadeRangeMultiplier = factor(build?.rangePct);
    player.arcadeRollMultiplier = factor(build?.rollPct);
    // The engine size resizes the boost tank; keep its fill level so a fresh spawn starts full.
    const previousBoostFactor = Number(player.arcadeBoostDurationMultiplier) > 0 ? Number(player.arcadeBoostDurationMultiplier) : 1;
    player.arcadeBoostDurationMultiplier = factor(build?.boostDurationPct);
    if (Number.isFinite(player.boostCharge)) player.boostCharge *= player.arcadeBoostDurationMultiplier / previousBoostFactor;
    player.arcadeShieldMultiplier = factor(build?.shieldPct);
}

/**
 * Leben aus Modus-Basis (heute 100 in Gauntlet wie im Hunt-Profil) und Fahrzeugtabelle;
 * ein Größen-Build ersetzt den Tabellenwert durch seinen Lebenswert (maxHpPct).
 * @param {string} vehicleId
 * @param {number} modeBaseMaxHp
 * @param {boolean} isNormalRun
 * @param {number} [buildMaxHpPct]
 */
export function resolveArcadeVehicleMaxHp(vehicleId, modeBaseMaxHp, isNormalRun, buildMaxHpPct) {
    if (!isNormalRun) return modeBaseMaxHp;
    const basePct = Number.isFinite(buildMaxHpPct)
        ? /** @type {number} */ (buildMaxHpPct)
        : resolveArcadeVehicleBaseStats(vehicleId).maxHpPct;
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
 * Setzt beim Spawn getrennte Item-/Raketen-Lagergrößen (mit nutzbaren Lagerstufen des Builds),
 * die Build-Felder am Spieler und cacht den Wendigkeits-Tabellenwert (player._arcadeTurnPct),
 * den getTurnRateMultiplier pro Bild liest (nur normale Runs).
 * @param {any} player
 * @param {boolean} isNormalRun
 * @param {any} [bonuses] Boni dieses Spielers (Bots: ohne Build)
 */
export function applyArcadeVehicleSpawnCapacities(player, isNormalRun, bonuses = null) {
    if (!player || !isNormalRun) return;
    applyArcadeBuildToPlayer(player, bonuses, isNormalRun);
    const base = resolveArcadeVehicleBaseStats(player.vehicleId);
    const build = resolveArcadePlayerBuild(player, bonuses);
    player.itemCapacity = clampArcadeStorageCapacity(build ? build.itemCapacity : base.itemCapacity);
    player.rocketCapacity = clampArcadeStorageCapacity(build ? build.rocketCapacity : base.rocketCapacity);
    player._arcadeTurnPct = base.turnPct;
}

/**
 * Gauntlet-Zweig von ArcadeModeStrategy.resetPlayerHealth (kein Hunt-Kampfprofil).
 * Lebt hier statt in der Strategie, weil ArcadeModeStrategy.js an der max-lines-Grenze liegt.
 * @param {any} bonuses Boni dieses Spielers ({ maxHpBonus, build })
 */
export function applyArcadeGauntletHealthReset(
    player, vehicleId, modeBaseMaxHp, isNormalRun, bonuses, runRewardMaxHpBonus, hpBonusCapPct, defaultShieldHp
) {
    if (!player) return null;
    const baseMaxHp = resolveArcadeVehicleMaxHp(vehicleId, modeBaseMaxHp, isNormalRun, resolveArcadePlayerBuild(player, bonuses)?.maxHpPct);
    const hpBonus = Math.min(baseMaxHp * (hpBonusCapPct / 100), Math.max(0, finiteOrZero(bonuses?.maxHpBonus)));
    player.maxHp = baseMaxHp + hpBonus + runRewardMaxHpBonus;
    player.hp = player.maxHp;
    player.maxShieldHp = defaultShieldHp * (Number(player.arcadeShieldMultiplier) || 1);
    player.shieldHP = player.hasShield ? player.maxShieldHp : 0;
    player.lastDamageTimestamp = -Infinity;
    player.shieldHitFeedback = 0;
    return player;
}
