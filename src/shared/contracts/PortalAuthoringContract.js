export function resolvePortalMode(map) {
    const explicitMode = String(map?.portalMode || '').trim().toLowerCase();
    if (explicitMode === 'dynamic' || explicitMode === 'authored' || explicitMode === 'hybrid') return explicitMode;
    const hasAuthoredPortals = Array.isArray(map?.portals) && map.portals.length > 0;
    return map?.preferAuthoredPortals === true || hasAuthoredPortals ? 'authored' : 'dynamic';
}

export function resolvePortalPairCount(portalEntryCount) {
    return Math.max(0, Math.floor((Number(portalEntryCount) || 0) / 2));
}
