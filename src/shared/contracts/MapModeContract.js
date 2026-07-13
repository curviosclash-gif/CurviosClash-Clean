import { normalizeString } from './ContractNormalizeUtils.js';

const MAP_MODE_PATHS = new Set(['normal', 'arcade', 'fight', 'quick_action']);

function normalizeModePath(modePath) {
    const normalized = normalizeString(modePath, 'normal').toLowerCase();
    return MAP_MODE_PATHS.has(normalized) ? normalized : 'normal';
}

export function isParcoursMapDefinition(mapDefinition) {
    return !!(mapDefinition && typeof mapDefinition === 'object' && mapDefinition.parcours?.enabled === true);
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
