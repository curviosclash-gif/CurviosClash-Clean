// ============================================
// BotPortalOps.js - portal intent and exit safety helpers
// ============================================
//
// Contract:
// - Inputs: bot runtime + player + arena + allPlayers
// - Outputs: bot.state portal intent activation/score/target selection
// - Side effects: mutates bot portal cache vectors and intent state flags
// - Hotpath guardrail: reuses bot temp vectors and static direction tables

import { estimatePointRisk } from './BotTargetingOps.js';

const PORTAL_EXIT_CHECK_DIRS = Object.freeze([
    Object.freeze({ x: 1, y: 0, z: 0 }),
    Object.freeze({ x: -1, y: 0, z: 0 }),
    Object.freeze({ x: 0, y: 0, z: 1 }),
    Object.freeze({ x: 0, y: 0, z: -1 }),
]);

export function estimateExitSafety(bot, exit, arena, player, allPlayers) {
    const probeDistance = 5;
    let blockedCount = 0;
    for (let i = 0; i < PORTAL_EXIT_CHECK_DIRS.length; i++) {
        const dir = PORTAL_EXIT_CHECK_DIRS[i];
        bot._tmpVec3.set(
            exit.x + dir.x * probeDistance,
            exit.y + dir.y * probeDistance,
            exit.z + dir.z * probeDistance
        );
        if (arena.checkCollisionFast(bot._tmpVec3, player.hitboxRadius * 2.0)
            || bot.checkTrailHit(bot._tmpVec3, player, allPlayers)) {
            blockedCount++;
        }
    }
    return blockedCount / PORTAL_EXIT_CHECK_DIRS.length;
}

export function evaluatePortalIntent(bot, player, arena, allPlayers) {
    if (!arena.portalsEnabled || !arena.portals || arena.portals.length === 0) {
        bot.state.portalIntentActive = false;
        bot._portalTarget = null;
        return;
    }

    if (bot.profile.portalInterest <= 0) {
        bot.state.portalIntentActive = false;
        bot._portalTarget = null;
        return;
    }

    const seekDistance = bot.profile.portalSeekDistance;
    const seekDistSq = seekDistance * seekDistance;
    player.getDirection(bot._tmpForward).normalize();

    let bestScore = -Infinity;
    let bestEntry = null;
    let bestExit = null;
    let bestEntryDistSq = Infinity;

    for (let i = 0; i < arena.portals.length; i++) {
        const portal = arena.portals[i];
        const entryA = portal.posA;
        const exitA = portal.posB;
        const distSqA = player.position.distanceToSquared(entryA);
        if (distSqA <= seekDistSq) {
            bot._tmpVec.subVectors(entryA, player.position).normalize();
            const forwardDotA = bot._tmpVec.dot(bot._tmpForward);
            if (forwardDotA >= bot.profile.portalEntryDotMin) {
                const entryRiskA = estimatePointRisk(bot, entryA, player, arena, allPlayers);
                const exitSafetyA = estimateExitSafety(bot, exitA, arena, player, allPlayers);
                const exitRiskA = exitSafetyA;
                if (exitSafetyA < 0.75) {
                    const localReliefA = bot.sense.forwardRisk - exitRiskA;
                    const distancePenaltyA = distSqA / seekDistSq;
                    const scoreA =
                        localReliefA * (0.8 + bot.profile.portalInterest) +
                        bot.sense.mapPortalBias * 0.5 -
                        entryRiskA * 0.6 -
                        distancePenaltyA * 0.4;
                    if (scoreA > bestScore) {
                        bestScore = scoreA;
                        bestEntry = entryA;
                        bestExit = exitA;
                        bestEntryDistSq = distSqA;
                    }
                }
            }
        }

        const entryB = portal.posB;
        const exitB = portal.posA;
        const distSqB = player.position.distanceToSquared(entryB);
        if (distSqB > seekDistSq) continue;

        bot._tmpVec.subVectors(entryB, player.position).normalize();
        const forwardDotB = bot._tmpVec.dot(bot._tmpForward);
        if (forwardDotB < bot.profile.portalEntryDotMin) continue;

        const entryRiskB = estimatePointRisk(bot, entryB, player, arena, allPlayers);
        const exitSafetyB = estimateExitSafety(bot, exitB, arena, player, allPlayers);
        const exitRiskB = exitSafetyB;
        if (exitSafetyB >= 0.75) continue;

        const localReliefB = bot.sense.forwardRisk - exitRiskB;
        const distancePenaltyB = distSqB / seekDistSq;
        const scoreB =
            localReliefB * (0.8 + bot.profile.portalInterest) +
            bot.sense.mapPortalBias * 0.5 -
            entryRiskB * 0.6 -
            distancePenaltyB * 0.4;

        if (scoreB > bestScore) {
            bestScore = scoreB;
            bestEntry = entryB;
            bestExit = exitB;
            bestEntryDistSq = distSqB;
        }
    }

    if (bestEntry && bestScore >= bot.profile.portalIntentThreshold) {
        bot.state.portalIntentActive = true;
        bot.state.portalIntentTimer = bot.profile.portalIntentDuration;
        bot.state.portalIntentScore = bestScore;
        bot.state.portalEntryDistanceSq = bestEntryDistSq;
        bot._portalEntry.copy(bestEntry);
        bot._portalExit.copy(bestExit);
        bot._portalTarget = bot._portalEntry;
        return;
    }

    bot.state.portalIntentActive = false;
    bot.state.portalIntentScore = 0;
    bot._portalTarget = null;
}
