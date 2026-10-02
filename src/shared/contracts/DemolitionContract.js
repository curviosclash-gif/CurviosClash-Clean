import { createSeededRandom } from '../utils/ArcadeUtils.js';

export const DEMOLITION_RUN_TYPE = 'demolition';
export const DEMOLITION_COMBAT_PROFILE = 'hunt';
export const DEMOLITION_MAP_COUNT = 3;

export const DEMOLITION_WEAPON_RULES = Object.freeze({
    startingMediumRockets: 2,
    heavyRocketChance: 0.36,
    megaRocketChance: 0.08,
});

export const DEMOLITION_SCORE_RULES = Object.freeze({
    hpPerPoint: 10,
    breakPoints: 50,
    collapsedHpFactor: 0.5,
    remainingSecondPoints: 10,
    correctOrderFactor: 1.25,
});

export const DEMOLITION_XP_RULES = Object.freeze({
    mapComplete: 50,
    breakEvent: 10,
    unitDestroyed: 30,
    kill: 15,
    multiplierCap: 3,
});

export const DEMOLITION_MEDAL_THRESHOLDS = Object.freeze({
    bronze: 0.5,
    silver: 0.7,
    gold: 0.9,
});

const MAP_PROFILES = Object.freeze([
    Object.freeze({
        mapKey: 'eiffel_tower_siege', label: 'Eiffelturm', timingHp: 1550, maxDirectBreakEvents: 4, botCount: 0,
        briefing: 'Von oben nach unten gibt Statik-Bonus. Ein unteres Bein legt den ganzen Turm um.',
        collapseWarning: 'Unteres Bein getroffen – Gesamteinsturz droht!',
    }),
    Object.freeze({
        mapKey: 'reactor_site', label: 'Reaktorgelände', timingHp: 2550, maxDirectBreakEvents: 5, botCount: 3,
        briefing: 'Reaktor zuletzt zerstören, damit die übrigen Bauwerke weiter gewertet werden.',
        collapseWarning: 'Reaktor zuletzt!',
    }),
    Object.freeze({
        mapKey: 'skyline_siege', label: 'Skyline', timingHp: 1420, maxDirectBreakEvents: 3, botCount: 3,
        briefing: 'Alle drei Hochhäuser einreißen. Ihre Druckwellen treffen auch dein Schiff.',
        collapseWarning: 'Druckwelle: 35 Schaden!',
    }),
    Object.freeze({
        mapKey: 'storm_dam_siege', label: 'Sturmdamm', timingHp: 1400, maxDirectBreakEvents: 1, botCount: 3,
        briefing: 'Schnellauftrag: Der Damm ist das einzige Ziel und versiegelt die Karte beim Einsturz.',
        collapseWarning: 'Druckwelle: 50 Schaden!',
    }),
    Object.freeze({
        mapKey: 'storm_bridge_siege', label: 'Sturmbrücke', timingHp: 650, maxDirectBreakEvents: 1, botCount: 3,
        briefing: 'Schnellauftrag: Die Brücke ist das einzige Ziel und versiegelt die Karte beim Einsturz.',
        collapseWarning: 'Druckwelle: 45 Schaden!',
    }),
    Object.freeze({
        mapKey: 'storm_lighthouse_siege', label: 'Sturmleuchtturm', timingHp: 520, maxDirectBreakEvents: 1, botCount: 3,
        briefing: 'Schnellauftrag: Der Leuchtturm ist das einzige Ziel und versiegelt die Karte beim Einsturz.',
        collapseWarning: 'Druckwelle: 40 Schaden!',
    }),
]);

const PROFILE_BY_MAP = new Map(MAP_PROFILES.map((profile) => [profile.mapKey, profile]));
const CORE_MAP_KEYS = Object.freeze(MAP_PROFILES.slice(0, 3).map((profile) => profile.mapKey));
const STORM_MAP_KEYS = Object.freeze(MAP_PROFILES.slice(3).map((profile) => profile.mapKey));

function shuffled(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

export function isDemolitionRunType(value) {
    return String(value || '').trim().toLowerCase() === DEMOLITION_RUN_TYPE;
}

export function normalizeDemolitionProfileIds(value) {
    const source = Array.isArray(value) ? value : [];
    return Object.freeze(Array.from({ length: 3 }, (_, index) => String(source[index] || '').trim()));
}

export function isDemolitionConfig(runtimeConfig) {
    return runtimeConfig?.arcade?.enabled === true && isDemolitionRunType(runtimeConfig?.arcade?.runType);
}

export function resolveDemolitionMapProfile(mapKey) {
    return PROFILE_BY_MAP.get(String(mapKey || '').trim()) || null;
}

export function resolveDemolitionMapTimeSeconds(mapKey) {
    const profile = resolveDemolitionMapProfile(mapKey);
    return profile ? Math.round(30 + profile.timingHp / 30) : 0;
}

export function resolveDemolitionReferenceScore(mapKey) {
    const profile = resolveDemolitionMapProfile(mapKey);
    if (!profile) return 0;
    const hpPoints = Math.floor(profile.timingHp / DEMOLITION_SCORE_RULES.hpPerPoint);
    const breakPoints = profile.maxDirectBreakEvents * DEMOLITION_SCORE_RULES.breakPoints;
    // The time budget assumes timingHp / 30 seconds of demolition, leaving the authored 30-second buffer.
    const timePoints = 30 * DEMOLITION_SCORE_RULES.remainingSecondPoints;
    const subtotal = hpPoints + breakPoints + timePoints;
    return mapKey === 'eiffel_tower_siege' || mapKey === 'reactor_site'
        ? Math.floor(subtotal * DEMOLITION_SCORE_RULES.correctOrderFactor)
        : subtotal;
}

export function resolveDemolitionMedal(mapKey, score) {
    const reference = resolveDemolitionReferenceScore(mapKey);
    const points = Math.max(0, Number(score) || 0);
    if (reference <= 0) return '';
    if (points >= Math.ceil(reference * DEMOLITION_MEDAL_THRESHOLDS.gold)) return 'gold';
    if (points >= Math.ceil(reference * DEMOLITION_MEDAL_THRESHOLDS.silver)) return 'silver';
    if (points >= Math.ceil(reference * DEMOLITION_MEDAL_THRESHOLDS.bronze)) return 'bronze';
    return '';
}

export function createDemolitionMapPlan(seed) {
    const random = createSeededRandom(seed, 'arcade-demolition');
    const core = shuffled(CORE_MAP_KEYS, random);
    const finalCandidates = shuffled([core[2], ...STORM_MAP_KEYS], random);
    const mapKeys = Object.freeze([core[0], core[1], finalCandidates[0]]);
    return Object.freeze({
        runType: DEMOLITION_RUN_TYPE,
        seed: Number(seed) || 0,
        mapKeys,
        maps: Object.freeze(mapKeys.map((mapKey) => Object.freeze({
            ...resolveDemolitionMapProfile(mapKey),
            timeLimitSeconds: resolveDemolitionMapTimeSeconds(mapKey),
            combatProfile: DEMOLITION_COMBAT_PROFILE,
        }))),
    });
}

function hasCorrectOrder(mapKey, events, segments) {
    const ids = events.map((event) => String(event?.segmentId || ''));
    if (mapKey === 'reactor_site') {
        const reactorIndex = ids.indexOf('reactor_dome');
        const otherSegments = segments.filter((segment) => String(segment?.id || '') !== 'reactor_dome');
        return reactorIndex >= 0 && reactorIndex === ids.length - 1
            && otherSegments.length > 0
            && otherSegments.every((segment) => segment?.destroyed === true && segment?.collapsed !== true);
    }
    if (mapKey !== 'eiffel_tower_siege') return false;
    const ranks = events.map((event) => {
        const kind = String(event?.kind || '');
        return kind === 'summit' ? 0 : (kind === 'shaft' ? 1 : (kind === 'leg_mid' ? 2 : (kind === 'leg_lower' ? 3 : -1)));
    });
    return ranks.length === 4 && ranks.every((rank, index) => rank === index);
}

export function calculateDemolitionMapScore({ mapKey = '', state = null, remainingSeconds = 0 } = {}) {
    const segments = Array.isArray(state?.segments) ? state.segments : [];
    const events = Array.isArray(state?.events) ? state.events : [];
    let weightedDestroyedHp = 0;
    for (const segment of segments) {
        const maxHp = Math.max(0, Number(segment?.maxHp) || 0);
        const rawHp = Number(segment?.hp);
        const fallbackHp = segment?.destroyed === true || segment?.collapsed === true ? 0 : maxHp;
        const remainingHp = Math.min(maxHp, Math.max(0, Number.isFinite(rawHp) ? rawHp : fallbackHp));
        const destroyedHp = maxHp - remainingHp;
        weightedDestroyedHp += segment?.collapsed === true
            ? destroyedHp * DEMOLITION_SCORE_RULES.collapsedHpFactor
            : destroyedHp;
    }
    const hpPoints = Math.floor(weightedDestroyedHp / DEMOLITION_SCORE_RULES.hpPerPoint);
    const breakPoints = events.length * DEMOLITION_SCORE_RULES.breakPoints;
    const timePoints = Math.floor(Math.max(0, Number(remainingSeconds) || 0)) * DEMOLITION_SCORE_RULES.remainingSecondPoints;
    const subtotal = hpPoints + breakPoints + timePoints;
    const correctOrder = hasCorrectOrder(String(mapKey || ''), events, segments);
    return Object.freeze({
        hpPoints,
        breakPoints,
        timePoints,
        correctOrder,
        orderBonus: correctOrder ? Math.floor(subtotal * (DEMOLITION_SCORE_RULES.correctOrderFactor - 1)) : 0,
        total: correctOrder ? Math.floor(subtotal * DEMOLITION_SCORE_RULES.correctOrderFactor) : subtotal,
    });
}

export function calculateDemolitionMapXp({ completed = false, breakEvents = 0, unitsDestroyed = 0, kills = 0, multiplier = 1 } = {}) {
    const raw = (completed ? DEMOLITION_XP_RULES.mapComplete : 0)
        + Math.max(0, Math.trunc(Number(breakEvents) || 0)) * DEMOLITION_XP_RULES.breakEvent
        + Math.max(0, Math.trunc(Number(unitsDestroyed) || 0)) * DEMOLITION_XP_RULES.unitDestroyed
        + Math.max(0, Math.trunc(Number(kills) || 0)) * DEMOLITION_XP_RULES.kill;
    const factor = Math.min(DEMOLITION_XP_RULES.multiplierCap, Math.max(1, Number(multiplier) || 1));
    return Math.floor(raw * factor);
}

export const DEMOLITION_MAP_PROFILES = MAP_PROFILES;
export const DEMOLITION_CORE_MAP_KEYS = CORE_MAP_KEYS;
export const DEMOLITION_STORM_MAP_KEYS = STORM_MAP_KEYS;
