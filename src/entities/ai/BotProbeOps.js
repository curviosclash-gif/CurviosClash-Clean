// ============================================
// BotProbeOps.js - probe direction/ray/score helpers
// ============================================
//
// Contract:
// - Inputs: bot runtime + probe + arena/player snapshots
// - Outputs: normalized probe.dir and scored risk/clearance on probe object
// - Side effects: writes to bot temp vectors and mutable probe records
// - Hotpath guardrail: no new vectors/arrays in sensing loop

import {
    AI_SENSOR_PROBE_POLICY,
    AI_SENSOR_TRAIL_COLLISION,
} from './perception/AiPerceptionConfig.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

export function composeProbeDirection(bot, forward, right, up, probe) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    const yawFactor = probe.yaw * bot.profile.probeSpread;
    const pitchFactor = probe.pitch * bot.profile.probeSpread;

    probe.dir.copy(forward);
    if (yawFactor !== 0) probe.dir.addScaledVector(right, yawFactor);
    if (!planarMode && pitchFactor !== 0) probe.dir.addScaledVector(up, pitchFactor);
    probe.dir.normalize();
}

export function scanProbeRay(bot, player, arena, allPlayers, direction, lookAhead, step, out) {
    out.wallDist = lookAhead;
    out.trailDist = lookAhead;
    out.immediateDanger = false;

    const radius = player.hitboxRadius * AI_SENSOR_TRAIL_COLLISION.radiusMultiplier;
    const skipRecent = AI_SENSOR_TRAIL_COLLISION.skipRecentSegments;
    const stepX = direction.x * step;
    const stepY = direction.y * step;
    const stepZ = direction.z * step;

    bot._tmpVec.set(
        player.position.x + stepX,
        player.position.y + stepY,
        player.position.z + stepZ
    );

    for (let d = step; d <= lookAhead; d += step) {
        if (arena.checkCollisionFast(bot._tmpVec, radius)) {
            out.wallDist = d;
            if (d <= step * AI_SENSOR_PROBE_POLICY.immediateDangerStepMultiplier) out.immediateDanger = true;
            break;
        }

        if (bot.checkTrailHit(bot._tmpVec, player, allPlayers, radius, skipRecent)) {
            out.trailDist = d;
            if (d <= step * AI_SENSOR_PROBE_POLICY.immediateDangerStepMultiplier) out.immediateDanger = true;
            break;
        }

        bot._tmpVec.x += stepX;
        bot._tmpVec.y += stepY;
        bot._tmpVec.z += stepZ;
    }
}

export function scoreProbe(bot, player, arena, allPlayers, probe, lookAhead) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    const step = bot.profile.probeStep;

    let probeLookAhead = lookAhead;
    const absYaw = Math.abs(probe.yaw);
    if (absYaw > AI_SENSOR_PROBE_POLICY.sharpTurnYawThreshold) {
        probeLookAhead = lookAhead * AI_SENSOR_PROBE_POLICY.sharpTurnLookAheadScale;
    } else if (absYaw > AI_SENSOR_PROBE_POLICY.mediumTurnYawThreshold) {
        probeLookAhead = lookAhead * AI_SENSOR_PROBE_POLICY.mediumTurnLookAheadScale;
    }

    scanProbeRay(bot, player, arena, allPlayers, probe.dir, probeLookAhead, step, bot._probeRayCenter);

    const lateralStrength = planarMode
        ? AI_SENSOR_PROBE_POLICY.planarLateralStrength
        : AI_SENSOR_PROBE_POLICY.volumeLateralStrength;
    const lateralLookAhead = probeLookAhead * AI_SENSOR_PROBE_POLICY.lateralLookAheadScale;
    const centerClearance = Math.min(bot._probeRayCenter.wallDist, bot._probeRayCenter.trailDist);
    const shouldScanLaterals = bot._probeRayCenter.immediateDanger
        || centerClearance < probeLookAhead * AI_SENSOR_PROBE_POLICY.lateralScanClearRatio;

    if (shouldScanLaterals) {
        bot._tmpVec2.copy(probe.dir).addScaledVector(bot._tmpRight, lateralStrength).normalize();
        scanProbeRay(bot, player, arena, allPlayers, bot._tmpVec2, lateralLookAhead, step, bot._probeRayLeft);

        bot._tmpVec3.copy(probe.dir).addScaledVector(bot._tmpRight, -lateralStrength).normalize();
        scanProbeRay(bot, player, arena, allPlayers, bot._tmpVec3, lateralLookAhead, step, bot._probeRayRight);
    } else {
        bot._probeRayLeft.wallDist = bot._probeRayCenter.wallDist;
        bot._probeRayLeft.trailDist = bot._probeRayCenter.trailDist;
        bot._probeRayLeft.immediateDanger = bot._probeRayCenter.immediateDanger;
        bot._probeRayRight.wallDist = bot._probeRayCenter.wallDist;
        bot._probeRayRight.trailDist = bot._probeRayCenter.trailDist;
        bot._probeRayRight.immediateDanger = bot._probeRayCenter.immediateDanger;
    }

    const wallDist = Math.min(bot._probeRayCenter.wallDist, bot._probeRayLeft.wallDist, bot._probeRayRight.wallDist);
    const trailDist = Math.min(bot._probeRayCenter.trailDist, bot._probeRayLeft.trailDist, bot._probeRayRight.trailDist);
    const immediateDanger = bot._probeRayCenter.immediateDanger
        || bot._probeRayLeft.immediateDanger
        || bot._probeRayRight.immediateDanger;

    const speedRatio = player.baseSpeed > 0 ? player.speed / player.baseSpeed : 1;
    const speedFactor = Math.max(0, speedRatio - 1) * AI_SENSOR_PROBE_POLICY.speedFactorScale;

    const wallRisk = 1 - Math.min(1, wallDist / probeLookAhead);
    const trailRisk = 1 - Math.min(1, trailDist / probeLookAhead);
    let risk = wallRisk * (AI_SENSOR_PROBE_POLICY.wallRiskBase + bot.sense.mapCaution + speedFactor)
        + trailRisk * (
            AI_SENSOR_PROBE_POLICY.trailRiskBase
            + bot.sense.mapCaution * AI_SENSOR_PROBE_POLICY.trailMapCautionScale
            + speedFactor * AI_SENSOR_PROBE_POLICY.trailSpeedFactorScale
        );

    let lateralBlocks = 0;
    if (
        bot._probeRayLeft.wallDist < lateralLookAhead * AI_SENSOR_PROBE_POLICY.lateralBlockDistanceScale
        || bot._probeRayLeft.trailDist < lateralLookAhead * AI_SENSOR_PROBE_POLICY.lateralBlockDistanceScale
    ) lateralBlocks++;
    if (
        bot._probeRayRight.wallDist < lateralLookAhead * AI_SENSOR_PROBE_POLICY.lateralBlockDistanceScale
        || bot._probeRayRight.trailDist < lateralLookAhead * AI_SENSOR_PROBE_POLICY.lateralBlockDistanceScale
    ) lateralBlocks++;

    risk += probe.weight;
    risk += lateralBlocks * AI_SENSOR_PROBE_POLICY.lateralBlockRiskPenalty;
    if (immediateDanger) risk += AI_SENSOR_PROBE_POLICY.immediateDangerRiskPenalty;

    if (bot.profile.errorRate > 0 && Math.random() < bot.profile.errorRate) {
        risk += (Math.random() - AI_SENSOR_PROBE_POLICY.errorNoiseOffset) * AI_SENSOR_PROBE_POLICY.errorNoiseScale;
    }

    probe.wallDist = wallDist;
    probe.trailDist = trailDist;
    probe.clearance = Math.min(wallDist, trailDist);
    probe.immediateDanger = immediateDanger;
    probe.risk = risk;
}
