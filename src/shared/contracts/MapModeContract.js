import { normalizeString } from './ContractNormalizeUtils.js';

const MAP_MODE_PATHS = new Set(['normal', 'arcade', 'fight', 'quick_action']);

/** @param {unknown} modePath @returns {string} */
function normalizeModePath(modePath) {
    const normalized = normalizeString(modePath, 'normal').toLowerCase();
    return MAP_MODE_PATHS.has(normalized) ? normalized : 'normal';
}

const PARCOURS_GAME_MODES = new Set(['CLASSIC', 'HUNT', 'ARCADE']);

// A route belongs to the map, but running it belongs to the round. Without an authored
// list a route runs where it was built for: Classic carries the tutorial parcours, Arcade
// carries the time trials. Hunt is left out, because the adventure maps carry a route next
// to their combat layout and would otherwise fight inside a course they never asked for.
const DEFAULT_PARCOURS_GAME_MODES = Object.freeze(['CLASSIC', 'ARCADE']);

/** @param {unknown} gameMode @returns {string} */
function normalizeGameModeId(gameMode) {
    const normalized = normalizeString(gameMode, 'CLASSIC').toUpperCase();
    return PARCOURS_GAME_MODES.has(normalized) ? normalized : 'CLASSIC';
}

/** @param {unknown} mapDefinition @returns {boolean} */
export function isParcoursMapDefinition(mapDefinition) {
    const parcours = mapDefinition && typeof mapDefinition === 'object'
        ? /** @type {{ parcours?: { enabled?: unknown } | null }} */ (mapDefinition).parcours
        : null;
    return parcours?.enabled === true;
}

/** @param {{ gameModes?: unknown } | null | undefined} parcours @returns {readonly string[]} */
function listParcoursGameModes(parcours) {
    if (!Array.isArray(parcours?.gameModes)) return DEFAULT_PARCOURS_GAME_MODES;

    const declaredGameModes = parcours.gameModes
        .map((gameMode) => normalizeString(gameMode, '').toUpperCase())
        .filter((gameMode) => PARCOURS_GAME_MODES.has(gameMode));
    // An empty or unreadable list is an authoring slip, not a request for a route that
    // runs nowhere.
    return declaredGameModes.length > 0 ? declaredGameModes : DEFAULT_PARCOURS_GAME_MODES;
}

/** @param {unknown} mapDefinition @param {unknown} gameMode @returns {boolean} */
export function isParcoursActiveForGameMode(mapDefinition, gameMode) {
    if (!isParcoursMapDefinition(mapDefinition)) return false;
    const parcours = /** @type {{ parcours?: { gameModes?: unknown } | null }} */ (mapDefinition).parcours;
    return listParcoursGameModes(parcours).includes(normalizeGameModeId(gameMode));
}

const MAP_GAME_MODES = new Set(['CLASSIC', 'HUNT', 'ESCORT', 'ARCADE']);
/** @type {readonly string[]} */
const NO_EXCLUDED_GAME_MODES = Object.freeze([]);
// Every mode path but the quick start pins its game mode; the quick start keeps the one set.
/** @type {Readonly<Record<string, string>>} */
const MODE_PATH_GAME_MODES = Object.freeze({ normal: 'CLASSIC', fight: 'HUNT', arcade: 'ARCADE' });

/**
 * Game modes a map is authored out of (`excludedModes`); unknown entries drop out.
 *
 * @param {unknown} mapDefinition
 * @returns {readonly string[]}
 */
export function listMapExcludedGameModes(mapDefinition) {
    const source = mapDefinition && typeof mapDefinition === 'object'
        ? /** @type {{ excludedModes?: unknown }} */ (mapDefinition).excludedModes
        : null;
    if (!Array.isArray(source) || source.length === 0) return NO_EXCLUDED_GAME_MODES;
    const modes = source
        .map((mode) => (typeof mode === 'string' ? mode.trim().toUpperCase() : ''))
        .filter((mode) => MAP_GAME_MODES.has(mode));
    return modes.length > 0 ? Object.freeze([...new Set(modes)]) : NO_EXCLUDED_GAME_MODES;
}

/**
 * @param {unknown} mapDefinition
 * @param {string} modePath
 * @param {string} [gameMode] Only read for the quick start, whose path does not pin a mode.
 * @returns {boolean}
 */
export function isMapEligibleForModePath(mapDefinition, modePath, gameMode = '') {
    if (!mapDefinition || typeof mapDefinition !== 'object') return false;
    // Apart from authored exclusions, every valid map can run in every mode path.
    const resolvedGameMode = MODE_PATH_GAME_MODES[normalizeModePath(modePath)]
        || normalizeString(gameMode, '').toUpperCase();
    return !resolvedGameMode || !listMapExcludedGameModes(mapDefinition).includes(resolvedGameMode);
}

/**
 * @param {unknown} maps
 * @param {string} modePath
 * @param {{ includeCustom?: boolean, gameMode?: string }} [options]
 * @returns {string[]}
 */
export function listEligibleMapKeysForModePath(maps, modePath, options = {}) {
    const includeCustom = options?.includeCustom === true;
    const sourceMaps = /** @type {Record<string, unknown>} */ (maps && typeof maps === 'object' ? maps : {});
    return Object.keys(sourceMaps)
        .filter((mapKey) => {
            const normalizedMapKey = normalizeString(mapKey, '');
            if (!normalizedMapKey) return false;
            if (normalizedMapKey === 'custom' && !includeCustom) return false;
            return isMapEligibleForModePath(sourceMaps[normalizedMapKey], modePath, options?.gameMode);
        });
}

/**
 * @param {unknown} maps
 * @param {string} modePath
 * @param {string} [currentMapKey]
 * @param {string} [gameMode]
 * @returns {string}
 */
export function resolveModePathFallbackMapKey(maps, modePath, currentMapKey = '', gameMode = '') {
    const sourceMaps = /** @type {Record<string, unknown>} */ (maps && typeof maps === 'object' ? maps : {});
    const normalizedCurrentMapKey = normalizeString(currentMapKey, '');
    if (normalizedCurrentMapKey && isMapEligibleForModePath(sourceMaps[normalizedCurrentMapKey], modePath, gameMode)) {
        return normalizedCurrentMapKey;
    }

    const eligibleKeys = listEligibleMapKeysForModePath(sourceMaps, modePath, { gameMode });
    if (eligibleKeys.length === 0) {
        return sourceMaps.standard ? 'standard' : normalizeString(Object.keys(sourceMaps)[0], 'standard');
    }

    const preferredFallbackKey = normalizeModePath(modePath) === 'arcade' ? 'parcours_rift' : 'standard';
    if (eligibleKeys.includes(preferredFallbackKey)) {
        return preferredFallbackKey;
    }
    return eligibleKeys[0];
}
