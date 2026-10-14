import { HUNT_PARCOURS_RUN_TYPE, normalizeHuntParcoursVariantId, resolveHuntParcoursMedal } from './HuntParcoursContract.js';

// Per-profile best hunt parcours result for each variant; the player record store scopes this key per profile.
export const HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY = 'cuviosclash.arcade-hunt-parcours-medals.v1';
export const HUNT_PARCOURS_MEDAL_RECORD_VERSION = 1;

/** Worst to best; '' means no medal yet. */
const MEDAL_ORDER = Object.freeze(['', 'bronze', 'silver', 'gold']);
const RIVAL_TIER_GROUPS = new Set(['0-1', '2-3', '4-5']);
const MAX_COUNTER = 1000000000;

/** @typedef {{bestScore: number, bestMedal: string, plays: number, lastScore: number}} HuntParcoursMedalEntry */
/** @typedef {{version: number, variants: Record<string, HuntParcoursMedalEntry>}} HuntParcoursMedalRecord */

/** @param {unknown} medal */
function medalRank(medal) {
    return Math.max(0, MEDAL_ORDER.indexOf(String(medal || '')));
}

/** @param {unknown} value */
function toCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_COUNTER, Math.floor(number))) : 0;
}

/** @param {any} value @returns {HuntParcoursMedalEntry} */
function normalizeEntry(value) {
    return {
        bestScore: toCount(value?.bestScore),
        bestMedal: MEDAL_ORDER[medalRank(value?.bestMedal)],
        plays: toCount(value?.plays),
        lastScore: toCount(value?.lastScore),
    };
}

/**
 * Broken, missing or foreign-version data becomes an empty record; unknown variant ids are dropped.
 * @param {unknown} raw
 * @returns {HuntParcoursMedalRecord}
 */
export function normalizeHuntParcoursMedalRecord(raw) {
    const input = /** @type {any} */ (raw);
    /** @type {Record<string, HuntParcoursMedalEntry>} */
    const variants = {};
    const source = input && typeof input === 'object' && !Array.isArray(input)
        && input.version === HUNT_PARCOURS_MEDAL_RECORD_VERSION ? input.variants : null;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        for (const [key, entry] of Object.entries(source)) {
            const id = normalizeHuntParcoursVariantId(key);
            if (!id || !entry || typeof entry !== 'object') continue;
            variants[id] = normalizeEntry(entry);
        }
    }
    return { version: HUNT_PARCOURS_MEDAL_RECORD_VERSION, variants };
}

/** Only an absent record or one of this version may be saved over; a newer or foreign shape is left alone. */
/** @param {unknown} value */
export function isWritableHuntParcoursMedalRecord(value) {
    if (value === null || value === undefined) return true;
    return typeof value === 'object' && !Array.isArray(value) && /** @type {any} */ (value).version === HUNT_PARCOURS_MEDAL_RECORD_VERSION;
}

/**
 * Counts one finished run. Best score and best medal only ever improve; lastScore always follows the run.
 * An unknown variant or a non-numeric score leaves the record as it was (normalized).
 * @returns {HuntParcoursMedalRecord}
 */
/** @param {unknown} record @param {{variantId?: unknown, score?: unknown}} [result] */
export function recordHuntParcoursResult(record, { variantId = '', score = NaN } = {}) {
    const normalized = normalizeHuntParcoursMedalRecord(record);
    const id = normalizeHuntParcoursVariantId(variantId);
    const value = Number(score);
    if (!id || !Number.isFinite(value)) return normalized;
    const points = toCount(value);
    const previous = normalized.variants[id] || normalizeEntry(null);
    const medal = resolveHuntParcoursMedal(id, points);
    normalized.variants[id] = {
        bestScore: Math.max(previous.bestScore, points),
        bestMedal: medalRank(medal) > medalRank(previous.bestMedal) ? medal : previous.bestMedal,
        plays: Math.min(MAX_COUNTER, previous.plays + 1),
        lastScore: points,
    };
    return normalized;
}

/** Best medal per recorded variant, the shape isHuntParcoursVariantUnlocked expects. @returns {Record<string, string>} */
/** @param {unknown} record */
export function getHuntParcoursMedalsByVariant(record) {
    /** @type {Record<string, string>} */
    const medals = {};
    for (const [id, entry] of Object.entries(normalizeHuntParcoursMedalRecord(record).variants)) medals[id] = entry.bestMedal;
    return medals;
}

/**
 * Stable board key: 'hunt_parcours:<variant>', for nemesis 'hunt_parcours:nemesis:<0-1|2-3|4-5>'.
 * Unknown variants, and nemesis without a valid tier group, return '' (no board).
 */
export function resolveHuntParcoursLeaderboardKey({ variantId = '', rivalTierGroup = '' } = {}) {
    const id = normalizeHuntParcoursVariantId(variantId);
    if (!id) return '';
    if (id !== 'nemesis') return `${HUNT_PARCOURS_RUN_TYPE}:${id}`;
    return RIVAL_TIER_GROUPS.has(rivalTierGroup) ? `${HUNT_PARCOURS_RUN_TYPE}:${id}:${rivalTierGroup}` : '';
}
