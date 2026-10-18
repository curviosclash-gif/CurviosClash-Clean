import { normalizeEndlessSeedMode } from './EndlessParcoursSeedContract.js';
import { resolveArcadeVehicleActiveStats } from './ArcadeVehicleActiveStatsContract.js';
import { resolveArcadeLevelRange } from './ArcadeHangarRulesContract.js';
import { GAUNTLET_FREE_RULE_VERSION, hasCustomArcadeScoreSettings } from './ArcadeRunSettingsContract.js';
import { normalizePortalChainId } from './PortalChainContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from './EndlessParcoursWaveContract.js';
import { ARENA_WAVES_RULE_VERSION } from './ArenaWavesContract.js';

export const ARCADE_DIFFICULTY_STORAGE_KEY = 'cuviosclash.arcade-difficulty-progress.v1';
export const ARCADE_DIFFICULTY_SCHEMA_VERSION = 'arcade-difficulty-progress.v1';
// intermissionHealFactor scales the heal between sectors, aggressionBonus is added to the authored
// bot aggressiveness. Albtraum shares the HARD AI with Hart and differs through these two.
export const ARCADE_DIFFICULTY_TIERS = Object.freeze([
    Object.freeze({ id: 'normal', label: 'Normal', ai: 'NORMAL', hp: 1, damage: 1, intermissionHealFactor: 1, aggressionBonus: 0 }),
    Object.freeze({ id: 'hard', label: 'Hart', ai: 'HARD', hp: 1.1, damage: 1.05, intermissionHealFactor: 1, aggressionBonus: 0 }),
    Object.freeze({ id: 'nightmare', label: 'Albtraum', ai: 'HARD', hp: 1.2, damage: 1.1, intermissionHealFactor: 0.6, aggressionBonus: 0.08 }),
]);
export const ARCADE_HIGHEST_DIFFICULTY_TIER_ID = 'nightmare';
const BUILD_RUNS = new Set(['gauntlet', 'endless_parcours', 'arena_waves', 'five_portals', 'hangar_test', 'hunt_parcours']);

/** Whether a run flies the pilot's profile build (stones, size, weapons); Daily and factory-size runs never do. */
export function arcadeRunUsesProfileBuild(runType, { dailyChallenge = false } = {}) {
    return dailyChallenge !== true && BUILD_RUNS.has(String(runType || ''));
}

export function normalizeArcadeDifficultyTier(value) {
    return ARCADE_DIFFICULTY_TIERS.some((tier) => tier.id === value) ? value : 'normal';
}

export function normalizeArcadeDifficultyProgress(value) {
    const input = value?.schemaVersion === ARCADE_DIFFICULTY_SCHEMA_VERSION ? value : {};
    const desired = new Set(Array.isArray(input.unlockedTierIds) ? input.unlockedTierIds : []);
    const unlockedTierIds = ['normal'];
    if (desired.has('hard')) unlockedTierIds.push('hard');
    if (desired.has('hard') && desired.has('nightmare')) unlockedTierIds.push('nightmare');
    return { schemaVersion: ARCADE_DIFFICULTY_SCHEMA_VERSION, unlockedTierIds, unlockedAt: { ...input.unlockedAt }, updatedAt: String(input.updatedAt || '') };
}

/** A failed read locks progression writes; it must never overwrite a player's unlocks. */
export function loadArcadeDifficultyProgress(store) {
    const read = store?.readJsonRecordResult?.(ARCADE_DIFFICULTY_STORAGE_KEY);
    if (read?.status === 'missing') return { status: 'created', progress: normalizeArcadeDifficultyProgress(null) };
    if (read?.status !== 'found' || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)
        || read.value.schemaVersion !== ARCADE_DIFFICULTY_SCHEMA_VERSION) {
        return { status: 'unavailable', progress: normalizeArcadeDifficultyProgress(null) };
    }
    return { status: 'ok', progress: normalizeArcadeDifficultyProgress(read.value) };
}

export function resolveArcadeRunTier(requested, progress, { runType = 'gauntlet', dailyChallenge = false } = {}) {
    if (runType === 'five_portals') return 'any';
    if (dailyChallenge || runType === 'hangar_test' || !BUILD_RUNS.has(runType)) return 'normal';
    const desired = normalizeArcadeDifficultyTier(requested);
    return normalizeArcadeDifficultyProgress(progress).unlockedTierIds.includes(desired) ? desired : 'normal';
}

/** Weighted effective ratios to the factory Star-Cruiser; level itself is deliberately absent. */
export function resolveArcadeCombatValue(stats) {
    const reference = resolveArcadeVehicleActiveStats('ship5', null);
    const damageKey = stats?.mgDamagePct === undefined ? 'damagePct' : 'mgDamagePct';
    const rocketKey = stats?.rocketDamagePct === undefined ? 'damagePct' : 'rocketDamagePct';
    const weights = [['maxHpPct', 1], ['itemCapacity', 0.5], ['rocketCapacity', 1], ['speedPct', 1.5], ['turnPct', 1.5], [damageKey, 1], [rocketKey, 1], ['shieldPct', 0.5]];
    let total = 0;
    for (const [key, weight] of weights) {
        const base = Number(reference[key] ?? reference.damagePct) || 100;
        const value = Number(stats?.[key] ?? base);
        total += (Number.isFinite(value) ? Math.max(0, value) / base : 1) * Number(weight);
    }
    return total / 8;
}

export function resolveArcadeBotStrength(stats, tierId = 'normal') {
    const tier = ARCADE_DIFFICULTY_TIERS.find((item) => item.id === tierId) || ARCADE_DIFFICULTY_TIERS[0];
    const combatValue = resolveArcadeCombatValue(stats);
    const follow = Math.min(1e6, Math.max(0.5, 1 + 0.5 * (combatValue - 1)));
    return Object.freeze({ combatValue, follow, hpFactor: follow * tier.hp, damageFactor: follow * tier.damage, ai: tier.ai, tierId: tier.id });
}

export function createArcadeRankContext({ runId, runType, vehicleId, profile, stoneSteps, tierId = 'normal', dailyChallenge = false, companionCount = 0, runSettings = null, portalChainId = '' }) {
    const vehicleLevel = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(profile?.level) || 1)));
    const stats = resolveArcadeVehicleActiveStats(vehicleId, profile, stoneSteps);
    // strengthScaled: the squad follows the player vehicle. ranked additionally lets the run into
    // the leaderboard and tier unlocks - not with companions, whose help would skew the boards,
    // and not with score settings away from the defaults (more sectors, a higher multiplier cap).
    const strengthScaled = BUILD_RUNS.has(runType) && runType !== 'hangar_test' && !dailyChallenge;
    const companions = Number(companionCount) > 0;
    const customSettings = hasCustomArcadeScoreSettings(runType, runSettings);
    return Object.freeze({
        runId: String(runId || ''), runType, vehicleId, vehicleLevel, levelRange: resolveArcadeLevelRange(vehicleLevel),
        // Preserve the model that the caller actually supplied. Missing/legacy settings must not
        // be silently promoted to the current score model by this rank-context boundary.
        scoreModel: typeof runSettings?.scoreModel === 'string' ? runSettings.scoreModel.trim() : '',
        ...(runType === 'endless_parcours' ? { endlessRuleVersion: ENDLESS_PARCOURS_RULE_VERSION,
            endlessSeedMode: normalizeEndlessSeedMode(runSettings?.endlessSeedMode), endlessSeed: Number(runSettings?.seed) || 0 } : {}),
        ...(runType === 'arena_waves' ? { arenaWavesRuleVersion: ARENA_WAVES_RULE_VERSION } : {}),
        ...(runType === 'gauntlet' && !dailyChallenge && !runSettings?.journeyStageId ? { gauntletRuleVersion: GAUNTLET_FREE_RULE_VERSION } : {}),
        tierId: runType === 'five_portals' ? 'any' : tierId,
        portalChainId: runType === 'five_portals' ? normalizePortalChainId(portalChainId) : '',
        strengthScaled,
        companions,
        customSettings,
        ranked: strengthScaled && !companions && !customSettings,
        botStrength: resolveArcadeBotStrength(stats, tierId),
    });
}

export function evaluateArcadeDifficultyUnlock(progress, context, result, nowMs = Date.now()) {
    const current = normalizeArcadeDifficultyProgress(progress);
    if (!context?.ranked || !['gauntlet', 'arena_waves', 'endless_parcours'].includes(context.runType)) return current;
    const qualifies = context.runType === 'gauntlet'
        ? result?.succeeded === true && Number(result.completedSectors) >= 5
        : context.runType === 'arena_waves'
            ? Number(result?.completedWaveCount) >= 8
            : Number(result?.lastCompletedWave ?? (Array.isArray(result?.completedWaves) ? Math.max(0, ...result.completedWaves) : result?.completedWaves)) >= 5;
    const index = ARCADE_DIFFICULTY_TIERS.findIndex((tier) => tier.id === context.tierId);
    const next = ARCADE_DIFFICULTY_TIERS[index + 1]?.id;
    if (!qualifies || index < 0 || !next || !current.unlockedTierIds.includes(context.tierId) || current.unlockedTierIds.includes(next)) return current;
    const timestamp = new Date(nowMs).toISOString();
    return { ...current, unlockedTierIds: [...current.unlockedTierIds, next], unlockedAt: { ...current.unlockedAt, [next]: timestamp }, updatedAt: timestamp };
}
