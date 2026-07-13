export const ARCADE_GHOST_DUEL_CONTRACT_VERSION = 'arcade-ghost-duel.v1';

export const ARCADE_GHOST_DUEL_MODES = Object.freeze({
    OFF: 'off',
    SELF_LONGEST_GHOST: 'self_longest_ghost',
});

/** @type {Set<string>} */
const VALID_ARCADE_GHOST_DUEL_MODE_SET = new Set(Object.values(ARCADE_GHOST_DUEL_MODES));

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || fallback;
}

export function normalizeArcadeGhostDuelMode(value, fallback = ARCADE_GHOST_DUEL_MODES.OFF) {
    const normalizedFallback = normalizeString(fallback, ARCADE_GHOST_DUEL_MODES.OFF);
    const safeFallback = VALID_ARCADE_GHOST_DUEL_MODE_SET.has(normalizedFallback)
        ? normalizedFallback
        : ARCADE_GHOST_DUEL_MODES.OFF;
    const normalized = normalizeString(value, safeFallback);
    return VALID_ARCADE_GHOST_DUEL_MODE_SET.has(normalized)
        ? normalized
        : safeFallback;
}

export function isArcadeGhostDuelPlaybackEnabled(mode) {
    return normalizeArcadeGhostDuelMode(mode) === ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST;
}

export function normalizeArcadeGhostTrailCollisionEnabled(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
            return true;
        }
        if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
            return false;
        }
    }
    return fallback === true;
}
