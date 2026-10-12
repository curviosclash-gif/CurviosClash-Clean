// ============================================
// BotTargetingOps.js - targeting and pressure operations for BotAI
// ============================================

import { PERCEPTION_THRESHOLDS } from './perception/EnvironmentSamplingOps.js';
import { clamp01 } from '../../shared/utils/MathOps.js';
import { areTeammates, canTargetEnemy } from '../../shared/contracts/TeamCombatContract.js';

const TARGET_RETAIN_BONUS = 0.08;
const TARGET_SWITCH_MARGIN = 0.015;
const TARGET_RETAIN_DISTANCE = 75;
const TARGET_VULNERABILITY_WEIGHT = 0.2;

function resolveTargetVulnerability(target) {
    const maxHp = Number(target?.maxHp);
    const hp = Number(target?.hp);
    if (!Number.isFinite(maxHp) || maxHp <= 0 || !Number.isFinite(hp)) return 0;
    return 1 - clamp01(hp / maxHp);
}

export function isTargetVisibleToPlayer(player, target) {
    const manager = player?.entityManager;
    const visibilityCheck = manager?.isPositionVisible
        || manager?.isPositionVisibleDuringGlobalFog;
    return visibilityCheck?.call(
        manager,
        player?.position,
        target?.position
    ) !== false;
}

/**
 * Map units a bot may chase when `player.botTargetsMapUnits` is set: alive, not the escort it
 * protects and not on its own team. The list is MapUnitSystem's reused target array.
 */
function isHuntableMapUnit(player, unit) {
    if (!unit?.position || unit.alive === false || !(Number(unit.hp) > 0) || unit.escortTank === true) return false;
    return !unit.teamId || canTargetEnemy(player, unit);
}

export function selectTarget(bot, player, allPlayers) {
    const previousTarget = bot.state.targetPlayer || null;
    const retainBonus = Number.isFinite(Number(bot.profile?.targetRetainBonus))
        ? Math.max(0, Number(bot.profile.targetRetainBonus))
        : TARGET_RETAIN_BONUS;
    const switchMargin = Number.isFinite(Number(bot.profile?.targetSwitchMargin))
        ? Math.max(0, Number(bot.profile.targetSwitchMargin))
        : TARGET_SWITCH_MARGIN;
    const retainDistance = Number.isFinite(Number(bot.profile?.targetRetainDistance))
        ? Math.max(1, Number(bot.profile.targetRetainDistance))
        : TARGET_RETAIN_DISTANCE;
    const retainDistanceSq = retainDistance * retainDistance;

    let bestTarget = null;
    let bestScore = -Infinity;
    let bestDistSq = Infinity;
    let previousScore = -Infinity;
    let previousDistSq = Infinity;

    player.getDirection(bot._tmpForward).normalize();

    for (let i = 0; i < allPlayers.length; i++) {
        const other = allPlayers[i];
        // A teammate (an arcade companion's human, a Team Hunt ally) is never the target.
        if (!other || other === player || !other.alive || areTeammates(player, other) || !isTargetVisibleToPlayer(player, other)) continue;

        bot._tmpVec.subVectors(other.position, player.position);
        const distSq = bot._tmpVec.lengthSq();
        if (distSq < 0.0001) continue;

        const invDist = 1 / Math.max(4, Math.sqrt(distSq));
        const toward = bot._tmpVec.normalize().dot(bot._tmpForward);

        other.getDirection(bot._tmpVec2).normalize();
        bot._tmpVec3.subVectors(player.position, other.position).normalize();
        const threatAlignment = bot._tmpVec2.dot(bot._tmpVec3);
        const vulnerability = resolveTargetVulnerability(other);
        const stickyBonus = other === previousTarget ? retainBonus : 0;

        const score = invDist * 0.9
            + toward * 0.55
            + threatAlignment * 0.35
            + vulnerability * TARGET_VULNERABILITY_WEIGHT
            + stickyBonus;

        if (other === previousTarget) {
            previousScore = score;
            previousDistSq = distSq;
        }

        if (score > bestScore) {
            bestScore = score;
            bestTarget = other;
            bestDistSq = distSq;
        }
    }

    const mapUnits = player.botTargetsMapUnits === true ? player.entityManager?._mapUnitSystem?.getTargets?.() : null;
    if (Array.isArray(mapUnits)) {
        for (let i = 0; i < mapUnits.length; i++) {
            const unit = mapUnits[i];
            if (!isHuntableMapUnit(player, unit) || !isTargetVisibleToPlayer(player, unit)) continue;
            bot._tmpVec.subVectors(unit.position, player.position);
            const distSq = bot._tmpVec.lengthSq();
            if (distSq < 0.0001) continue;
            // Same weights as for players, minus the threat term: a map unit does not aim like a driver.
            const score = (1 / Math.max(4, Math.sqrt(distSq))) * 0.9
                + bot._tmpVec.normalize().dot(bot._tmpForward) * 0.55
                + resolveTargetVulnerability(unit) * TARGET_VULNERABILITY_WEIGHT
                + (unit === previousTarget ? retainBonus : 0);
            if (unit === previousTarget) {
                previousScore = score;
                previousDistSq = distSq;
            }
            if (score > bestScore) {
                bestScore = score;
                bestTarget = unit;
                bestDistSq = distSq;
            }
        }
    }

    const keepPreviousTarget = previousTarget
        && previousTarget.alive
        && previousScore > -Infinity
        && previousDistSq <= retainDistanceSq
        && previousScore + switchMargin >= bestScore;
    if (keepPreviousTarget) {
        bestTarget = previousTarget;
        bestDistSq = previousDistSq;
    }

    bot.state.targetPlayer = bestTarget;
    bot.sense.targetDistanceSq = bestTarget ? bestDistSq : Infinity;

    if (bestTarget) {
        bot._tmpVec.subVectors(bestTarget.position, player.position).normalize();
        bot.sense.targetInFront = bot._tmpVec.dot(bot._tmpForward) > PERCEPTION_THRESHOLDS.targetInFrontDot;
    } else {
        bot.sense.targetInFront = false;
    }
}

export function estimateEnemyPressure(bot, position, owner, allPlayers) {
    let nearestDistSq = Infinity;
    for (let i = 0; i < allPlayers.length; i++) {
        const other = allPlayers[i];
        if (!other || other === owner || !other.alive || areTeammates(owner, other) || !isTargetVisibleToPlayer(owner, other)) continue;
        const d = other.position.distanceToSquared(position);
        if (d < nearestDistSq) nearestDistSq = d;
    }
    if (!isFinite(nearestDistSq)) return 0;
    const dist = Math.sqrt(nearestDistSq);
    return dist >= 40 ? 0 : 1 - dist / 40;
}

export function estimatePointRisk(bot, point, player, arena, allPlayers) {
    const wallHit = (arena.checkBotCollisionFast || arena.checkCollisionFast).call(arena, point, (player.arcadeAvoidRadius || player.hitboxRadius) * 2.0) ? 1 : 0;
    const trailHit = bot.checkTrailHit(point, player, allPlayers) ? 1 : 0;
    const enemyPressure = estimateEnemyPressure(bot, point, player, allPlayers);
    return wallHit * 1.2 + trailHit * 1.5 + enemyPressure * 0.6;
}
