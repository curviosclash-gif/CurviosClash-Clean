export const HUNT_LAST_ALIVE_LIVES = 3;

/** @param {unknown} source */
export function normalizeHuntLivesByPlayer(source) {
    /** @type {Record<string, number>} */
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    for (const [index, raw] of Object.entries(source)) {
        if (!/^(0|[1-9]\d*)$/.test(index)) continue;
        const value = Number(raw);
        if (Number.isFinite(value)) result[index] = Math.max(0, Math.min(HUNT_LAST_ALIVE_LIVES, Math.trunc(value)));
    }
    return result;
}
