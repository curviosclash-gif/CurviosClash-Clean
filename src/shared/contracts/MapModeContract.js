import { normalizeString } from './ContractNormalizeUtils.js';

const MAP_MODE_PATHS = new Set(['normal', 'arcade', 'fight', 'quick_action']);

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

function normalizeGameModeId(gameMode) {
    const normalized = normalizeString(gameMode, 'CLASSIC').toUpperCase();
    return PARCOURS_GAME_MODES.has(normalized) ? normalized : 'CLASSIC';
}

export function isParcoursMapDefinition(mapDefinition) {
    return !!(mapDefinition && typeof mapDefinition === 'object' && mapDefinition.parcours?.enabled === true);
}

function listParcoursGameModes(parcours) {
    if (!Array.isArray(parcours?.gameModes)) return DEFAULT_PARCOURS_GAME_MODES;

    const declaredGameModes = parcours.gameModes
        .map((gameMode) => normalizeString(gameMode, '').toUpperCase())
        .filter((gameMode) => PARCOURS_GAME_MODES.has(gameMode));
    // An empty or unreadable list is an authoring slip, not a request for a route that
    // runs nowhere.
    return declaredGameModes.length > 0 ? declaredGameModes : DEFAULT_PARCOURS_GAME_MODES;
}

export function isParcoursActiveForGameMode(mapDefinition, gameMode) {
    if (!isParcoursMapDefinition(mapDefinition)) return false;
    return listParcoursGameModes(mapDefinition.parcours).includes(normalizeGameModeId(gameMode));
}

export function isMapEligibleForModePath(mapDefinition, modePath) {
    // Keep mode-path normalization for contract compatibility, but map eligibility
    // is intentionally mode-agnostic: every valid map can run in every mode path.
    normalizeModePath(modePath);
    return !!(mapDefinition && typeof mapDefinition === 'object');
}

export function listEligibleMapKeysForModePath(maps, modePath, options = {}) {
    const includeCustom = options?.includeCustom === true;
    const sourceMaps = maps && typeof maps === 'object' ? maps : {};
    return Object.keys(sourceMaps)
        .filter((mapKey) => {
            const normalizedMapKey = normalizeString(mapKey, '');
            if (!normalizedMapKey) return false;
            if (normalizedMapKey === 'custom' && !includeCustom) return false;
            return isMapEligibleForModePath(sourceMaps[normalizedMapKey], modePath);
        });
}

export function resolveModePathFallbackMapKey(maps, modePath, currentMapKey = '') {
    const sourceMaps = maps && typeof maps === 'object' ? maps : {};
    const normalizedCurrentMapKey = normalizeString(currentMapKey, '');
    if (normalizedCurrentMapKey && isMapEligibleForModePath(sourceMaps[normalizedCurrentMapKey], modePath)) {
        return normalizedCurrentMapKey;
    }

    const eligibleKeys = listEligibleMapKeysForModePath(sourceMaps, modePath);
    if (eligibleKeys.length === 0) {
        return sourceMaps.standard ? 'standard' : normalizeString(Object.keys(sourceMaps)[0], 'standard');
    }

    const preferredFallbackKey = normalizeModePath(modePath) === 'arcade' ? 'parcours_rift' : 'standard';
    if (eligibleKeys.includes(preferredFallbackKey)) {
        return preferredFallbackKey;
    }
    return eligibleKeys[0];
}
