// ============================================
// GameStateSnapshot.js - serializable game state for network transport
// ============================================

/**
 * Creates a JSON-serializable snapshot of the current game state.
 * Used for:
 * - Host → Client state synchronization (10/s)
 * - Replay recording
 * - Checksum verification
 */

export function createGameStateSnapshot(entityManager, roundState) {
    const players = [];
    const allPlayers = entityManager?.players || [];

    for (let i = 0; i < allPlayers.length; i++) {
        const p = allPlayers[i];
        players.push(serializePlayer(p));
    }

    const projectiles = [];
    const allProjectiles = entityManager?.projectiles || [];
    for (let i = 0; i < allProjectiles.length; i++) {
        const proj = allProjectiles[i];
        if (!proj?.active) continue;
        projectiles.push({
            id: proj.id || i,
            pos: vecToArray(proj.position),
            vel: vecToArray(proj.velocity),
            owner: proj.ownerIndex ?? -1,
            type: proj.type || 'mg',
        });
    }

    const powerups = [];
    const allPowerups = entityManager?.powerups || [];
    for (let i = 0; i < allPowerups.length; i++) {
        const pu = allPowerups[i];
        if (!pu?.active) continue;
        powerups.push({
            id: pu.id || i,
            pos: vecToArray(pu.position),
            type: pu.type || '',
        });
    }

    return {
        frame: roundState?.frame ?? 0,
        players,
        projectiles,
        powerups,
        roundState: roundState ? {
            round: roundState.round ?? 0,
            timeRemaining: roundState.timeRemaining ?? 0,
            scores: roundState.scores || [],
        } : null,
    };
}

export function serializePlayer(player) {
    if (!player) return null;
    return {
        id: player.id || `p-${player.index}`,
        index: player.index ?? 0,
        isBot: !!player.isBot,
        alive: !!player.alive,
        pos: vecToArray(player.position),
        rot: quatToArray(player.quaternion),
        vel: vecToArray(player.velocity),
        // `health` is the established wire key; live Player instances store the value as `hp`.
        health: toFiniteNumber(player.hp ?? player.health, 100),
        score: player.score ?? 0,
        inventory: Array.isArray(player.inventory) ? [...player.inventory] : [],
        effects: serializeEffects(player.activeEffects),
        hasShield: player.hasShield === true,
        shieldHP: toFiniteNumber(player.shieldHP, 0),
        speed: toFiniteNumber(player.speed, 0),
    };
}

function vecToArray(vec) {
    if (!vec) return [0, 0, 0];
    return [vec.x || 0, vec.y || 0, vec.z || 0];
}

function quatToArray(quat) {
    if (!quat) return [0, 0, 0, 1];
    return [
        toFiniteNumber(quat.x, 0),
        toFiniteNumber(quat.y, 0),
        toFiniteNumber(quat.z, 0),
        toFiniteNumber(quat.w, 1),
    ];
}

function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function serializeEffects(effects) {
    if (!Array.isArray(effects) || effects.length <= 0) return [];
    return effects
        .map((effect) => {
            const type = String(effect?.type || '').trim();
            if (!type) return null;
            return {
                type,
                remaining: Number(effect?.remaining) || 0,
            };
        })
        .filter(Boolean);
}

