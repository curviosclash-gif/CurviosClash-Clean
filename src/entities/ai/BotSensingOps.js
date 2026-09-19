// ============================================
// BotSensingOps.js - sensing operations for BotAI
// ============================================

import {
    AI_SENSOR_SCAN_POLICY,
} from './perception/AiPerceptionConfig.js';
import {
    composePressureLevel,
    computeTightSpacePressure,
} from './perception/AiPerceptionPrimitives.js';
import { estimateEnemyPressure, isTargetVisibleToPlayer, selectTarget } from './BotTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

export function shouldUseReducedProbeScan(sense, isFullScanFrame) {
    return !isFullScanFrame || (
        !sense.immediateDanger
        && (sense.forwardRisk || 0) < AI_SENSOR_SCAN_POLICY.reducedProbeRiskThreshold
        && (sense.localOpenness || 0) > sense.lookAhead * AI_SENSOR_SCAN_POLICY.reducedProbeOpennessRatio
    );
}

export function senseEnvironment(bot, player, arena, allPlayers, _projectiles) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    const mapBehavior = bot.mapBehavior(arena);
    bot.sense.mapCaution = mapBehavior.caution;
    bot.sense.mapPortalBias = mapBehavior.portalBias;
    bot.sense.mapAggressionBias = mapBehavior.aggressionBias;

    bot.sense.lookAhead = bot.computeDynamicLookAhead(player);

    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    // Time-slice complete scans to the assigned frame.
    const maxProbes = bot._probes.length;
    const isFullScanFrame = bot.sensePhaseCounter === bot.sensePhase;
    const useFewProbes = shouldUseReducedProbeScan(bot.sense, isFullScanFrame);
    const probesToProcess = useFewProbes
        ? Math.min(AI_SENSOR_SCAN_POLICY.reducedProbeCount, maxProbes)
        : maxProbes;

    let opennessSum = 0;
    let opennessCount = 0;
    let bestRisk = Infinity;
    let bestProbe = null;
    let forwardProbe = null;

    for (let i = 0; i < maxProbes; i++) {
        if (i >= probesToProcess) break;

        const probe = bot._probes[i];
        const isVertical = Math.abs(probe.pitch) > AI_SENSOR_SCAN_POLICY.planarPitchEpsilon;

    if (planarMode && isVertical) {
            continue;
        }

        bot.composeProbeDirection(bot._tmpForward, bot._tmpRight, bot._tmpUp, probe);
        bot.scoreProbe(player, arena, allPlayers, probe, bot.sense.lookAhead);

        opennessSum += probe.clearance;
        opennessCount++;

        if (probe.name === 'forward') {
            forwardProbe = probe;
        }

        if (probe.risk < bestRisk) {
            bestRisk = probe.risk;
            bestProbe = probe;
        }
    }

    bot.sense.bestProbe = bestProbe;
    bot.sense.forwardRisk = forwardProbe ? forwardProbe.risk : 1;
    bot.sense.immediateDanger = !!(forwardProbe && forwardProbe.immediateDanger);
    bot.sense.localOpenness = opennessCount > 0
        ? opennessSum / opennessCount
        : bot.sense.lookAhead * AI_SENSOR_SCAN_POLICY.fallbackLocalOpennessRatio;

    const nearestEnemyPressure = estimateEnemyPressure(bot, player.position, player, allPlayers);
    const tightSpacePressure = computeTightSpacePressure(bot.sense.localOpenness, bot.sense.lookAhead);
    bot.sense.pressure = composePressureLevel(nearestEnemyPressure, tightSpacePressure, bot._recentBouncePressure);

    if (
        bot.state.targetRefreshTimer <= 0
        || !bot.state.targetPlayer
        || !bot.state.targetPlayer.alive
        || !isTargetVisibleToPlayer(player, bot.state.targetPlayer)
    ) {
        selectTarget(bot, player, allPlayers);
        bot.state.targetRefreshTimer = bot.profile.targetRefreshInterval;
    }
}

export function runPerception(bot, player, arena, allPlayers, projectiles) {
    // Time-Slicing auf Frame-Ebene
    bot.incrementSensePhaseCounter();
    // Collision memo is valid only for one perception tick.
    bot.clearCollisionCache();

    senseEnvironment(bot, player, arena, allPlayers, projectiles);
    const sensePhaseCounter = bot.sensePhaseCounter;
    const sensePhase = bot.sensePhase;
    const fullScanFrame = sensePhaseCounter === sensePhase;
    const hasProjectiles = Array.isArray(projectiles) && projectiles.length > 0;
    const shouldSenseProjectiles = hasProjectiles && (
        fullScanFrame
        || bot.sense.immediateDanger
        || bot.sense.forwardRisk > AI_SENSOR_SCAN_POLICY.projectileSenseRiskThreshold
        || (sensePhaseCounter % AI_SENSOR_SCAN_POLICY.projectileSenseStride) === (sensePhase % AI_SENSOR_SCAN_POLICY.projectileSenseStride)
    );

    if (shouldSenseProjectiles) {
        bot.senseProjectiles(player, projectiles);
    } else {
        bot.sense.projectileThreat = false;
        bot.sense.projectileEvadeYaw = 0;
        bot.sense.projectileEvadePitch = 0;
    }

    bot.senseHeight(player, arena);
    const shouldSenseSpacing = fullScanFrame
        || bot.sense.immediateDanger
        || bot.sense.forwardRisk > AI_SENSOR_SCAN_POLICY.spacingSenseRiskThreshold
        || (sensePhaseCounter % AI_SENSOR_SCAN_POLICY.spacingSenseStride) === (sensePhase % AI_SENSOR_SCAN_POLICY.spacingSenseStride);
    if (shouldSenseSpacing) {
        bot.senseBotSpacing(player, allPlayers);
    } else {
        bot.sense.botRepulsionYaw *= AI_SENSOR_SCAN_POLICY.spacingDecay;
        bot.sense.botRepulsionPitch *= AI_SENSOR_SCAN_POLICY.spacingDecay;
        if (Math.abs(bot.sense.botRepulsionYaw) < AI_SENSOR_SCAN_POLICY.spacingDeadzone) bot.sense.botRepulsionYaw = 0;
        if (Math.abs(bot.sense.botRepulsionPitch) < AI_SENSOR_SCAN_POLICY.spacingDeadzone) bot.sense.botRepulsionPitch = 0;
    }
    bot.evaluatePursuit(player);
    bot.evaluatePortalIntent(player, arena, allPlayers);
}
