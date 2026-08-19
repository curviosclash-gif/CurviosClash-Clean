export const ENDLESS_PARCOURS_RUN_TYPE = 'endless_parcours';
export const ENDLESS_PARCOURS_COMBAT_PROFILE = 'hunt';
export const ENDLESS_PARCOURS_MODULE_LENGTH = 120;
export const ENDLESS_PARCOURS_BOT_CAPACITY = 12;
export const ENDLESS_PARCOURS_INITIAL_ACTIVE_BOTS = 0;
export const ENDLESS_PARCOURS_ACTIVE_WINDOW = Object.freeze({ behind: 2, ahead: 4 });

export const ENDLESS_PARCOURS_END_REASONS = Object.freeze({
    PLAYER_DEATH: 'ENDLESS_PLAYER_DEATH',
    VOID: 'ENDLESS_VOID',
    ABORT: 'ENDLESS_ABORT',
});

export function normalizeArcadeRunType(value) {
    return String(value || '').trim().toLowerCase() === ENDLESS_PARCOURS_RUN_TYPE
        ? ENDLESS_PARCOURS_RUN_TYPE
        : 'gauntlet';
}

export function normalizeArcadeCombatProfile(value, runType = 'gauntlet') {
    return normalizeArcadeRunType(runType) === ENDLESS_PARCOURS_RUN_TYPE
        && String(value || '').trim().toLowerCase() === ENDLESS_PARCOURS_COMBAT_PROFILE
        ? ENDLESS_PARCOURS_COMBAT_PROFILE
        : '';
}

export function isEndlessParcoursConfig(runtimeConfig = null) {
    return runtimeConfig?.arcade?.enabled === true
        && normalizeArcadeRunType(runtimeConfig?.arcade?.runType) === ENDLESS_PARCOURS_RUN_TYPE;
}

export function hashEndlessSeed(value) {
    const source = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function deriveEndlessSeed(baseSeed, domain) {
    return hashEndlessSeed(`${Math.max(1, Number(baseSeed) >>> 0)}:${String(domain || '')}`) || 1;
}

export function sampleEndlessSeed(seed) {
    let value = Number(seed) >>> 0;
    value += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function resolveEndlessDifficultyTier(elapsedCombatSeconds) {
    const elapsed = Math.max(0, Number(elapsedCombatSeconds) || 0);
    if (elapsed >= 450) return 4;
    if (elapsed >= 240) return 3;
    if (elapsed >= 90) return 2;
    return 1;
}

export function resolveEndlessThreatLevel(elapsedCombatSeconds) {
    const tier = resolveEndlessDifficultyTier(elapsedCombatSeconds);
    return ['INTRO', 'EASY', 'NORMAL', 'HARD', 'ONSLAUGHT'][tier] || 'EASY';
}

export function resolveEndlessDesiredBotCount(elapsedCombatSeconds) {
    return Math.min(
        ENDLESS_PARCOURS_BOT_CAPACITY,
        2 + Math.floor(Math.max(0, Number(elapsedCombatSeconds) || 0) / 45)
    );
}

export function resolveEndlessReinforcementDelay(elapsedCombatSeconds) {
    return Math.max(4, 10 - Math.floor(Math.max(0, Number(elapsedCombatSeconds) || 0) / 90));
}

export function calculateEndlessScore({
    maxProgressMeters = 0,
    survivalSeconds = 0,
    botKills = 0,
    completedModules = 0,
} = {}) {
    return Math.floor(Math.max(0, Number(maxProgressMeters) || 0) * 10)
        + Math.floor(Math.max(0, Number(survivalSeconds) || 0) * 5)
        + Math.max(0, Math.floor(Number(botKills) || 0)) * 250
        + Math.max(0, Math.floor(Number(completedModules) || 0)) * 100;
}
