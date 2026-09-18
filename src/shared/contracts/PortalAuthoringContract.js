export function resolvePortalMode(map) {
    const explicitMode = String(map?.portalMode || '').trim().toLowerCase();
    if (explicitMode === 'dynamic' || explicitMode === 'authored' || explicitMode === 'hybrid') return explicitMode;
    const hasAuthoredPortals = Array.isArray(map?.portals) && map.portals.length > 0;
    return map?.preferAuthoredPortals === true || hasAuthoredPortals ? 'authored' : 'dynamic';
}

export function resolvePortalPairCount(portalEntryCount) {
    return Math.max(0, Math.floor((Number(portalEntryCount) || 0) / 2));
}

// Portal entries a map places when it builds portals itself (dynamic, hybrid, planar).
// The count belongs to the map; this was the old menu default every map shared.
export const DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT = 8;
// Planar flight changes level through portals, so a map without any still gets two pairs.
export const PLANAR_MIN_PORTAL_ENTRY_COUNT = 4;

/**
 * @param {{ portalCount?: unknown } | null | undefined} map
 * @param {{ planarMode?: boolean }} [options]
 * @returns {number}
 */
export function resolveMapPortalEntryCount(map, { planarMode = false } = {}) {
    const count = map?.portalCount;
    const mapCount = Number.isInteger(count) && count >= 0 ? count : DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT;
    return planarMode === true && mapCount === 0 ? PLANAR_MIN_PORTAL_ENTRY_COUNT : mapCount;
}
