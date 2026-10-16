import { clamp } from '../../shared/utils/MathOps.js';
import { checkArenaCollision } from './HeuristicBotSafetyOps.js';
import { canTargetEnemy } from '../../shared/contracts/TeamCombatContract.js';
import { applyHeuristicHuntBehavior } from './HeuristicHuntTacticsOps.js';
import { shouldHuntParcoursRivalFireAtTarget } from './HeuristicHuntParcoursModifierOps.js';

/**
 * Race when no close combat target is pressuring the bot; hunt when an opponent is close.
 * raceWeight 0 always hunts, 1 always flies the route, intermediate values shift the
 * distance at which the bot switches between the two established policies.
 */
export function applyHeuristicRaceHuntBehavior(policy, input, dt, player, runtimeContext, observation, {
    raceWeight = 0.6,
} = {}) {
    const weight = clamp(Number(raceWeight) || 0, 0, 1);
    const state = policy._raceHuntState;
    const seconds = Math.max(0, Number(dt) || 0);
    const players = runtimeContext?.visiblePlayers || runtimeContext?.players || [];
    let nearest = null;
    let distanceSq = Infinity;
    for (const other of players) {
        if (!other?.alive || !other.position || !canTargetEnemy(player, other)) continue;
        const distance = player.position.distanceToSquared(other.position);
        if (distance < distanceSq) { nearest = other; distanceSq = distance; }
    }
    state.routeSeconds = Math.max(0, state.routeSeconds - seconds);
    const reach = 120 * (1 - weight);
    const leaveReach = state.combatSeconds > 0 ? reach * 1.25 : reach;
    let combat = weight < 1 && nearest && distanceSq <= leaveReach * leaveReach && state.routeSeconds <= 0;
    if (combat && weight > 0 && policy._resolveParcoursTarget(runtimeContext, player, policy._tmpRoleTarget)) {
        const detour = Math.sqrt(distanceSq) + nearest.position.distanceTo(policy._tmpRoleTarget)
            - player.position.distanceTo(policy._tmpRoleTarget);
        if (detour > 60 * (1 - weight)) { combat = false; state.routeSeconds = 1.2; }
    }
    if (combat) {
        const radius = Math.max(0.1, Number(player.arcadeAvoidRadius || player.hitboxRadius) || 0.8);
        for (let sample = 1; sample < 6; sample++) {
            policy._tmpRoleForward.copy(player.position).lerp(nearest.position, sample / 6);
            if (checkArenaCollision(runtimeContext?.arena, policy._tmpRoleForward, radius)) {
                combat = false; state.routeSeconds = 1.2; break;
            }
        }
    }
    // Combat detours have a budget; even an evasive opponent cannot hold the bot off route forever.
    if (combat && weight > 0 && state.combatSeconds + seconds >= 2) {
        combat = false;
        state.routeSeconds = 1.2;
    }
    state.combatSeconds = combat ? state.combatSeconds + seconds : 0;
    const decision = combat
        ? applyHeuristicHuntBehavior(policy, input, dt, player, runtimeContext, observation)
        : policy._applyArcadeBehavior(input, dt, player, runtimeContext, observation);
    if (combat) {
        let target = null;
        for (const other of players) if (other?.index === decision?.targetPlayerIndex) { target = other; break; }
        if (!shouldHuntParcoursRivalFireAtTarget(player, target, policy._tmpForward, policy.difficulty.aimDot)) {
            input.shootMG = false;
            input.shootRocket = false;
            input.shootItem = false;
        }
    }
    if (decision) decision.intent = combat ? 'race-hunt-combat' : 'race-hunt-route';
    return decision;
}
