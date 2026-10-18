import { canTargetEnemy } from '../shared/contracts/TeamCombatContract.js';

function clearSegment(arena, from, to, radius, scratch) {
    // Inflate each sample by half its spacing: their union conservatively covers
    // the swept sphere, including thin obstacles between sample centres.
    const paddedRadius = radius + from.distanceTo(to) / 16;
    for (let sample = 0; sample <= 8; sample++) {
        scratch.copy(from).lerp(to, sample / 8);
        if (arena?.checkCollisionFast?.(scratch, paddedRadius)) return false;
    }
    return true;
}

/** Optional Endlos navigation; retain the existing policy's weapons and close combat. */
/** @param {{policy?: any, input?: any, player?: any, runtimeContext?: any, shouldRetreat?: boolean, clearSteering?: any, steerToward?: any}} options */
export function applyHuntBotParcoursMovement({ policy, input, player, runtimeContext, shouldRetreat, clearSteering, steerToward } = {}) {
    if (!player?.isBot || !player.endlessRunId || shouldRetreat) return null;
    const manager = runtimeContext?.entityManager || player.entityManager;
    const route = manager?.getParcoursRouteSnapshot?.(player.index);
    if (!route?.enabled || route.kind !== 'endless_hunter' || route.runId !== player.endlessRunId) return null;
    const target = route.checkpoints?.[0]?.pos;
    if (!target || !policy?._tmpRoleForward) return null;
    const arena = runtimeContext?.arena || manager.arena;
    const radius = Math.max(0.1, Number(player.arcadeAvoidRadius || player.hitboxRadius) || 2.5);
    // A nearby reachable opponent keeps the normal role movement and all combat
    // decisions. A wall between the opponents makes course navigation necessary.
    for (const enemy of runtimeContext?.visiblePlayers || runtimeContext?.players || []) {
        if (!enemy?.alive || !enemy.position || !canTargetEnemy(player, enemy)) continue;
        if (player.position.distanceToSquared(enemy.position) <= 36 * 36
            && clearSegment(arena, player.position, enemy.position, radius, policy._tmpRoleForward)) return null;
    }
    if (!clearSegment(arena, player.position, target, radius, policy._tmpRoleForward)) return null;
    clearSteering(input);
    steerToward(policy, input, player, target);
    input.boost = false;
    player.botObjectiveType = 'ENDLESS_ROUTE';
    return 'ENDLESS_ROUTE';
}
