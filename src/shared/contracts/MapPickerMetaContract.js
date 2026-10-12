// Map picker metadata: one record per catalog map (collection, tier, difficulty, player range,
// tags, one-line description). The table lives in src/shared/maps/MapPickerMeta.js; the menu and
// the Arcade map change both read it through normalizeMapPickerMeta, so they cannot drift apart.
// "tier: dev" marks maps for development (model galleries, empty test box): the pickers hide them.
import { normalizeText } from './ContractNormalizeUtils.js';

export const MAP_PICKER_COLLECTION_DEFS = Object.freeze([
    Object.freeze({ id: 'arena', label: 'Arenen' }),
    Object.freeze({ id: 'themed', label: 'Themenwelten' }),
    Object.freeze({ id: 'adventure', label: 'Abenteuer' }),
    Object.freeze({ id: 'parcours', label: 'Parcours' }),
    Object.freeze({ id: 'expert', label: 'Expertenkarten' }),
    Object.freeze({ id: 'showcase', label: 'Showcase & Tests' }),
    Object.freeze({ id: 'custom', label: 'Eigene Karten' }),
]);

export const MAP_PICKER_FALLBACK_COLLECTION = Object.freeze({ id: 'other', label: 'Weitere Karten' });

export const MAP_PICKER_TIERS = Object.freeze(['public', 'dev']);

/** Order of this list is the order of normalized tags. */
export const MAP_PICKER_TAGS = Object.freeze(['destructible', 'secretRoom', 'huge', 'parcours', 'boss']);

export const MAP_PICKER_META_LIMITS = Object.freeze({
    difficulty: Object.freeze({ min: 1, max: 5 }),
    players: Object.freeze({ min: 1, max: 64 }),
    descriptionLength: 200,
});

const DEFAULTS = Object.freeze({ difficulty: 2, players: Object.freeze({ min: 1, recommended: 4, max: 8 }) });

/**
 * @param {unknown} value
 * @param {{ min: number, max: number }} range
 * @param {number} fallback
 * @returns {number}
 */
function clampInteger(value, range, fallback) {
    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

/**
 * @param {any} source Table entry in any state.
 * @returns {{
 *   collection: string,
 *   tier: string,
 *   difficulty: number,
 *   players: { min: number, recommended: number, max: number },
 *   tags: string[],
 *   description: string,
 * }}
 */
export function normalizeMapPickerMeta(source) {
    const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const collection = MAP_PICKER_COLLECTION_DEFS.find((entry) => entry.id === input.collection)
        ? String(input.collection)
        : MAP_PICKER_FALLBACK_COLLECTION.id;
    const playersInput = input.players && typeof input.players === 'object' ? input.players : {};
    const range = MAP_PICKER_META_LIMITS.players;
    const min = clampInteger(playersInput.min, range, DEFAULTS.players.min);
    const max = clampInteger(playersInput.max, { min, max: range.max }, Math.max(min, DEFAULTS.players.max));
    const recommended = clampInteger(playersInput.recommended, { min, max }, Math.min(max, Math.max(min, DEFAULTS.players.recommended)));
    const wantedTags = Array.isArray(input.tags) ? input.tags : [];
    return {
        collection,
        tier: MAP_PICKER_TIERS.includes(input.tier) ? input.tier : 'public',
        difficulty: clampInteger(input.difficulty, MAP_PICKER_META_LIMITS.difficulty, DEFAULTS.difficulty),
        players: { min, recommended, max },
        tags: MAP_PICKER_TAGS.filter((tag) => wantedTags.includes(tag)),
        description: normalizeText(input.description).slice(0, MAP_PICKER_META_LIMITS.descriptionLength).trim(),
    };
}

/** Three campaign stages over the 1-5 difficulty: teaching (1-2), craft (3), mastery (4-5). */
export const MAP_DIFFICULTY_STAGES = Object.freeze([
    Object.freeze({ id: 'lehre', label: 'Lehre', min: 1, max: 2 }),
    Object.freeze({ id: 'handwerk', label: 'Handwerk', min: 3, max: 3 }),
    Object.freeze({ id: 'meisterschaft', label: 'Meisterschaft', min: 4, max: 5 }),
]);

/**
 * @param {unknown} difficulty Difficulty 1-5; anything else is read as the default difficulty.
 * @returns {{ id: string, label: string, min: number, max: number }}
 */
export function resolveMapDifficultyStage(difficulty) {
    const value = clampInteger(difficulty, MAP_PICKER_META_LIMITS.difficulty, DEFAULTS.difficulty);
    return MAP_DIFFICULTY_STAGES.find((stage) => value >= stage.min && value <= stage.max) || MAP_DIFFICULTY_STAGES[0];
}

/**
 * @param {unknown} difficulty
 * @returns {string} Short German text for tooltips, e.g. "Schwierigkeit 3 von 5 (Handwerk)".
 */
export function describeMapDifficulty(difficulty) {
    const value = clampInteger(difficulty, MAP_PICKER_META_LIMITS.difficulty, DEFAULTS.difficulty);
    return `Schwierigkeit ${value} von ${MAP_PICKER_META_LIMITS.difficulty.max} (${resolveMapDifficultyStage(value).label})`;
}