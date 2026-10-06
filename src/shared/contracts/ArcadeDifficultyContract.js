import { resolveArcadeVehicleActiveStats } from './ArcadeVehicleActiveStatsContract.js';
import { resolveArcadeLevelRange } from './ArcadeHangarRulesContract.js';

export const ARCADE_DIFFICULTY_STORAGE_KEY = 'cuviosclash.arcade-difficulty-progress.v1';
export const ARCADE_DIFFICULTY_SCHEMA_VERSION = 'arcade-difficulty-progress.v1';
export const ARCADE_DIFFICULTY_TIERS = Object.freeze([
    Object.freeze({ id: 'normal', label: 'Normal', ai: 'NORMAL', hp: 1, damage: 1 }),
    Object.freeze({ id: 'hard', label: 'Hart', ai: 'HARD', hp: 1.1, damage: 1.05 }),
    Object.freeze({ id: 'nightmare', label: 'Albtraum', ai: 'HARD', hp: 1.2, damage: 1.1 }),
]);
export const ARCADE_HIGHEST_DIFFICULTY_TIER_ID = 'nightmare';
const BUILD_RUNS = new Set(['gauntlet', 'endless_parcours', 'arena_waves', 'five_portals', 'hangar_test']);

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

export function createArcadeRankContext({ runId, runType, vehicleId, profile, stoneSteps, tierId = 'normal', dailyChallenge = false, companionCount = 0 }) {
    const vehicleLevel = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(profile?.level) || 1)));
    const stats = resolveArcadeVehicleActiveStats(vehicleId, profile, stoneSteps);
    // strengthScaled: the squad follows the player vehicle. ranked additionally lets the run into
    // the leaderboard and tier unlocks - not with companions, whose help would skew the boards.
    const strengthScaled = BUILD_RUNS.has(runType) && runType !== 'hangar_test' && !dailyChallenge;
    return Object.freeze({
        runId: String(runId || ''), runType, vehicleId, vehicleLevel, levelRange: resolveArcadeLevelRange(vehicleLevel),
        tierId: runType === 'five_portals' ? 'any' : tierId,
        strengthScaled,
        ranked: strengthScaled && !(Number(companionCount) > 0),
        botStrength: resolveArcadeBotStrength(stats, tierId),
    });
}

export function evaluateArcadeDifficultyUnlock(progress, context, result, nowMs = Date.now()) {
    const current = normalizeArcadeDifficultyProgress(progress);
    if (!context?.ranked || !['gauntlet', 'arena_waves', 'endless_parcours'].includes(context.runType)) return current;
    const qualifies = context.runType === 'gauntlet'
        ? result?.succeeded === true && Number(result.completedSectors) >= 5
        : Number(result?.lastCompletedWave ?? (Array.isArray(result?.completedWaves) ? Math.max(0, ...result.completedWaves) : result?.completedWaves)) >= (context.runType === 'arena_waves' ? 8 : 5);
    const index = ARCADE_DIFFICULTY_TIERS.findIndex((tier) => tier.id === context.tierId);
    const next = ARCADE_DIFFICULTY_TIERS[index + 1]?.id;
    if (!qualifies || index < 0 || !next || !current.unlockedTierIds.includes(context.tierId) || current.unlockedTierIds.includes(next)) return current;
    const timestamp = new Date(nowMs).toISOString();
    return { ...current, unlockedTierIds: [...current.unlockedTierIds, next], unlockedAt: { ...current.unlockedAt, [next]: timestamp }, updatedAt: timestamp };
}
