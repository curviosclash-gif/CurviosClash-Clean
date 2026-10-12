/**
 * Whether bots may shoot at a map's destructible structure in the given mode - the one place this
 * decision is made. Only the hunt opens it: there a collapse is scenery and no win condition. In a
 * demolition run (an arcade mode) the structure is the player's score target, with points, an
 * order bonus and a seal, so a bot must not take it apart - and every other mode keeps its bots
 * off it as well.
 * @param {unknown} gameMode
 * @returns {boolean}
 */
export function allowsBotMapDestructibleFire(gameMode) {
    return typeof gameMode === 'string' && gameMode.trim().toUpperCase() === 'HUNT';
}

/**
 * Whether a weapon target is a structure segment bots have to leave alone. Tanks, turrets and
 * every other target are never closed by this rule; a segment is open to bots only when the round
 * that built it marked it with `botTarget`.
 * @param {{ mapStructure?: unknown, botTarget?: unknown } | null | undefined} target
 * @returns {boolean}
 */
export function isMapStructureClosedToBots(target) {
    return target?.mapStructure === true && target.botTarget !== true;
}

/**
 * Bots rank structure segments below every player, tank and turret, and among themselves the way
 * the HUD picks its focus: the segment with the least health left first. Returns that share, or
 * Infinity for a target that is no structure segment.
 * @param {{ mapStructure?: unknown, hp?: unknown, maxHp?: unknown } | null | undefined} target
 * @returns {number}
 */
export function resolveBotStructureFocusRatio(target) {
    if (target?.mapStructure !== true) return Infinity;
    const maxHp = Number(target.maxHp);
    const hp = Number(target.hp);
    if (!Number.isFinite(maxHp) || maxHp <= 0 || !Number.isFinite(hp)) return Infinity;
    return Math.min(1, Math.max(0, hp / maxHp));
}
