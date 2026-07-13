// ============================================
// BotRecoveryOps.js - recovery and stuck operations for BotAI
// ============================================

import { estimateEnemyPressure } from './BotTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function selectRecoveryManeuver(bot, player, arena, allPlayers) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    const candidates = planarMode
        ? [
            { yaw: -1, pitch: 0, weight: 0.02 },
            { yaw: 1, pitch: 0, weight: 0.02 },
            { yaw: -1, pitch: 0, weight: 0.12, biasAwayFromNormal: true },
            { yaw: 1, pitch: 0, weight: 0.12, biasAwayFromNormal: true },
        ]
        : [
            { yaw: -1, pitch: 0, weight: 0.02 },
            { yaw: 1, pitch: 0, weight: 0.02 },
            { yaw: -1, pitch: 1, weight: 0.1 },
            { yaw: 1, pitch: 1, weight: 0.1 },
            { yaw: -1, pitch: -1, weight: 0.1 },
            { yaw: 1, pitch: -1, weight: 0.1 },
            { yaw: -1, pitch: 0, weight: 0.14, biasAwayFromNormal: true },
            { yaw: 1, pitch: 0, weight: 0.14, biasAwayFromNormal: true },
        ];

    const sampleDistances = [3, 5.5, 8.5, 12, 16];
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        bot._tmpVec.copy(bot._tmpForward).addScaledVector(bot._tmpRight, candidate.yaw * 0.95);
        if (!planarMode && candidate.pitch !== 0) {
            bot._tmpVec.addScaledVector(bot._tmpUp, candidate.pitch * 0.75);
        }
        bot._tmpVec.normalize();

        let score = candidate.weight;

        if (candidate.biasAwayFromNormal && bot._hasCollisionNormal) {
            const side = bot._tmpRight.dot(bot._lastCollisionNormal);
            if ((candidate.yaw > 0 && side > 0) || (candidate.yaw < 0 && side < 0)) {
                score += 0.65;
            }
        }

        for (let j = 0; j < sampleDistances.length; j++) {
            const distance = sampleDistances[j];
            bot._tmpVec2.copy(player.position).addScaledVector(bot._tmpVec, distance);

            const wallHit = arena.checkCollisionFast(bot._tmpVec2, player.hitboxRadius * 1.6);
            const trailHit = bot.checkTrailHit(bot._tmpVec2, player, allPlayers);
            if (wallHit || trailHit) {
                score += 3.2 + j * 0.8 + (trailHit ? 0.9 : 0.5);
                break;
            }

            score += estimateEnemyPressure(bot, bot._tmpVec2, player, allPlayers) * 0.35;
        }

        if (bot._hasCollisionNormal) {
            const awayDot = bot._tmpVec.dot(bot._lastCollisionNormal);
            score -= awayDot * 0.65;
        }

        if (!planarMode) {
            const margin = 7;
            const projectedY = player.position.y + bot._tmpVec.y * 9;
            if (projectedY < arena.bounds.minY + margin || projectedY > arena.bounds.maxY - margin) {
                score += 0.85;
            }
        }

        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
}

function shouldBoostRecovery(bot, player, arena, allPlayers) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    if (bot._recentBouncePressure > 1.2) return false;
    if (bot._bounceStreak >= 3) return false;
    const recoveryBoostRiskCeiling = Number.isFinite(Number(bot.profile?.recoveryBoostRiskCeiling))
        ? Number(bot.profile.recoveryBoostRiskCeiling)
        : 0.55;
    if (bot.sense.forwardRisk > recoveryBoostRiskCeiling) return false;

    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);
    bot._tmpVec.copy(bot._tmpForward);
    bot._tmpVec.addScaledVector(bot._tmpRight, bot.state.recoveryYaw * 0.22);
    if (!planarMode) {
        bot._tmpVec.addScaledVector(bot._tmpUp, bot.state.recoveryPitch * 0.2);
    }
    bot._tmpVec.normalize();

    const checks = [3, 5, 7];
    for (let i = 0; i < checks.length; i++) {
        bot._tmpVec2.copy(player.position).addScaledVector(bot._tmpVec, checks[i]);
        if (arena.checkCollisionFast(bot._tmpVec2, player.hitboxRadius * 1.6) || bot.checkTrailHit(bot._tmpVec2, player, allPlayers)) {
            return false;
        }
    }
    return true;
}

export function enterRecovery(bot, player, arena, allPlayers, reason) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    bot.state.recoveryActive = true;
    bot.state.recoveryTimer = bot.profile.recoveryDuration;
    bot.state.recoveryCooldown = bot.profile.recoveryCooldown;
    bot.state.recoverySwitchUsed = false;
    bot._stuckScore = 0;

    const maneuver = selectRecoveryManeuver(bot, player, arena, allPlayers);
    let selectedYaw = maneuver?.yaw || (Math.random() > 0.5 ? 1 : -1);
    bot.state.recoveryPitch = planarMode ? 0 : (maneuver?.pitch || 0);

    if (bot._recoveryChainTimer > 0 && bot._lastRecoveryReason === reason) {
        bot._recoveryChainCount = Math.min(6, bot._recoveryChainCount + 1);
    } else {
        bot._recoveryChainCount = 1;
    }
    bot._recoveryChainTimer = 2.2;
    bot._lastRecoveryReason = reason;

    if (bot._recoveryChainCount >= 2 && bot._lastRecoveryYaw !== 0 && selectedYaw === bot._lastRecoveryYaw) {
        selectedYaw *= -1;
    }
    bot._lastRecoveryYaw = selectedYaw;
    bot.state.recoveryYaw = selectedYaw;

    if (bot._recoveryChainCount >= 3) {
        bot.state.recoveryTimer *= 1.25;
        bot.state.recoveryCooldown *= 0.8;
    }

    if (!planarMode) {
        const margin = 8;
        if (player.position.y < arena.bounds.minY + margin) bot.state.recoveryPitch = 1;
        else if (player.position.y > arena.bounds.maxY - margin) bot.state.recoveryPitch = -1;
    }

    if (bot.recorder) {
        bot.recorder.logEvent(
            'STUCK',
            player.index,
            `reason=${reason} yaw=${bot.state.recoveryYaw} pitch=${bot.state.recoveryPitch} chain=${bot._recoveryChainCount}`
        );
    }
}

export function updateStuckState(bot, player, arena, allPlayers) {
    if (!bot._hasPositionSample) {
        bot._lastPos.copy(player.position);
        bot._hasPositionSample = true;
        return;
    }

    if (bot._checkStuckTimer > 0) return;
    bot._checkStuckTimer = bot.profile.stuckCheckInterval;

    player.getDirection(bot._tmpForward).normalize();
    bot._tmpVec.subVectors(player.position, bot._lastPos);
    const movement = bot._tmpVec.length();
    const forwardProgress = bot._tmpVec.dot(bot._tmpForward);

    const weakMovement = movement < bot.profile.minProgressDistance;
    const weakProgress = forwardProgress < bot.profile.minForwardProgress;

    if (weakMovement || weakProgress) {
        bot._stuckScore += bot.profile.stuckCheckInterval;
    } else {
        bot._stuckScore = Math.max(0, bot._stuckScore - bot.profile.stuckCheckInterval * 0.8);
    }

    bot._stuckScore += bot._recentBouncePressure * 0.06;
    if (bot.sense.immediateDanger) {
        bot._stuckScore += 0.16;
    } else if (bot.sense.forwardRisk > 0.8) {
        bot._stuckScore += 0.08;
    }
    if (bot.sense.pressure > 0.75) {
        bot._stuckScore += 0.05;
    }
    if (bot._bounceStreak >= 3) {
        bot._stuckScore += Math.min(0.35, 0.08 * (bot._bounceStreak - 2));
    }
    bot._lastPos.copy(player.position);

    if (!bot.state.recoveryActive && bot.state.recoveryCooldown <= 0 && bot._stuckScore >= bot.profile.stuckTriggerTime) {
        enterRecovery(bot, player, arena, allPlayers, 'low-progress');
    }
}

export function updateRecovery(bot, dt, player, arena, allPlayers) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    bot.state.recoveryTimer -= dt;
    if (bot.state.recoveryTimer <= 0) {
        bot.state.recoveryActive = false;
        bot.state.recoveryYaw = 0;
        bot.state.recoveryPitch = 0;
        bot.state.recoverySwitchUsed = false;
        return false;
    }

    const stuckInsideRecovery =
        !bot.state.recoverySwitchUsed &&
        bot.state.recoveryTimer <= bot.profile.recoveryDuration * 0.55 &&
        (bot.sense.forwardRisk > 0.78 || bot._recentBouncePressure > 2.1 || bot._bounceStreak >= 3);
    if (stuckInsideRecovery) {
        bot.state.recoveryYaw = bot.state.recoveryYaw !== 0 ? -bot.state.recoveryYaw : (Math.random() > 0.5 ? 1 : -1);
        bot.state.recoveryPitch = planarMode ? 0 : -bot.state.recoveryPitch;
        bot.state.recoverySwitchUsed = true;
        if (bot.recorder) {
            bot.recorder.logEvent('RECOVERY_SWITCH', player.index, `yaw=${bot.state.recoveryYaw} pitch=${bot.state.recoveryPitch}`);
        }
    }

    bot._resetInput(bot.currentInput);
    bot.currentInput.boost = shouldBoostRecovery(bot, player, arena, allPlayers);
    if (bot.state.recoveryYaw > 0) bot.currentInput.yawLeft = true;
    else if (bot.state.recoveryYaw < 0) bot.currentInput.yawRight = true;

    if (!planarMode) {
        if (bot.state.recoveryPitch > 0) bot.currentInput.pitchUp = true;
        else if (bot.state.recoveryPitch < 0) bot.currentInput.pitchDown = true;
    }
    return true;
}
