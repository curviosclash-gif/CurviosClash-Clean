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

/**
 * `bonusScore` sammelt alles, was ein Lauf zusaetzlich verdient: Torbelohnung,
 * Serienzuschlag, abgeschuettelte Verfolger und Anfuehrer-Abschuesse. Ohne
 * dieses Feld bleibt die Formel wortgleich zur ersten Fassung.
 *
 * @param {{ maxProgressMeters?: unknown, survivalSeconds?: unknown, botKills?: unknown, completedModules?: unknown, bonusScore?: unknown }} [source]
 * @returns {number}
 */
export function calculateEndlessScore({
    maxProgressMeters = 0,
    survivalSeconds = 0,
    botKills = 0,
    completedModules = 0,
    bonusScore = 0,
} = {}) {
    return Math.floor(Math.max(0, Number(maxProgressMeters) || 0) * 10)
        + Math.floor(Math.max(0, Number(survivalSeconds) || 0) * 5)
        + Math.max(0, Math.floor(Number(botKills) || 0)) * 250
        + Math.max(0, Math.floor(Number(completedModules) || 0)) * 100
        + Math.max(0, Math.floor(Number(bonusScore) || 0));
}

export const ENDLESS_PARCOURS_MILESTONES = Object.freeze([
    Object.freeze({ id: 'distance-1000', label: '1000 m ueberlebt', metric: 'distanceMeters', threshold: 1000 }),
    Object.freeze({ id: 'distance-2500', label: '2500 m ueberlebt', metric: 'distanceMeters', threshold: 2500 }),
    Object.freeze({ id: 'distance-5000', label: '5000 m ueberlebt', metric: 'distanceMeters', threshold: 5000 }),
    Object.freeze({ id: 'survival-300', label: '5 Minuten gejagt', metric: 'survivalSeconds', threshold: 300 }),
    Object.freeze({ id: 'survival-600', label: '10 Minuten gejagt', metric: 'survivalSeconds', threshold: 600 }),
    Object.freeze({ id: 'kills-10', label: '10 Jaeger erledigt', metric: 'botKills', threshold: 10 }),
    Object.freeze({ id: 'kills-25', label: '25 Jaeger erledigt', metric: 'botKills', threshold: 25 }),
    Object.freeze({ id: 'elite-1', label: 'Ersten Anführer bezwungen', metric: 'eliteKills', threshold: 1 }),
    Object.freeze({ id: 'streak-5', label: 'Serie x5 gehalten', metric: 'bestStreak', threshold: 5 }),
    Object.freeze({ id: 'score-50000', label: '50000 Punkte', metric: 'score', threshold: 50000 }),
]);

/**
 * Liefert die IDs der Meilensteine, die dieser Lauf erreicht hat.
 *
 * @param {Record<string, unknown> | null} [summary]
 * @returns {string[]}
 */
export function resolveEndlessMilestones(summary = null) {
    const source = summary && typeof summary === 'object' ? summary : {};
    const reached = [];
    for (const milestone of ENDLESS_PARCOURS_MILESTONES) {
        const value = Number(source[milestone.metric]) || 0;
        if (value >= milestone.threshold) reached.push(milestone.id);
    }
    return reached;
}
