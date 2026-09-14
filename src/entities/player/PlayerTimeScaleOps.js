// ============================================
// PlayerTimeScaleOps.js - per-player compensation of the global slow-time scale
// ============================================
//
// The SLOW_TIME pickup slows the whole game loop (GameLoop.timeScale). A definition may
// exempt its owner: the loop still runs slow for everyone, but the owner's motion, trail
// and shoot cooldown are stepped with dt / globalScale so they experience real time.

const MIN_TIME_SCALE = 0.05;

/**
 * Smallest active slow-time scale across the roster, clamped to [0.05, 1].
 * @param {Array<object>} players
 * @returns {number}
 */
export function resolveGlobalSlowTimeScale(players) {
    let scale = 1;
    if (!Array.isArray(players)) return scale;
    for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i];
        if (!candidate?.hasSlowTime) continue;
        const candidateScale = Number(candidate.slowTimeScale);
        if (Number.isFinite(candidateScale)) scale = Math.min(scale, candidateScale);
    }
    return Math.max(MIN_TIME_SCALE, Math.min(1, scale));
}

/**
 * Factor to multiply a loop-scaled dt with so the player steps in real time.
 * Only a player who owns an exempting slow-time effect is compensated; everyone else gets 1.
 * @param {object} player
 * @returns {number}
 */
export function resolveOwnerTimeCompensation(player) {
    if (!player?.hasSlowTime || player.slowTimeExemptsOwner !== true) return 1;
    const players = Array.isArray(player.entityManager?.players)
        ? player.entityManager.players
        : [player];
    return 1 / resolveGlobalSlowTimeScale(players);
}
