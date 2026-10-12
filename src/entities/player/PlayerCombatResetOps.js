// ============================================
// PlayerCombatResetOps.js - combat leftovers a new life must not inherit
// ============================================
//
// Contract:
// - Inputs: player entity
// - Outputs: weapon, cooldown and fight-tracking fields back at their start values
// - Side effects: mutates the player only
// - Used by Player.spawn (round start and respawn both go through it) and by the spawn paths
//   for the tracking fields, so both paths reset exactly the same state.

/**
 * Player.spawn empties activeEffects, but these fields are derived from them and only refreshed
 * by the next effect tick, so they have to be reset together with the effect list.
 * @param {object} player
 */
export function resetPlayerCombatState(player) {
    if (!player) return;
    player.flameActive = false;
    player.hasFlamethrower = false;
    player.flameFuelSeconds = 0;
    player.hasRailgun = false;
    player.railShots = 0;
    player.slowTimeExemptsOwner = false;
    player.arcadeBurstShots = 0;
    player.shootCooldownCarry = 0;
}

/**
 * What a kill has to switch off at once, because a dead player stops updating: a clock effect
 * would freeze the whole match in slow motion until the next spawn, and FlamethrowerSystem skips
 * dead players, so a burning jet would stay in the snapshot.
 * @param {object} player
 */
export function clearDeadPlayerEffects(player) {
    if (!player) return;
    player.manualSlowMoActive = false;
    player.isSlowMoActive = false;
    player.hasSlowTime = false;
    player.slowTimeScale = 1;
    player.flameActive = false;
}

/**
 * Fight bookkeeping of a fresh life: nobody attacked it, it targets nobody, its weapon is ready.
 * @param {object} player
 * @param {number} nowSeconds simulation time of the spawn
 */
export function resetPlayerFightTracking(player, nowSeconds) {
    if (!player) return;
    player.fightLastAttackerIndex = -1;
    player.fightLastThreatSourceIndex = -1;
    player.fightLastThreatAtSeconds = -Infinity;
    player.fightTargetPlayerIndex = -1;
    player.fightTargetLockRemaining = 0;
    player.fightSpawnedAtSeconds = Math.max(0, Number(nowSeconds) || 0);
    player.shootCooldown = 0;
}
