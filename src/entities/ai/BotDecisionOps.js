// ============================================
// BotDecisionOps.js - decision operations for BotAI
// ============================================

import { enterRecovery, updateRecovery } from './BotRecoveryOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
}

import {
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    normalizePickupType,
} from '../PickupRegistry.js';

function resolveHealthRatio(player) {
    const maxHp = Number(player?.maxHp);
    const hp = Number(player?.hp);
    if (!Number.isFinite(maxHp) || maxHp <= 0 || !Number.isFinite(hp)) return 1;
    return clamp01(hp / maxHp);
}

function resolveShieldRatio(player) {
    const maxShieldHp = Number(player?.maxShieldHp);
    const shieldHp = Number(player?.shieldHP);
    if (!Number.isFinite(maxShieldHp) || maxShieldHp <= 0 || !Number.isFinite(shieldHp)) return 0;
    return clamp01(shieldHp / maxShieldHp);
}

function resolveSurvivalPressure(bot, player) {
    const sense = bot?.sense || {};
    const healthRatio = resolveHealthRatio(player);
    const healthPressure = 1 - healthRatio;
    const riskPressure = Math.max(
        sense.immediateDanger ? 1 : 0,
        Number.isFinite(sense.forwardRisk) ? sense.forwardRisk : 0
    );
    const spacingPressure = Number.isFinite(sense.pressure) ? sense.pressure : 0;
    const bouncePressure = Number.isFinite(bot?._recentBouncePressure)
        ? Math.max(0, bot._recentBouncePressure) / 3
        : 0;
    const configuredBias = Number.isFinite(Number(bot?.profile?.survivalBias))
        ? clamp01(Number(bot.profile.survivalBias))
        : 0.6;

    return clamp01(
        riskPressure * (0.52 + configuredBias * 0.2)
        + Math.max(spacingPressure, bouncePressure) * 0.3
        + healthPressure * 0.45
    );
}

export function applyPortalSteering(bot, player) {
    if (!bot.state.portalIntentActive || !bot._portalTarget) return false;
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;

    bot._tmpVec.subVectors(bot._portalTarget, player.position);
    const distSq = bot._tmpVec.lengthSq();

    if (distSq < 9) {
        bot.state.portalIntentActive = false;
        bot._portalTarget = null;
        return false;
    }

    bot._tmpVec.normalize();
    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    const yawSignal = bot._tmpRight.dot(bot._tmpVec);
    const pitchSignal = bot._tmpUp.dot(bot._tmpVec);

    bot._decision.yaw = Math.abs(yawSignal) > 0.08 ? (yawSignal > 0 ? 1 : -1) : 0;
    if (!planarMode) {
        bot._decision.pitch = Math.abs(pitchSignal) > 0.08 ? (pitchSignal > 0 ? 1 : -1) : 0;
    }

    if (distSq < 196 && bot.sense.forwardRisk < 0.75) {
        bot._decision.boost = true;
    }

    return true;
}

export function decideSteering(bot, player) {
    const planarMode = !!resolveGameplayConfig(bot).GAMEPLAY.PLANAR_MODE;
    const best = bot.sense.bestProbe;
    if (!best) {
        bot._decision.yaw = Math.random() > 0.5 ? 1 : -1;
        bot._decision.pitch = 0;
        return;
    }

    player.getDirection(bot._tmpForward).normalize();
    bot._buildBasis(bot._tmpForward);

    const yawSignal = bot._tmpRight.dot(best.dir);
    const pitchSignal = bot._tmpUp.dot(best.dir);

    // Proportional steering: scale signal by magnitude for smoother turning.
    // Clamp to [-1, 1] so the input contract stays intact.
    let desiredYaw = Math.abs(yawSignal) > 0.06
        ? Math.max(-1, Math.min(1, yawSignal * 1.8))
        : 0;
    let desiredPitch = 0;
    if (!planarMode && Math.abs(pitchSignal) > 0.08) {
        desiredPitch = Math.max(-1, Math.min(1, pitchSignal * 1.6));
    }

    if (!planarMode && desiredPitch === 0 && Math.abs(bot.sense.heightBias) > 0.15) {
        desiredPitch = bot.sense.heightBias > 0 ? 1 : -1;
    }

    if (desiredYaw === 0 && bot.sense.botRepulsionYaw !== 0) {
        desiredYaw = bot.sense.botRepulsionYaw;
    }
    if (!planarMode && desiredPitch === 0 && bot.sense.botRepulsionPitch !== 0) {
        desiredPitch = bot.sense.botRepulsionPitch;
    }

    const opennessRatio = bot.sense.lookAhead > 0
        ? bot.sense.localOpenness / bot.sense.lookAhead
        : 0.5;
    const commitScale = bot.sense.immediateDanger
        ? 0.45
        : ((bot.sense.forwardRisk > 0.72 || opennessRatio < 0.55 || bot._recentBouncePressure > 1.2) ? 0.65 : 1);
    const commitDuration = Math.max(0.08, bot.profile.turnCommitTime * commitScale);

    if (bot.state.turnCommitTimer <= 0 || bot.sense.immediateDanger) {
        bot.state.committedYaw = desiredYaw;
        bot.state.committedPitch = desiredPitch;
        if (desiredYaw !== 0 || desiredPitch !== 0) {
            bot.state.turnCommitTimer = commitDuration;
        }
    }

    if (bot.state.turnCommitTimer > 0) {
        desiredYaw = bot.state.committedYaw;
        desiredPitch = bot.state.committedPitch;
    }

    bot._decision.yaw = desiredYaw;
    bot._decision.pitch = desiredPitch;

    const aggression = bot.profile.aggression + bot.sense.mapAggressionBias;
    const survivalPressure = resolveSurvivalPressure(bot, player);
    const boostRiskCeiling = Number.isFinite(Number(bot.profile?.boostRiskCeiling))
        ? Math.max(0.15, Number(bot.profile.boostRiskCeiling))
        : 0.42;
    if (!bot.sense.immediateDanger && bot.sense.forwardRisk < boostRiskCeiling && survivalPressure < 0.72) {
        // Scale boost chance with openness: more boost in open areas.
        const opennessBonus = opennessRatio > 0.7 ? 2.2 : (opennessRatio > 0.5 ? 1.4 : 1);
        // Boost more when chasing a nearby target.
        const chaseBonus = (bot.sense.targetInFront && bot.sense.targetDistanceSq < 900) ? 2.2 : 1;
        const pressurePenalty = Math.max(0.18, 1 - survivalPressure * 0.82);
        const effectiveChance = bot.profile.boostChance
            * (0.8 + Math.max(0, aggression))
            * opennessBonus
            * chaseBonus
            * pressurePenalty;
        if (Math.random() < effectiveChance) {
            bot._decision.boost = true;
        }
    }

    // Hard bots correct less randomly; easy bots keep subtle random drift.
    if (bot._profileName === 'EASY' && Math.random() < 0.08) {
        bot._decision.yaw = Math.random() > 0.5 ? 1 : -1;
    }
}

export function decideItemUsage(bot, player, itemRules) {
    if (!player.inventory || player.inventory.length === 0) return;

    let bestUseScore = -Infinity;
    let bestUseIndex = -1;
    let bestShootScore = -Infinity;
    let bestShootIndex = -1;

    const pressure = bot.sense.pressure;
    const aggression = Math.max(0, bot.profile.aggression + bot.sense.mapAggressionBias);
    const targetBonus = bot.sense.targetInFront ? 1.1 : 0.5;
    const healthRatio = resolveHealthRatio(player);
    const shieldRatio = resolveShieldRatio(player);
    const survivalPressure = resolveSurvivalPressure(bot, player);

    // Phase 3: Kontextvariablen
    const crashRisk = bot.sense.immediateDanger ? 1.0 : (bot.sense.forwardRisk > 0.6 ? 0.5 : 0);
    const enemyClose = bot.sense.targetDistanceSq < 100; // < 10 Einheiten
    const contextWeight = bot.profile.itemContextWeight || 0.5;

    for (let i = 0; i < player.inventory.length; i++) {
        const type = player.inventory[i];
        const normalizedType = normalizePickupType(type, { fallback: type });
        const rule = itemRules[normalizedType] || { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 };
        const shieldSaturationPenalty = normalizedType === 'SHIELD'
            ? shieldRatio * 0.65
            : 0;
        const rocketOpportunityBonus = normalizedType.startsWith('ROCKET_') && bot.sense.targetDistanceSq > 196
            ? 0.15
            : 0;

        // Phase 3: Erweitertes Self-Scoring mit Kontext
        const selfScore = rule.self
            + pressure * rule.defensiveScale
            + crashRisk * (rule.emergencyScale || 0) * contextWeight
            + (enemyClose ? (rule.combatSelf || 0) * contextWeight : 0)
            - shieldSaturationPenalty;
        const shootScore = rule.offense * (0.55 + aggression) * targetBonus + rocketOpportunityBonus;

        if (isPickupTypeSelfUsable(normalizedType) && selfScore > bestUseScore) {
            bestUseScore = selfScore;
            bestUseIndex = i;
        }
        if (isPickupTypeShootable(normalizedType) && shootScore > bestShootScore) {
            bestShootScore = shootScore;
            bestShootIndex = i;
        }
    }

    const defensiveUseThreshold = Math.max(
        0.42,
        0.74 - survivalPressure * 0.22 - (healthRatio < 0.45 ? 0.08 : 0) + shieldRatio * 0.12
    );
    if (bestUseIndex >= 0 && bestUseScore > defensiveUseThreshold && bot.state.itemUseCooldown <= 0) {
        bot._decision.useItem = bestUseIndex;
        bot.state.itemUseCooldown = bot.profile.itemUseCooldown;
        return;
    }

    const offensiveShootThreshold = 0.45 + survivalPressure * 0.35 + (healthRatio < 0.4 ? 0.12 : 0);
    if (bestShootIndex >= 0 && bestShootScore > offensiveShootThreshold && bot.state.itemShootCooldown <= 0) {
        bot._decision.shootItem = true;
        bot._decision.shootItemIndex = bestShootIndex;
        bot.state.itemShootCooldown = bot.profile.itemShootCooldown;
    }
}

export function runDecision(bot, dt, player, arena, allPlayers, itemRules) {
    const healthRatio = resolveHealthRatio(player);
    const survivalPressure = resolveSurvivalPressure(bot, player);
    const emergencyForwardRisk = Number.isFinite(Number(bot.profile?.emergencyForwardRisk))
        ? Number(bot.profile.emergencyForwardRisk)
        : 0.82;
    const emergencyPressure = Number.isFinite(Number(bot.profile?.emergencyPressure))
        ? Number(bot.profile.emergencyPressure)
        : 0.9;
    const emergencyBouncePressure = Number.isFinite(Number(bot.profile?.emergencyBouncePressure))
        ? Number(bot.profile.emergencyBouncePressure)
        : 2.0;

    const shouldEmergencyRecovery = (
        bot.state.recoveryCooldown <= 0
        && (
            bot.sense.immediateDanger
            || bot.sense.forwardRisk >= emergencyForwardRisk
            || bot.sense.pressure >= emergencyPressure
            || (healthRatio < 0.35 && survivalPressure > 0.72)
        )
        && (
            bot._recentBouncePressure >= emergencyBouncePressure
            || bot._bounceStreak >= 2
            || bot.sense.forwardRisk > 0.9
        )
    );
    if (shouldEmergencyRecovery) {
        enterRecovery(bot, player, arena, allPlayers, 'survival-emergency');
        if (updateRecovery(bot, dt, player, arena, allPlayers)) {
            return true;
        }
    }

    const collisionPressureThreshold = Number.isFinite(Number(bot.profile?.collisionPressureRecoveryThreshold))
        ? Number(bot.profile.collisionPressureRecoveryThreshold)
        : 2.3;
    if (bot.sense.immediateDanger && bot.state.recoveryCooldown <= 0 && bot._recentBouncePressure > collisionPressureThreshold) {
        enterRecovery(bot, player, arena, allPlayers, 'collision-pressure');
        if (updateRecovery(bot, dt, player, arena, allPlayers)) {
            return true;
        }
    }

    if (bot.sense.projectileThreat) {
        const best = bot.sense.bestProbe;
        let evadeYaw = bot.sense.projectileEvadeYaw;
        if (best) {
            player.getDirection(bot._tmpForward).normalize();
            bot._buildBasis(bot._tmpForward);
            const probeYaw = bot._tmpRight.dot(best.dir);
            const probeYawSign = Math.abs(probeYaw) > 0.1 ? (probeYaw > 0 ? 1 : -1) : 0;
            if (evadeYaw === 0 && probeYawSign !== 0) {
                evadeYaw = probeYawSign;
            }
            if (
                evadeYaw !== 0
                && probeYawSign !== 0
                && Math.sign(probeYawSign) !== Math.sign(evadeYaw)
                && (bot.sense.forwardRisk > 0.38 || survivalPressure > 0.6)
            ) {
                evadeYaw = probeYawSign;
            }
        }
        bot._decision.yaw = evadeYaw;
        bot._decision.pitch = bot.sense.projectileEvadePitch;
        const projectileBoostRiskCeiling = Number.isFinite(Number(bot.profile?.projectileBoostRiskCeiling))
            ? Number(bot.profile.projectileBoostRiskCeiling)
            : 0.5;
        bot._decision.boost = !bot.sense.immediateDanger
            && bot.sense.forwardRisk < projectileBoostRiskCeiling
            && survivalPressure < 0.68;
    } else {
        const portalDriven = applyPortalSteering(bot, player);
        if (!portalDriven) {
            if (bot.sense.pursuitActive) {
                const pursuitRiskCeiling = Number.isFinite(Number(bot.profile?.pursuitRiskCeiling))
                    ? Number(bot.profile.pursuitRiskCeiling)
                    : 0.42;
                const pursuitSurvivalCeiling = Number.isFinite(Number(bot.profile?.pursuitSurvivalCeiling))
                    ? Number(bot.profile.pursuitSurvivalCeiling)
                    : 0.66;
                const pursueAggressively = (
                    !bot.sense.immediateDanger
                    && bot.sense.forwardRisk < pursuitRiskCeiling
                    && survivalPressure < pursuitSurvivalCeiling
                    && healthRatio > 0.22
                );

                if (!pursueAggressively) {
                    decideSteering(bot, player);
                    // Nudge toward target only while enough safety margin remains.
                    if (
                        bot.sense.forwardRisk < pursuitRiskCeiling + 0.14
                        && bot.sense.pursuitYaw !== 0
                        && survivalPressure < 0.8
                    ) {
                        const best = bot.sense.bestProbe;
                        if (best) {
                            player.getDirection(bot._tmpForward).normalize();
                            bot._buildBasis(bot._tmpForward);
                            const probeYaw = bot._tmpRight.dot(best.dir);
                            if (Math.sign(probeYaw) === Math.sign(bot.sense.pursuitYaw) || Math.abs(probeYaw) < 0.1) {
                                bot._decision.yaw = bot.sense.pursuitYaw;
                            }
                        }
                    }
                } else {
                    bot._decision.yaw = bot.sense.pursuitYaw;
                    bot._decision.pitch = bot.sense.pursuitPitch;
                    if (
                        bot.sense.targetDistanceSq > 400
                        && bot.sense.forwardRisk < 0.35
                        && survivalPressure < 0.55
                    ) {
                        bot._decision.boost = true;
                    }
                }
                const aimTolerance = bot.profile.pursuitAimTolerance || 0.85;
                if (
                    pursueAggressively
                    && bot.sense.pursuitAimDot > aimTolerance
                    && player.inventory
                    && player.inventory.length > 0
                ) {
                    let bestIdx = 0;
                    let bestOff = -Infinity;
                    for (let ii = 0; ii < player.inventory.length; ii++) {
                        const normalizedType = normalizePickupType(player.inventory[ii], {
                            fallback: player.inventory[ii],
                        });
                        if (!isPickupTypeShootable(normalizedType)) continue;
                        const rule = itemRules[normalizedType];
                        const off = rule ? rule.offense : 0;
                        if (off > bestOff) { bestOff = off; bestIdx = ii; }
                    }
                    if (bestOff > 0.3 && bot.state.itemShootCooldown <= 0) {
                        bot._decision.shootItem = true;
                        bot._decision.shootItemIndex = bestIdx;
                        bot.state.itemShootCooldown = bot.profile.itemShootCooldown;
                    }
                }
            } else {
                decideSteering(bot, player);
            }
        }
    }

    decideItemUsage(bot, player, itemRules);
    return false;
}
