import { TEAM_OBJECTIVE_TYPES } from '../shared/contracts/FlagObjectiveContract.js';
import { normalizeTeamId } from '../shared/contracts/TeamCombatContract.js';
import { applySteeringTowardPosition, clearSteeringInput } from './HuntBotSteeringOps.js';

export const FLAG_BOT_ROLES = Object.freeze({
    DEFENDER: 'defender',
    ATTACKER: 'attacker',
    FLEX: 'flex',
});

export function resolveFlagBotRole(player) {
    const slot = Math.max(0, Math.trunc(Number(player?.index) || 0)) % 3;
    if (slot === 0) return FLAG_BOT_ROLES.DEFENDER;
    if (slot === 1) return FLAG_BOT_ROLES.ATTACKER;
    return FLAG_BOT_ROLES.FLEX;
}

function resolveFlags(runtimeContext) {
    if (runtimeContext?.runtimeConfig?.hunt?.teamObjective !== TEAM_OBJECTIVE_TYPES.FLAGS) return [];
    const flags = runtimeContext?.entityManager?._flagObjectiveSystem?.flags;
    return Array.isArray(flags) ? flags : [];
}

export function resolveFlagObjectiveTarget(player, runtimeContext) {
    if (!player?.position) return null;
    const teamId = normalizeTeamId(player.teamId);
    if (!teamId) return null;
    const flags = resolveFlags(runtimeContext);
    if (flags.length === 0) return null;
    const role = resolveFlagBotRole(player);
    let ownCount = 0;
    let enemyCount = 0;
    for (const flag of flags) {
        if (normalizeTeamId(flag?.teamId) === teamId) ownCount += 1;
        else enemyCount += 1;
    }
    const seekEnemy = role === FLAG_BOT_ROLES.ATTACKER
        || (role === FLAG_BOT_ROLES.FLEX && ownCount <= enemyCount);
    let target = null;
    let bestScore = Infinity;
    for (const flag of flags) {
        if (!flag?.position) continue;
        const isOwn = normalizeTeamId(flag.teamId) === teamId;
        if (seekEnemy === isOwn) continue;
        const dx = Number(flag.position.x) - Number(player.position.x);
        const dy = Number(flag.position.y) - Number(player.position.y);
        const dz = Number(flag.position.z) - Number(player.position.z);
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (!Number.isFinite(distanceSq)) continue;
        const healthRatio = Math.max(0, Math.min(1,
            (Number(flag.hp) || 0) / Math.max(1, Number(flag.maxHp) || 1)));
        const vulnerabilityBias = seekEnemy ? 0.55 + healthRatio * 0.45 : 0.7 + (1 - healthRatio) * 0.3;
        const score = distanceSq * vulnerabilityBias;
        if (score < bestScore) {
            bestScore = score;
            target = flag;
        }
    }
    return target;
}

export function applyFlagObjectiveMovement(
    policy, input, player, runtimeContext, retreating = false, survivalPressure = 0, mgRange = 95,
) {
    if (retreating || survivalPressure >= 0.86) return null;
    const target = resolveFlagObjectiveTarget(player, runtimeContext);
    if (!target?.position || !player?.position) return null;
    const distanceSq = player.position.distanceToSquared(target.position);
    const role = resolveFlagBotRole(player);
    const isEnemyObjective = normalizeTeamId(target.teamId) !== normalizeTeamId(player.teamId);
    if (isEnemyObjective || distanceSq > 18 * 18) {
        clearSteeringInput(input);
        applySteeringTowardPosition(policy, input, player, target.position);
        input.boost = distanceSq > 34 * 34 && survivalPressure < 0.6;
    }
    if (isEnemyObjective && distanceSq <= Math.max(12, Number(mgRange) || 95) ** 2) {
        input.shootMG = true;
    }
    return { role, target, distanceSq, isEnemyObjective };
}

export default { applyFlagObjectiveMovement, resolveFlagBotRole, resolveFlagObjectiveTarget };
