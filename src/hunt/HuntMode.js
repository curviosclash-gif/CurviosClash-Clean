export const GAME_MODE_TYPES = Object.freeze({
    CLASSIC: 'CLASSIC',
    HUNT: 'HUNT',
    ESCORT: 'ESCORT',
    ARCADE: 'ARCADE',
});

export function normalizeGameMode(mode, fallback = GAME_MODE_TYPES.CLASSIC) {
    const raw = String(mode || '').trim().toUpperCase();
    if (raw === GAME_MODE_TYPES.HUNT) return GAME_MODE_TYPES.HUNT;
    if (raw === GAME_MODE_TYPES.ESCORT) return GAME_MODE_TYPES.ESCORT;
    if (raw === GAME_MODE_TYPES.ARCADE) return GAME_MODE_TYPES.ARCADE;
    if (raw === GAME_MODE_TYPES.CLASSIC) return GAME_MODE_TYPES.CLASSIC;
    return fallback;
}

export function resolveActiveGameMode(requestedMode, isHuntEnabled = true) {
    const normalized = normalizeGameMode(requestedMode);
    if (!isHuntEnabled && (normalized === GAME_MODE_TYPES.HUNT || normalized === GAME_MODE_TYPES.ESCORT)) {
        return GAME_MODE_TYPES.CLASSIC;
    }
    return normalized;
}

export function isHuntMode(mode, isHuntEnabled = true) {
    const active = resolveActiveGameMode(mode, isHuntEnabled);
    return active === GAME_MODE_TYPES.HUNT || active === GAME_MODE_TYPES.ESCORT;
}
