const DEFAULT_ACQUIRE_ANGLE_DEG = 12;
const DEFAULT_RELEASE_ANGLE_DEG = 18;
const DEFAULT_LOCK_SECONDS = 0.4;
const GEOMETRY_EPSILON = 0.000001;
const EMPTY_TARGETS = Object.freeze([]);
const allowPlayerTarget = () => true;
const allowExtraTarget = () => true;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function angleToDot(angleDeg) {
    return Math.cos((clamp(Number(angleDeg) || 0, 0, 90) * Math.PI) / 180);
}

function clearHumanAimAssist(player) {
    player.fightAimAssistTargetIndex = -1;
    player.fightAimAssistTarget = null;
    player.fightAimAssistLockRemaining = 0;
}

function isActiveAimAssistTarget(target) {
    if (!target?.position || target.alive === false) return false;
    const hp = Number(target.hp);
    return target.alive === true || (Number.isFinite(hp) && hp > 0);
}

function measureTargetDot(player, target, aimDirection, maxRangeSq, scratch) {
    if (!isActiveAimAssistTarget(target) || target === player) return -Infinity;
    scratch.subVectors(target.position, player.position);
    const distanceSq = scratch.lengthSq();
    if (distanceSq <= GEOMETRY_EPSILON || distanceSq > maxRangeSq) return -Infinity;
    return aimDirection.dot(scratch) / Math.sqrt(distanceSq);
}

/**
 * Redirects a human Fight MG shot without changing vehicle steering or camera state.
 * The caller owns and reuses both vectors; this function allocates no Three.js objects.
 */
export function applyFightHumanAimAssist(player, players, aimDirection, mg, scratch, options = null) {
    if (!player || player.isBot || !player.position || !aimDirection || !scratch) return null;
    if (mg?.HUMAN_AIM_ASSIST_ENABLED === false || aimDirection.lengthSq() <= GEOMETRY_EPSILON) {
        clearHumanAimAssist(player);
        return null;
    }

    aimDirection.normalize();
    const maxRange = Math.max(10, Number(mg?.RANGE) || 95);
    const maxRangeSq = maxRange * maxRange;
    const acquireAngle = clamp(
        Number(mg?.HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG) || DEFAULT_ACQUIRE_ANGLE_DEG,
        0,
        90
    );
    const releaseAngle = clamp(
        Number(mg?.HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG) || DEFAULT_RELEASE_ANGLE_DEG,
        acquireAngle,
        90
    );
    const acquireDot = angleToDot(acquireAngle);
    const releaseDot = angleToDot(releaseAngle);
    const currentTargetIndex = Number.isInteger(player.fightAimAssistTargetIndex)
        ? player.fightAimAssistTargetIndex
        : -1;
    const playerTargets = Array.isArray(players) ? players : [];
    const extraTargets = Array.isArray(options?.extraTargets) ? options.extraTargets : EMPTY_TARGETS;
    const canUsePlayerTarget = typeof options?.canUsePlayerTarget === 'function'
        ? options.canUsePlayerTarget
        : allowPlayerTarget;
    const canUseExtraTarget = typeof options?.canUseExtraTarget === 'function'
        ? options.canUseExtraTarget
        : allowExtraTarget;
    const storedTarget = player.fightAimAssistTarget || null;
    let currentTarget = storedTarget;
    if (currentTarget) {
        const isPlayerTarget = playerTargets.includes(currentTarget);
        if ((isPlayerTarget && !canUsePlayerTarget(currentTarget, player))
            || (!isPlayerTarget && (!extraTargets.includes(currentTarget)
                || !canUseExtraTarget(currentTarget, player)))) {
            currentTarget = null;
        }
    }
    if (!isActiveAimAssistTarget(currentTarget)) currentTarget = null;
    if (!currentTarget) {
        for (const candidate of playerTargets) {
            if (candidate?.index === currentTargetIndex && canUsePlayerTarget(candidate, player)) {
                currentTarget = candidate;
                break;
            }
        }
    }
    const currentDot = currentTarget
        ? measureTargetDot(player, currentTarget, aimDirection, maxRangeSq, scratch)
        : -Infinity;
    const currentDistanceSq = Number.isFinite(currentDot) ? scratch.lengthSq() : Infinity;
    const currentInsideReleaseCone = currentDot >= releaseDot;
    const lockActive = Math.max(0, Number(player.fightAimAssistLockRemaining) || 0) > 0;

    let target = currentInsideReleaseCone && lockActive ? currentTarget : null;
    let bestDot = target ? currentDot : acquireDot;
    let bestDistanceSq = target ? currentDistanceSq : Infinity;

    if (!target) {
        for (let pass = 0; pass < 2; pass += 1) {
            const candidates = pass === 0 ? playerTargets : extraTargets;
            for (const candidate of candidates) {
                if ((pass === 0 && !canUsePlayerTarget(candidate, player))
                    || (pass === 1 && !canUseExtraTarget(candidate, player))) continue;
                const candidateDot = measureTargetDot(player, candidate, aimDirection, maxRangeSq, scratch);
                if (candidateDot < acquireDot) continue;
                const candidateDistanceSq = scratch.lengthSq();
                if (candidateDot > bestDot || (
                    candidateDot === bestDot && candidateDistanceSq < bestDistanceSq
                )) {
                    target = candidate;
                    bestDot = candidateDot;
                    bestDistanceSq = candidateDistanceSq;
                }
            }
        }
        if (!target && currentInsideReleaseCone) target = currentTarget;
    }

    if (!target) {
        clearHumanAimAssist(player);
        return null;
    }

    const nextTargetIndex = playerTargets.includes(target) && Number.isInteger(target.index)
        ? target.index
        : -1;
    if (target !== storedTarget || nextTargetIndex !== currentTargetIndex) {
        player.fightAimAssistTarget = target;
        player.fightAimAssistTargetIndex = nextTargetIndex;
        player.fightAimAssistLockRemaining = Math.max(
            0,
            Number(mg?.HUMAN_AIM_ASSIST_LOCK_SECONDS) || DEFAULT_LOCK_SECONDS
        );
    } else if (player.fightAimAssistTarget !== target) {
        player.fightAimAssistTarget = target;
    }
    scratch.subVectors(target.position, player.position);
    if (scratch.lengthSq() > GEOMETRY_EPSILON) aimDirection.copy(scratch).normalize();
    return target;
}
