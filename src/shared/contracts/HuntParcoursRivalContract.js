// Nemesis variant of the hunt parcours: one named rival over three maps who learns from every lost run.
// Stored per profile; the player record store scopes this key per profile.
export const HUNT_PARCOURS_RIVAL_STORAGE_KEY = 'cuviosclash.arcade-hunt-parcours-rival.v1';
export const HUNT_PARCOURS_RIVAL_VERSION = 1;
export const HUNT_PARCOURS_RIVAL_MAX_STAGE = 5;
export const HUNT_PARCOURS_RIVAL_MAX_TRAITS = 3;
export const HUNT_PARCOURS_RIVAL_MAX_RETIRED = 10;
/** Without a par time a won map earns the full time bonus up to 90 s and none from 180 s on. */
export const HUNT_PARCOURS_NEMESIS_DEFAULT_PAR_MS = 90000;

const MAX_COUNTER = 1000000;
const MAX_NAME_LENGTH = 24;

export const HUNT_PARCOURS_RIVAL_NAMES = Object.freeze([
    'Nachtfalke', 'Kobalt', 'Sturmvogel', 'Glutzahn', 'Eisenkrähe', 'Viper',
    'Funkenflug', 'Schakal', 'Rostflügel', 'Blitzrabe', 'Nebelwolf', 'Kestrel',
]);

// Effects of each learned trait; neutral values are 0 (shield, intercept) and 1 (multipliers).
export const HUNT_PARCOURS_RIVAL_TRAITS = Object.freeze({
    shield_bearer: Object.freeze({
        id: 'shield_bearer', label: 'Schildträger', learnedFrom: 'kills',
        shieldBonus: 40, speedMultiplier: 1, turnMultiplier: 1, interceptChance: 0, aimSpreadMultiplier: 1,
    }),
    corner_artist: Object.freeze({
        id: 'corner_artist', label: 'Kurvenkünstler', learnedFrom: 'finish',
        shieldBonus: 0, speedMultiplier: 1.08, turnMultiplier: 1.1, interceptChance: 0, aimSpreadMultiplier: 1,
    }),
    intercept_pro: Object.freeze({
        id: 'intercept_pro', label: 'Abfangprofi', learnedFrom: 'rocket_kills',
        shieldBonus: 0, speedMultiplier: 1, turnMultiplier: 1, interceptChance: 0.9, aimSpreadMultiplier: 1,
    }),
    sharpshooter: Object.freeze({
        id: 'sharpshooter', label: 'Scharfschütze', learnedFrom: 'flawless',
        shieldBonus: 0, speedMultiplier: 1, turnMultiplier: 1, interceptChance: 0, aimSpreadMultiplier: 0.5,
    }),
});

/** @typedef {keyof typeof HUNT_PARCOURS_RIVAL_TRAITS} HuntParcoursRivalTraitId */
/** @typedef {{name: string, stage: number, rivalWins: number}} HuntParcoursRetiredRival */
/**
 * @typedef {{version: number, seed: number, rivalIndex: number, name: string, stage: number,
 *   traits: HuntParcoursRivalTraitId[], rivalWins: number, retired: HuntParcoursRetiredRival[]}} HuntParcoursRivalState
 */

/** @param {unknown} value @param {number} max @param {number} fallback */
function toCount(value, max, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(max, Math.floor(number)));
}

/** @param {unknown} value @returns {value is HuntParcoursRivalTraitId} */
function isTraitId(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HUNT_PARCOURS_RIVAL_TRAITS, value);
}

/** @param {unknown} value */
function normalizeName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name && name.length <= MAX_NAME_LENGTH ? name : '';
}

/** @param {unknown} value */
function clampStage(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(HUNT_PARCOURS_RIVAL_MAX_STAGE, Math.floor(number)));
}

/** Name of the rival number `rivalIndex` (0 = first) for a profile seed; cycles through the list. */
export function resolveHuntParcoursRivalName(seed = 0, rivalIndex = 0) {
    const offset = toCount(Math.abs(Number(seed)), 2147483647) + toCount(rivalIndex, MAX_COUNTER);
    return HUNT_PARCOURS_RIVAL_NAMES[offset % HUNT_PARCOURS_RIVAL_NAMES.length];
}

/**
 * @param {number} seed
 * @param {number} rivalIndex
 * @param {HuntParcoursRetiredRival[]} retired
 * @returns {HuntParcoursRivalState}
 */
function buildRival(seed, rivalIndex, retired) {
    return {
        version: HUNT_PARCOURS_RIVAL_VERSION, seed, rivalIndex, name: resolveHuntParcoursRivalName(seed, rivalIndex),
        stage: 0, traits: [], rivalWins: 0, retired,
    };
}

/** First rival of a profile; a non-negative integer seed (e.g. from the profile id) picks the name. */
export function createHuntParcoursRivalState(seed = 0) {
    return buildRival(toCount(Math.abs(Number(seed)), 2147483647), 0, []);
}

/** Unknown record versions are readable as a temporary rival, never writable as this schema. */
export function isWritableHuntParcoursRivalState(value) {
    return value == null || (typeof value === 'object' && !Array.isArray(value)
        && value.version === HUNT_PARCOURS_RIVAL_VERSION);
}

/**
 * Missing, broken or foreign-version data becomes a fresh rival for `fallbackSeed`.
 * Traits keep the newest occurrence of each id (oldest first), at most three.
 * @param {unknown} raw
 * @returns {HuntParcoursRivalState}
 */
export function normalizeHuntParcoursRivalState(raw, fallbackSeed = 0) {
    const input = /** @type {any} */ (raw);
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== HUNT_PARCOURS_RIVAL_VERSION) {
        return createHuntParcoursRivalState(fallbackSeed);
    }
    const seed = toCount(Math.abs(Number(input.seed)), 2147483647, toCount(Math.abs(Number(fallbackSeed)), 2147483647));
    const rivalIndex = toCount(input.rivalIndex, MAX_COUNTER);
    /** @type {HuntParcoursRivalTraitId[]} */
    const traits = [];
    for (const id of Array.isArray(input.traits) ? input.traits : []) {
        if (!isTraitId(id)) continue;
        const known = traits.indexOf(id);
        if (known >= 0) traits.splice(known, 1);
        traits.push(id);
    }
    /** @type {HuntParcoursRetiredRival[]} */
    const retired = [];
    for (const entry of Array.isArray(input.retired) ? input.retired : []) {
        const name = normalizeName(entry?.name);
        if (!name) continue;
        retired.push({ name, stage: clampStage(entry.stage), rivalWins: toCount(entry.rivalWins, MAX_COUNTER) });
        if (retired.length >= HUNT_PARCOURS_RIVAL_MAX_RETIRED) break;
    }
    return {
        version: HUNT_PARCOURS_RIVAL_VERSION,
        seed,
        rivalIndex,
        name: normalizeName(input.name) || resolveHuntParcoursRivalName(seed, rivalIndex),
        stage: clampStage(input.stage),
        traits: traits.slice(-HUNT_PARCOURS_RIVAL_MAX_TRAITS),
        rivalWins: toCount(input.rivalWins, MAX_COUNTER),
        retired,
    };
}

/**
 * How the player beat the rival, as the trait he learns against it. Priority:
 * 1. hitsTaken is exactly 0 (never hit in the whole run) -> sharpshooter
 * 2. more maps won by kills than by finish -> intercept_pro when rockets made more than half of all kills, else shield_bearer
 * 3. otherwise (finish wins, a tie or missing stats) -> corner_artist
 * @param {{mapsWonByFinish?: number, mapsWonByKills?: number, rocketKills?: number, totalKills?: number, hitsTaken?: number} | null | undefined} stats
 * @returns {HuntParcoursRivalTraitId}
 */
export function resolvePlayerWinStyle(stats) {
    const hitsTaken = Number(stats?.hitsTaken);
    if (typeof stats?.hitsTaken === 'number' && hitsTaken === 0) return 'sharpshooter';
    const byKills = toCount(stats?.mapsWonByKills, MAX_COUNTER);
    const byFinish = toCount(stats?.mapsWonByFinish, MAX_COUNTER);
    if (byKills > byFinish) {
        const totalKills = toCount(stats?.totalKills, MAX_COUNTER);
        const rocketKills = toCount(stats?.rocketKills, MAX_COUNTER);
        return totalKills > 0 && rocketKills * 2 > totalKills ? 'intercept_pro' : 'shield_bearer';
    }
    return 'corner_artist';
}

/**
 * The player won the run. Below stage 5 the rival climbs one stage and learns a trait against the win style
 * (a known trait becomes the newest, the oldest drops beyond three). At stage 5 he retires instead and the
 * next rival starts at stage 0. The input state is never changed.
 * @returns {HuntParcoursRivalState}
 */
/** @param {unknown} state @param {Parameters<typeof resolvePlayerWinStyle>[0]} stats */
export function applyHuntParcoursRivalDefeat(state, stats) {
    const current = normalizeHuntParcoursRivalState(state);
    if (current.stage >= HUNT_PARCOURS_RIVAL_MAX_STAGE) {
        const retired = [{ name: current.name, stage: current.stage, rivalWins: current.rivalWins }, ...current.retired]
            .slice(0, HUNT_PARCOURS_RIVAL_MAX_RETIRED);
        return buildRival(current.seed, Math.min(MAX_COUNTER, current.rivalIndex + 1), retired);
    }
    const trait = resolvePlayerWinStyle(stats);
    const traits = [...current.traits.filter((id) => id !== trait), trait].slice(-HUNT_PARCOURS_RIVAL_MAX_TRAITS);
    return { ...current, stage: current.stage + 1, traits };
}

/** The rival won the run: only his win counter rises. @returns {HuntParcoursRivalState} */
/** @param {unknown} state */
export function applyHuntParcoursRivalVictory(state) {
    const current = normalizeHuntParcoursRivalState(state);
    return { ...current, rivalWins: Math.min(MAX_COUNTER, current.rivalWins + 1) };
}

/**
 * Flat runtime numbers: health 1.6 + 0.15 x stage, shield bonuses add up, multipliers multiply,
 * intercept chance takes the highest trait value.
 */
/** @param {unknown} state */
export function resolveHuntParcoursRivalModifiers(state) {
    const current = normalizeHuntParcoursRivalState(state);
    const modifiers = {
        healthMultiplier: Math.round((1.6 + 0.15 * current.stage) * 100) / 100,
        shieldBonus: 0, speedMultiplier: 1, turnMultiplier: 1, interceptChance: 0, aimSpreadMultiplier: 1,
    };
    for (const id of current.traits) {
        const trait = HUNT_PARCOURS_RIVAL_TRAITS[id];
        modifiers.shieldBonus += trait.shieldBonus;
        modifiers.speedMultiplier *= trait.speedMultiplier;
        modifiers.turnMultiplier *= trait.turnMultiplier;
        modifiers.aimSpreadMultiplier *= trait.aimSpreadMultiplier;
        modifiers.interceptChance = Math.max(modifiers.interceptChance, trait.interceptChance);
    }
    return modifiers;
}

/** Leaderboard group of a rival stage. @returns {'0-1' | '2-3' | '4-5'} */
/** @param {unknown} stage */
export function resolveHuntParcoursRivalTierGroup(stage) {
    const value = clampStage(stage);
    if (value >= 4) return '4-5';
    return value >= 2 ? '2-3' : '0-1';
}

/**
 * Points for one nemesis map. Won map: 1000 x (1 + 0.25 x stage) plus a time bonus of
 * 500 x clamp(2 - elapsedMs / parMs, 0, 1) (full up to par, linear down to 0 at twice the par).
 * Every kill adds 250, also on a lost map. Unknown or non-positive elapsed time gives no time bonus.
 */
export function scoreHuntParcoursNemesisMap({ won = false, stage = 0, elapsedMs = NaN, parMs = HUNT_PARCOURS_NEMESIS_DEFAULT_PAR_MS, kills = 0 } = {}) {
    const killPoints = 250 * toCount(Math.max(0, Number(kills) || 0), MAX_COUNTER);
    if (won !== true) return killPoints;
    const par = Number(parMs) > 0 ? Number(parMs) : HUNT_PARCOURS_NEMESIS_DEFAULT_PAR_MS;
    const elapsed = Number(elapsedMs);
    const fraction = Number.isFinite(elapsed) && elapsed > 0 ? Math.max(0, Math.min(1, 2 - elapsed / par)) : 0;
    return Math.round(1000 * (1 + 0.25 * clampStage(stage))) + Math.round(500 * fraction) + killPoints;
}
