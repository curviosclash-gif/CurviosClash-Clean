const DEFAULT_SCENARIO_BOT_TUNING = Object.freeze({
    role: '',
    aggressionBonus: 0,
    retreatVitality: 0.34,
    anchorRadius: 0,
    flankOffset: 0,
    chaseBoostDistance: 0,
    prefersRocket: false,
});

const SCENARIO_BOT_TUNING = Object.freeze({
    guard: Object.freeze({ role: 'guard', aggressionBonus: 0.12, retreatVitality: 0.24, anchorRadius: 24, flankOffset: 0, chaseBoostDistance: 0, prefersRocket: false }),
    flanker: Object.freeze({ role: 'flanker', aggressionBonus: 0.2, retreatVitality: 0.3, anchorRadius: 0, flankOffset: 18, chaseBoostDistance: 34, prefersRocket: false }),
    pursuer: Object.freeze({ role: 'pursuer', aggressionBonus: 0.3, retreatVitality: 0.22, anchorRadius: 0, flankOffset: 0, chaseBoostDistance: 24, prefersRocket: false }),
    interceptor: Object.freeze({ role: 'interceptor', aggressionBonus: 0.24, retreatVitality: 0.26, anchorRadius: 0, flankOffset: 0, chaseBoostDistance: 30, prefersRocket: true }),
    // Der Anfuehrer der Endlosjagd zieht durch und weicht kaum zurueck.
    elite: Object.freeze({ role: 'elite', aggressionBonus: 0.42, retreatVitality: 0.12, anchorRadius: 0, flankOffset: 0, chaseBoostDistance: 20, prefersRocket: true }),
});

export function resolveScenarioBotTuning(player = null) {
    const role = String(player?.scenarioRole || '').trim().toLowerCase();
    return SCENARIO_BOT_TUNING[role] || DEFAULT_SCENARIO_BOT_TUNING;
}

export function applyScenarioRoleMovement({
    policy,
    input,
    player,
    enemy,
    distSq,
    tuning,
    shouldRetreat,
    clearSteering,
    steerToward,
}) {
    if (!tuning?.role || shouldRetreat || !player?.position) return;

    if (tuning.role === 'guard' && player.scenarioAnchor) {
        policy._tmpRoleTarget.set(
            Number(player.scenarioAnchor.x) || 0,
            Number(player.scenarioAnchor.y) || 0,
            Number(player.scenarioAnchor.z) || 0
        );
        const anchorDistanceSq = policy._tmpRoleTarget.distanceToSquared(player.position);
        if (anchorDistanceSq > tuning.anchorRadius * tuning.anchorRadius) {
            clearSteering(input);
            steerToward(policy, input, player, policy._tmpRoleTarget);
            input.boost = anchorDistanceSq > (tuning.anchorRadius * 1.6) ** 2;
        }
        return;
    }

    if (!enemy?.position) return;
    if (tuning.role === 'flanker' && distSq > 14 * 14) {
        const side = Number(player.index) % 2 === 0 ? 1 : -1;
        policy._tmpRoleTarget.copy(enemy.position);
        policy._tmpRoleTarget.z += tuning.flankOffset * side;
        clearSteering(input);
        steerToward(policy, input, player, policy._tmpRoleTarget);
    } else if ((tuning.role === 'interceptor' || tuning.role === 'elite') && distSq > 18 * 18) {
        policy._tmpRoleTarget.copy(enemy.position);
        if (typeof enemy.getDirection === 'function') {
            enemy.getDirection(policy._tmpRoleForward);
            if (policy._tmpRoleForward.lengthSq() > 0.000001) {
                policy._tmpRoleTarget.addScaledVector(policy._tmpRoleForward.normalize(), 18);
            }
        }
        clearSteering(input);
        steerToward(policy, input, player, policy._tmpRoleTarget);
    }

    if (tuning.chaseBoostDistance > 0 && distSq > tuning.chaseBoostDistance * tuning.chaseBoostDistance) {
        input.boost = true;
    }
}

export default {
    applyScenarioRoleMovement,
    resolveScenarioBotTuning,
};
