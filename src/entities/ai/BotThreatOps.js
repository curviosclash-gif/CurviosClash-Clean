// ============================================
// BotThreatOps.js - projectile/height/spacing/pursuit sensing helpers
// ============================================
//
// Contract:
// - Inputs: bot runtime + player + arena/allPlayers/projectiles
// - Outputs: updated bot.sense threat/bias/pursuit fields
// - Side effects: mutates bot.sense and reusable temporary vectors only
// - Hotpath guardrail: no per-frame allocations in sensing logic

import * as THREE from 'three';
import { computeProjectileThreatFlag } from './perception/EnvironmentSamplingOps.js';
import { AI_SENSOR_THREAT_POLICY } from './perception/AiPerceptionConfig.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function senseProjectiles(bot, player, projectiles) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    bot.sense.projectileThreat = false;
    bot.sense.projectileEvadeYaw = 0;
    bot.sense.projectileEvadePitch = 0;

    const awareness = bot.profile.projectileAwareness || 0;
    if (awareness <= 0 || !projectiles || projectiles.length === 0) return;
    const threatDetected = computeProjectileThreatFlag(player, projectiles, AI_SENSOR_THREAT_POLICY.projectileThreatRange, {
        approachDot: Number(AI_SENSOR_THREAT_POLICY.projectileApproachDot),
        toTarget: bot._tmpVec,
        direction: bot._tmpVec2,
    });
    if (!threatDetected) return;

    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    let nearestTime = Infinity;
    let evadeYaw = 0;
    let evadePitch = 0;

    for (let i = 0; i < projectiles.length; i++) {
        const proj = projectiles[i];
        if (proj.owner === player) continue;

        bot._tmpVec.subVectors(proj.position, player.position);
        const dist = bot._tmpVec.length();
        if (dist > AI_SENSOR_THREAT_POLICY.projectileThreatRange || dist < AI_SENSOR_THREAT_POLICY.projectileMinDistance) continue;

        bot._tmpVec.normalize();
        bot._tmpVec2.copy(proj.velocity).normalize();
        const towardBot = -bot._tmpVec2.dot(bot._tmpVec);
        if (towardBot < AI_SENSOR_THREAT_POLICY.projectileApproachDot) continue;

        const speed = proj.velocity.length();
        const timeToImpact = speed > AI_SENSOR_THREAT_POLICY.projectileMinSpeed
            ? dist / speed
            : AI_SENSOR_THREAT_POLICY.projectileFarTimeToImpact;
        if (timeToImpact > (
            AI_SENSOR_THREAT_POLICY.projectileTimeToImpactBase
            + awareness * AI_SENSOR_THREAT_POLICY.projectileTimeToImpactAwarenessScale
        )) continue;
        if (awareness < AI_SENSOR_THREAT_POLICY.projectileAwarenessGuaranteedThreshold && Math.random() > awareness) continue;

        if (timeToImpact < nearestTime) {
            nearestTime = timeToImpact;
            bot._tmpVec3.crossVectors(bot._tmpVec2, WORLD_UP).normalize();
            const side = bot._tmpRight.dot(bot._tmpVec3);
            evadeYaw = side > 0 ? -1 : 1;

            if (!planarMode) {
                const verticalApproach = bot._tmpVec.y;
                evadePitch = verticalApproach > AI_SENSOR_THREAT_POLICY.projectileVerticalEvadeThreshold
                    ? -1
                    : (verticalApproach < -AI_SENSOR_THREAT_POLICY.projectileVerticalEvadeThreshold ? 1 : 0);
            }
        }
    }

    if (nearestTime < Infinity) {
        bot.sense.projectileThreat = true;
        bot.sense.projectileEvadeYaw = evadeYaw;
        bot.sense.projectileEvadePitch = evadePitch;
    }
}

export function senseHeight(bot, player, arena) {
    bot.sense.heightBias = 0;
    if (resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE) return;

    const bias = bot.profile.heightBias || 0;
    if (bias <= 0) return;

    const bounds = arena.bounds;
    const midY = (bounds.minY + bounds.maxY) * 0.5;
    const offset = player.position.y - midY;
    const range = (bounds.maxY - bounds.minY) * 0.5;
    if (range <= 0) return;

    const normalizedOffset = offset / range;
    bot.sense.heightBias = -normalizedOffset * bias;
}

export function senseBotSpacing(bot, player, allPlayers) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    bot.sense.botRepulsionYaw = 0;
    bot.sense.botRepulsionPitch = 0;

    const weight = bot.profile.spacingWeight || 0;
    if (weight <= 0) return;

    const minDist = AI_SENSOR_THREAT_POLICY.spacingMinDistance;
    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    let repulseX = 0;
    let repulseY = 0;

    for (let i = 0; i < allPlayers.length; i++) {
        const other = allPlayers[i];
        if (!other || other === player || !other.alive || !other.isBot) continue;

        bot._tmpVec.subVectors(player.position, other.position);
        const dist = bot._tmpVec.length();
        if (dist >= minDist || dist < AI_SENSOR_THREAT_POLICY.spacingIgnoreDistance) continue;

        const strength = weight * (1 - dist / minDist);
        bot._tmpVec.normalize();
        repulseX += bot._tmpRight.dot(bot._tmpVec) * strength;
        repulseY += bot._tmpUp.dot(bot._tmpVec) * strength;
    }

    if (Math.abs(repulseX) > AI_SENSOR_THREAT_POLICY.spacingRepulsionDeadzone) {
        bot.sense.botRepulsionYaw = repulseX > 0 ? 1 : -1;
    }
    if (!planarMode && Math.abs(repulseY) > AI_SENSOR_THREAT_POLICY.spacingRepulsionDeadzone) {
        bot.sense.botRepulsionPitch = repulseY > 0 ? 1 : -1;
    }
}

export function evaluatePursuit(bot, player) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    bot.sense.pursuitActive = false;
    bot.sense.pursuitYaw = 0;
    bot.sense.pursuitPitch = 0;
    bot.sense.pursuitAimDot = 0;

    if (!bot.profile.pursuitEnabled) return;
    if (bot.sense.immediateDanger || bot.sense.forwardRisk > AI_SENSOR_THREAT_POLICY.pursuitForwardRiskCeiling) return;

    const target = bot.state.targetPlayer;
    if (!target || !target.alive) return;

    const pursuitRadius = bot.profile.pursuitRadius || 35;
    if (bot.sense.targetDistanceSq > pursuitRadius * pursuitRadius) return;
    if (!bot.sense.targetInFront) return;

    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);
    bot._tmpVec.subVectors(target.position, player.position).normalize();

    const aimDot = bot._tmpVec.dot(bot._tmpForward);
    const yawSignal = bot._tmpRight.dot(bot._tmpVec);
    const pitchSignal = bot._tmpUp.dot(bot._tmpVec);

    bot.sense.pursuitActive = true;
    bot.sense.pursuitAimDot = aimDot;
    bot.sense.pursuitYaw = Math.abs(yawSignal) > AI_SENSOR_THREAT_POLICY.pursuitYawDeadzone ? (yawSignal > 0 ? 1 : -1) : 0;
    if (!planarMode) {
        bot.sense.pursuitPitch = Math.abs(pitchSignal) > AI_SENSOR_THREAT_POLICY.pursuitPitchDeadzone ? (pitchSignal > 0 ? 1 : -1) : 0;
    }
}
