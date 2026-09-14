// ============================================
// EnvironmentKillCreditOps.js - credits environment deaths to whoever forced them
// ============================================
//
// Contract:
// - Inputs: death cause, victim, roster, recent hit ages, simulation-clock seconds
// - Outputs: { killer, credit } with credit 'hit' | 'threat' | null
// - Side effects: none; every clock value is supplied by the caller
//
// Hits arrive as ages (seconds since the hit) because the damage history is stamped on the
// scoring clock, while the dodged-threat timestamp is stamped on the simulation clock.

export const ENVIRONMENT_KILL_HIT_WINDOW_SECONDS = 4;
export const ENVIRONMENT_KILL_THREAT_WINDOW_SECONDS = 2;
const ENVIRONMENT_KILL_CAUSES = new Set(['WALL', 'TRAIL_SELF', 'TRAIL_OTHER']);
const NO_CREDIT = Object.freeze({ killer: null, credit: null });

export function isEnvironmentKillCause(cause) {
    return ENVIRONMENT_KILL_CAUSES.has(String(cause || '').toUpperCase());
}

/**
 * Notes on the player which projectile owner it was evading. Bot behaviour never reads these
 * fields; they only feed the kill credit when the evasive move ends in the arena geometry.
 */
export function rememberDodgedProjectileThreat(player, projectileOwner, nowSeconds) {
    if (!player || !projectileOwner || projectileOwner === player) return;
    const ownerIndex = Number(projectileOwner.index);
    if (!Number.isInteger(ownerIndex) || ownerIndex === Number(player.index)) return;
    const stampSeconds = Number(nowSeconds);
    if (!Number.isFinite(stampSeconds)) return;
    player.fightLastThreatSourceIndex = ownerIndex;
    player.fightLastThreatAtSeconds = stampSeconds;
}

function findCreditablePlayer(players, playerIndex, victimIndex) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex === victimIndex) return null;
    if (!Array.isArray(players)) return null;
    for (let i = 0; i < players.length; i++) {
        const candidate = players[i];
        if (!candidate || candidate.entitySlotActive === false) continue;
        if (Number(candidate.index) === playerIndex) return candidate;
    }
    return null;
}

function resolveLastAttackerIndex(damageHistory, victimIndex, windowSeconds) {
    if (!Array.isArray(damageHistory) || damageHistory.length === 0) return -1;
    let bestIndex = -1;
    let bestAge = Infinity;
    for (let i = 0; i < damageHistory.length; i++) {
        const entry = damageHistory[i];
        const attackerIndex = Number(entry?.attackerIndex);
        if (!Number.isInteger(attackerIndex) || attackerIndex === victimIndex) continue;
        const ageSeconds = Number(entry?.ageSeconds);
        // A negative age means the stamp outlived its clock (round reset), never a fresh hit.
        if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > windowSeconds) continue;
        if (ageSeconds >= bestAge) continue;
        bestAge = ageSeconds;
        bestIndex = attackerIndex;
    }
    return bestIndex;
}

/**
 * Resolves who gets the kill when a player dies to the arena instead of to a weapon.
 * Stage 1 credits the most recent attacker inside the hit window, stage 2 credits the
 * owner of the projectile the victim was still dodging.
 * @param {object} input
 * @param {string} input.cause death cause, only WALL/TRAIL_SELF/TRAIL_OTHER can be credited
 * @param {object} input.victim the dead player
 * @param {Array<object>} [input.players] roster used to map an index back to a player
 * @param {Array<{attackerIndex: number, ageSeconds: number}>} [input.damageHistory] recent hits
 * @param {number} [input.nowSeconds] simulation clock seconds, used for the threat stamp
 * @param {number} [input.hitWindowSeconds]
 * @param {number} [input.threatWindowSeconds]
 * @returns {{killer: object|null, credit: string|null}}
 */
export function resolveEnvironmentKillCredit({
    cause,
    victim,
    players = [],
    damageHistory = [],
    nowSeconds = 0,
    hitWindowSeconds = ENVIRONMENT_KILL_HIT_WINDOW_SECONDS,
    threatWindowSeconds = ENVIRONMENT_KILL_THREAT_WINDOW_SECONDS,
} = {}) {
    if (!isEnvironmentKillCause(cause)) return NO_CREDIT;
    const victimIndex = Number(victim?.index);
    if (!Number.isInteger(victimIndex)) return NO_CREDIT;
    const now = Number(nowSeconds) || 0;

    const attackerIndex = resolveLastAttackerIndex(damageHistory, victimIndex, hitWindowSeconds);
    const attacker = findCreditablePlayer(players, attackerIndex, victimIndex);
    if (attacker) return { killer: attacker, credit: 'hit' };

    const threatAt = Number(victim?.fightLastThreatAtSeconds);
    const threatAge = now - threatAt;
    if (Number.isFinite(threatAt) && threatAge >= 0 && threatAge <= threatWindowSeconds) {
        const threatOwner = findCreditablePlayer(
            players,
            Number(victim?.fightLastThreatSourceIndex),
            victimIndex
        );
        if (threatOwner) return { killer: threatOwner, credit: 'threat' };
    }

    return NO_CREDIT;
}
