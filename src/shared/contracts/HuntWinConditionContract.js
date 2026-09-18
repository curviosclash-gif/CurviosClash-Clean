// The saved menu choice and the match runtime use the same legacy-safe value.
export const HUNT_WIN_CONDITIONS = Object.freeze({
    KILLS_TIME: 'kills_time',
    LAST_ALIVE: 'last_alive',
    SCORE_TARGET: 'score_target',
});

/** @param {unknown} value */
export function normalizeHuntWinCondition(value) {
    if (value === HUNT_WIN_CONDITIONS.LAST_ALIVE || value === HUNT_WIN_CONDITIONS.SCORE_TARGET) return value;
    return HUNT_WIN_CONDITIONS.KILLS_TIME;
}
