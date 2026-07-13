export const GAME_STATE_IDS = Object.freeze({
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    ROUND_END: 'ROUND_END',
    MATCH_END: 'MATCH_END',
});

/** @typedef {(typeof GAME_STATE_IDS)[keyof typeof GAME_STATE_IDS]} GameStateId */

const VALID_GAME_STATE_IDS = new Set(/** @type {string[]} */ (Object.values(GAME_STATE_IDS)));

export function normalizeGameStateId(value, fallback = GAME_STATE_IDS.MENU) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /** @type {GameStateId} */ (VALID_GAME_STATE_IDS.has(normalized) ? normalized : fallback);
}

export function isGameState(value, expectedState) {
    const normalizedValue = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const normalizedExpected = typeof expectedState === 'string' ? expectedState.trim().toUpperCase() : '';
    return VALID_GAME_STATE_IDS.has(normalizedValue) && normalizedValue === normalizedExpected;
}
