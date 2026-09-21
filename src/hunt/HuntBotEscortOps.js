import { TEAM_IDS } from '../shared/contracts/TeamCombatContract.js';

const ALPHA_ROLES = Object.freeze(['ESCORT', 'VANGUARD', 'GUARD']);
const BRAVO_ROLES = Object.freeze(['HUNTER', 'INTERCEPTOR', 'FLANKER']);

export function resolveEscortBotRole(player, players = []) {
    const teamId = player?.teamId === TEAM_IDS.BRAVO ? TEAM_IDS.BRAVO : TEAM_IDS.ALPHA;
    const playerIndex = Number.isInteger(player?.index) ? player.index : 0;
    let teamOrdinal = 0;
    for (const candidate of players) {
        if (candidate === player || candidate?.teamId !== teamId) continue;
        const candidateIndex = Number.isInteger(candidate?.index) ? candidate.index : Infinity;
        if (candidateIndex < playerIndex) teamOrdinal += 1;
    }
    const roles = teamId === TEAM_IDS.BRAVO ? BRAVO_ROLES : ALPHA_ROLES;
    return roles[teamOrdinal % roles.length];
}

function resolvePathDirection(policy, tank) {
    const nextIndex = Math.min(
        Math.max(0, Number(tank?.toIndex) || 0),
        Math.max(0, (tank?.path?.length || 1) - 1),
    );
    const nextPoint = tank?.path?.[nextIndex];
    const target = policy._tmpRoleTarget;
    const forward = policy._tmpRoleForward;
    if (nextPoint && tank?.position) {
        forward.set(
            Number(Array.isArray(nextPoint) ? nextPoint[0] : nextPoint.x) || 0,
            Number(Array.isArray(nextPoint) ? nextPoint[1] : nextPoint.y) || 0,
            Number(Array.isArray(nextPoint) ? nextPoint[2] : nextPoint.z) || 0,
        )
            .sub(tank.position);
    } else {
        forward.set(0, 0, 1);
    }
    if (forward.lengthSq() <= 0.000001) forward.set(0, 0, 1);
    else forward.normalize();
    target.copy(tank.position);
}

export function applyEscortBotMovement({
    policy,
    input,
    player,
    runtimeContext,
    shouldRetreat = false,
    clearSteering,
    steerToward,
} = {}) {
    const objective = runtimeContext?.escortObjective;
    const tank = runtimeContext?.escortTank;
    if (!objective?.active || !tank?.position || !player?.position || shouldRetreat) return null;

    const role = resolveEscortBotRole(player, runtimeContext?.navigationPlayers || runtimeContext?.players || []);
    player.escortBotRole = role;
    resolvePathDirection(policy, tank);
    const target = policy._tmpRoleTarget;
    const forward = policy._tmpRoleForward;
    const side = ((Number(player.index) || 0) & 1) === 0 ? 1 : -1;
    const downed = objective.phase === 'DOWNED' || objective.phase === 'RECOVERING';
    const alpha = player.teamId !== TEAM_IDS.BRAVO;

    if (alpha && downed) {
        target.copy(tank.position);
    } else if (alpha && role === 'VANGUARD') {
        target.addScaledVector(forward, 24);
    } else if (alpha && role === 'GUARD') {
        target.addScaledVector(forward, -7);
        target.x += forward.z * side * 18;
        target.z -= forward.x * side * 18;
    } else if (alpha) {
        target.addScaledVector(forward, -5);
        target.x += forward.z * side * 9;
        target.z -= forward.x * side * 9;
    } else if (role === 'INTERCEPTOR') {
        target.addScaledVector(forward, 30);
    } else if (role === 'FLANKER') {
        target.addScaledVector(forward, 4);
        target.x += forward.z * side * 28;
        target.z -= forward.x * side * 28;
    } else {
        target.copy(tank.position);
    }

    clearSteering(input);
    steerToward(policy, input, player, target);
    const distanceSq = player.position.distanceToSquared(target);
    input.boost = distanceSq > (alpha ? 34 * 34 : 46 * 46);
    return role;
}
