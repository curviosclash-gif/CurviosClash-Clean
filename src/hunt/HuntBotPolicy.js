import * as THREE from 'three';
import { isRocketTierType } from './RocketPickupSystem.js';
import { RuleBasedBotPolicy } from '../entities/ai/RuleBasedBotPolicy.js';
import { BOT_POLICY_TYPES } from '../entities/ai/BotPolicyTypes.js';
import { BOT_ITEM_RULES } from '../entities/ai/BotTuningConfig.js';
import { resolveHuntTargetOwnerPlayer } from './HuntTargetingOps.js';
import {
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    normalizePickupType,
} from '../entities/PickupRegistry.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

import { clamp } from '../utils/MathOps.js';
export { clamp };

export function resolveHealthRatio(player) {
    if (!player) return 1;
    const hp = Math.max(0, Number(player.hp) || 0);
    const maxHp = Math.max(1, Number(player.maxHp) || 1);
    return clamp(hp / maxHp, 0, 1);
}

export function resolveShieldRatio(player) {
    if (!player) return 0;
    const shield = Math.max(0, Number(player.shieldHP) || 0);
    const maxShield = Math.max(1, Number(player.maxShieldHp) || 1);
    return clamp(shield / maxShield, 0, 1);
}

export function getNearestEnemy(player, allPlayers, outVec) {
    let nearest = null;
    let nearestDistSq = Infinity;
    for (const other of allPlayers || []) {
        if (!other || other === player || !other.alive) continue;
        outVec.subVectors(other.position, player.position);
        const distSq = outVec.lengthSq();
        if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearest = other;
        }
    }
    return { enemy: nearest, distSq: nearestDistSq };
}

export function findStrongestRocketIndex(inventory = []) {
    let strongestIndex = -1;
    let strongestRank = -1;
    for (let i = 0; i < inventory.length; i++) {
        const type = inventory[i];
        if (!isRocketTierType(type)) continue;
        const rank = type === 'ROCKET_MEGA' ? 4 : (type === 'ROCKET_HEAVY' ? 3 : (type === 'ROCKET_MEDIUM' ? 2 : 1));
        if (rank > strongestRank) {
            strongestRank = rank;
            strongestIndex = i;
        }
    }
    return strongestIndex;
}

export function resolveHuntFallbackItemAction(player, options = {}) {
    const inventory = Array.isArray(player?.inventory) ? player.inventory : [];
    if (inventory.length === 0) {
        return {
            useItem: -1,
            shootItem: false,
            shootItemIndex: -1,
            type: null,
        };
    }

    const pressureLevel = clamp(Number(options.pressureLevel) || 0, 0, 1);
    const aggression = clamp(Number(options.aggression) || 0, 0.12, 1.0);
    const targetInFront = options.targetInFront === true;
    const healthRatio = clamp(Number(options.healthRatio) || 0, 0, 1);
    const shieldRatio = clamp(Number(options.shieldRatio) || 0, 0, 1);
    const survivalPressure = clamp(Number(options.survivalPressure) || 0, 0, 1);
    const preferDefense = options.preferDefense === true;
    const preferTraversal = options.preferTraversal === true;
    const targetBonus = targetInFront ? 1.1 : 0.5;
    const enemyClose = options.enemyClose === true;
    const crashRisk = clamp(Number(options.crashRisk) || 0, 0, 1);
    const contextWeight = 0.5;

    let bestUseScore = Number.NEGATIVE_INFINITY;
    let bestUseIndex = -1;
    let bestUseType = null;
    let bestShootScore = Number.NEGATIVE_INFINITY;
    let bestShootIndex = -1;
    let bestShootType = null;

    for (let i = 0; i < inventory.length; i += 1) {
        const normalizedType = normalizePickupType(inventory[i], { fallback: inventory[i] });
        if (!normalizedType || isRocketTierType(normalizedType)) continue;

        const rule = BOT_ITEM_RULES[normalizedType] || {
            self: 0,
            offense: 0,
            defensiveScale: 0,
            emergencyScale: 0,
            combatSelf: 0,
        };
        const traversalBias = preferTraversal && (normalizedType === 'SPEED_UP' || normalizedType === 'GHOST' || normalizedType === 'THICK')
            ? 0.22
            : 0;
        const shieldSaturationPenalty = normalizedType === 'SHIELD'
            ? shieldRatio * 0.65
            : 0;
        const selfScore = rule.self
            + pressureLevel * rule.defensiveScale
            + crashRisk * (rule.emergencyScale || 0) * contextWeight
            + (enemyClose ? (rule.combatSelf || 0) * contextWeight : 0)
            + traversalBias
            + (preferDefense ? 0.18 : 0)
            - shieldSaturationPenalty;
        const shootScore = rule.offense * (0.55 + aggression) * targetBonus
            - survivalPressure * 0.16;

        if (isPickupTypeSelfUsable(normalizedType, 'HUNT') && selfScore > bestUseScore) {
            bestUseScore = selfScore;
            bestUseIndex = i;
            bestUseType = normalizedType;
        }
        if (isPickupTypeShootable(normalizedType, 'HUNT') && shootScore > bestShootScore) {
            bestShootScore = shootScore;
            bestShootIndex = i;
            bestShootType = normalizedType;
        }
    }

    const defensiveUseThreshold = Math.max(
        0.34,
        0.68 - survivalPressure * 0.26 - (healthRatio < 0.45 ? 0.08 : 0) + shieldRatio * 0.12 - (preferDefense ? 0.14 : 0)
    );
    if (bestUseIndex >= 0 && bestUseScore > defensiveUseThreshold) {
        return {
            useItem: bestUseIndex,
            shootItem: false,
            shootItemIndex: -1,
            type: bestUseType,
        };
    }

    const offensiveShootThreshold = 0.48 + survivalPressure * 0.3 + (preferDefense ? 0.1 : 0);
    if (!preferDefense && bestShootIndex >= 0 && bestShootScore > offensiveShootThreshold) {
        return {
            useItem: -1,
            shootItem: true,
            shootItemIndex: bestShootIndex,
            type: bestShootType,
        };
    }

    return {
        useItem: -1,
        shootItem: false,
        shootItemIndex: -1,
        type: null,
    };
}

function resolveSensorSnapshot(policy) {
    if (typeof policy?._fallbackPolicy?.getSensorSnapshot === 'function') {
        return policy._fallbackPolicy.getSensorSnapshot();
    }
    return null;
}

function resolveSensorYawPitch(snapshot) {
    const yaw = Number.isFinite(snapshot?.targetYaw) ? snapshot.targetYaw : 0;
    const pitch = Number.isFinite(snapshot?.targetPitch) ? snapshot.targetPitch : 0;
    return { yaw, pitch };
}

export function clearSteeringInput(input) {
    input.yawLeft = false;
    input.yawRight = false;
    input.pitchUp = false;
    input.pitchDown = false;
}

export function applySteeringTowardPosition(policy, input, player, targetPosition) {
    if (!targetPosition || !player?.position) return;
    const planarMode = !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;
    policy._tmpGate.subVectors(targetPosition, player.position);
    if (policy._tmpGate.lengthSq() <= 0.000001) return;
    policy._tmpGate.normalize();
    player.getDirection(policy._tmpForward).normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
    if (policy._tmpRight.lengthSq() <= 0.000001) {
        policy._tmpRight.set(1, 0, 0);
    } else {
        policy._tmpRight.normalize();
    }
    policy._tmpUp.crossVectors(policy._tmpForward, policy._tmpRight).normalize();

    const yawTowardTarget = policy._tmpRight.dot(policy._tmpGate);
    if (Math.abs(yawTowardTarget) > 0.03) {
        input.yawLeft = yawTowardTarget > 0;
        input.yawRight = yawTowardTarget < 0;
    }

    if (!planarMode) {
        const pitchTowardTarget = policy._tmpUp.dot(policy._tmpGate);
        if (Math.abs(pitchTowardTarget) > 0.07) {
            input.pitchUp = pitchTowardTarget < 0;
            input.pitchDown = pitchTowardTarget > 0;
        }
    }
}

function applyRetreatSteeringFallback(policy, input, player, enemy) {
    if (!player?.position) return;
    const retreatDistance = 24;
    if (enemy?.position) {
        policy._tmpGate.subVectors(player.position, enemy.position);
        if (policy._tmpGate.lengthSq() > 0.000001) {
            policy._tmpGate.normalize().multiplyScalar(retreatDistance).add(player.position);
            applySteeringTowardPosition(policy, input, player, policy._tmpGate);
            return;
        }
    }
    if (typeof player.getDirection === 'function') {
        player.getDirection(policy._tmpForward);
    } else {
        policy._tmpForward.set(0, 0, 1);
    }
    if (policy._tmpForward.lengthSq() <= 0.000001) {
        policy._tmpForward.set(0, 0, 1);
    } else {
        policy._tmpForward.normalize();
    }
    policy._tmpGate.copy(player.position).addScaledVector(policy._tmpForward, retreatDistance);
    applySteeringTowardPosition(policy, input, player, policy._tmpGate);
}

function applyRetreatSteeringFromSensors(input, snapshot, player) {
    const planarMode = !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;
    const steering = resolveSensorYawPitch(snapshot);
    if (Math.abs(steering.yaw) > 0.01) {
        input.yawLeft = steering.yaw > 0;
        input.yawRight = steering.yaw < 0;
    }
    if (!planarMode && Math.abs(steering.pitch) > 0.01) {
        input.pitchUp = steering.pitch < 0;
        input.pitchDown = steering.pitch > 0;
    }
}

export function resolvePlayerCooldownKey(player) {
    if (typeof player?.id === 'string' && player.id.trim()) return player.id;
    if (Number.isFinite(player?.id)) return player.id;
    if (typeof player?.entityId === 'string' && player.entityId.trim()) return player.entityId;
    if (Number.isFinite(player?.entityId)) return player.entityId;
    if (Number.isFinite(player?.index)) return player.index;
    return null;
}

export function findNearestReadySpecialGate(policy, player, specialGates, maxDistanceSq = Infinity) {
    if (!player?.position || !Array.isArray(specialGates) || specialGates.length === 0) return null;
    const cooldownKey = resolvePlayerCooldownKey(player);
    let nearestGate = null;
    let nearestDistSq = Infinity;
    for (const gate of specialGates) {
        if (!gate?.pos) continue;
        const cooldownRemaining = gate.cooldowns instanceof Map && cooldownKey != null
            ? Number(gate.cooldowns.get(cooldownKey) || 0)
            : 0;
        if (cooldownRemaining > 0.001) continue;
        policy._tmpGate.subVectors(gate.pos, player.position);
        const distSq = policy._tmpGate.lengthSq();
        if (!Number.isFinite(distSq) || distSq > maxDistanceSq || distSq >= nearestDistSq) continue;
        nearestGate = gate;
        nearestDistSq = distSq;
    }
    return nearestGate ? { gate: nearestGate, distSq: nearestDistSq } : null;
}

export function findNearestReadyPortal(policy, player, arena, maxDistanceSq = Infinity) {
    if (!player?.position || !arena || arena.portalsEnabled !== true || !Array.isArray(arena.portals) || arena.portals.length === 0) {
        return null;
    }
    const cooldownKey = resolvePlayerCooldownKey(player);
    const forward = typeof player?.getDirection === 'function'
        ? player.getDirection(policy._tmpForward).normalize()
        : null;
    let nearestEntry = null;
    let nearestDistSq = Infinity;

    for (const portal of arena.portals) {
        if (!portal?.posA || !portal?.posB) continue;
        const cooldownRemaining = portal.cooldowns instanceof Map && cooldownKey != null
            ? Number(portal.cooldowns.get(cooldownKey) || 0)
            : 0;
        if (cooldownRemaining > 0.001) continue;

        const entries = [
            { entry: portal.posA, exit: portal.posB },
            { entry: portal.posB, exit: portal.posA },
        ];
        for (const candidate of entries) {
            policy._tmpGate.subVectors(candidate.entry, player.position);
            const distSq = policy._tmpGate.lengthSq();
            if (!Number.isFinite(distSq) || distSq > maxDistanceSq || distSq >= nearestDistSq) continue;
            const alignment = forward
                ? policy._tmpGate.normalize().dot(forward)
                : 1;
            if (alignment < -0.35) continue;
            nearestEntry = {
                portal,
                entry: candidate.entry,
                exit: candidate.exit,
                distSq,
                alignment,
            };
            nearestDistSq = distSq;
        }
    }

    return nearestEntry;
}

function invokeFallbackPolicyUpdate(policy, dt, player, runtimeContext) {
    const fallback = policy?._fallbackPolicy;
    const update = fallback?.update;
    if (typeof update !== 'function') return {};

    if (fallback?.usesRuntimeContext === true || update.length <= 3) {
        return update.call(fallback, dt, player, runtimeContext);
    }
    return update.call(
        fallback,
        dt,
        player,
        runtimeContext?.arena,
        runtimeContext?.players,
        runtimeContext?.projectiles
    );
}

export class HuntBotPolicy {
    constructor(options = {}) {
        this.type = BOT_POLICY_TYPES.HUNT;
        this.usesRuntimeContext = true;
        this.sensePhase = 0;
        this._fallbackPolicy = new RuleBasedBotPolicy(options);
        this._tmpToEnemy = new THREE.Vector3();
        this._tmpForward = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._tmpUp = new THREE.Vector3();
        this._tmpGate = new THREE.Vector3();
    }

    update(dt, player, runtimeContext = null) {
        const input = invokeFallbackPolicyUpdate(this, dt, player, runtimeContext);
        if (!player || !player.alive) return input;
        const huntConfig = resolveGameplayConfig(player).HUNT;

        const allPlayers = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
        const snapshot = resolveSensorSnapshot(this);
        const huntTarget = runtimeContext?.huntTarget || null;
        const nearest = getNearestEnemy(player, allPlayers, this._tmpToEnemy);
        const targetPlayer = resolveHuntTargetOwnerPlayer(huntTarget, allPlayers);
        const enemy = targetPlayer || (snapshot?.targetPlayer && snapshot.targetPlayer.alive ? snapshot.targetPlayer : nearest.enemy);
        const distSq = Number.isFinite(huntTarget?.distance)
            ? huntTarget.distance * huntTarget.distance
            : (Number.isFinite(snapshot?.targetDistanceSq) ? snapshot.targetDistanceSq : nearest.distSq);
        const targetInFront = huntTarget ? true : (snapshot ? !!snapshot.targetInFront : true);
        const pressure = Number.isFinite(snapshot?.pressure) ? snapshot.pressure : 0;
        const projectileThreat = !!snapshot?.projectileThreat;
        const hasSharedTarget = !!huntTarget;
        const specialGates = Array.isArray(runtimeContext?.arena?.specialGates) ? runtimeContext.arena.specialGates : [];

        const healthRatio = resolveHealthRatio(player);
        const shieldRatio = resolveShieldRatio(player);
        const enemyHealthRatio = resolveHealthRatio(enemy);
        const enemyShieldRatio = resolveShieldRatio(enemy);
        const vitalityRatio = clamp(healthRatio * 0.72 + shieldRatio * 0.28, 0, 1);
        const enemyVitalityRatio = clamp(enemyHealthRatio * 0.72 + enemyShieldRatio * 0.28, 0, 1);
        const aggression = clamp(0.5 + (vitalityRatio - enemyVitalityRatio) * 0.9, 0.12, 1.0);
        const survivalPressure = Math.max(
            pressure,
            projectileThreat ? 0.82 : 0,
            (1 - vitalityRatio) * 0.95
        );
        const fallbackItemAction = resolveHuntFallbackItemAction(player, {
            pressureLevel: pressure,
            aggression,
            targetInFront,
            healthRatio,
            shieldRatio,
            survivalPressure,
            preferDefense: projectileThreat || survivalPressure > 0.62,
            preferTraversal: survivalPressure > 0.72 || vitalityRatio < 0.38,
            enemyClose: distSq <= 22 * 22,
            crashRisk: projectileThreat ? 1 : (pressure > 0.64 ? 0.5 : 0),
        });
        const mgRange = Math.max(12, Number(huntConfig?.MG?.RANGE || 95));
        const mgRangeSq = mgRange * mgRange;
        input.shootMG = false;

        if (
            (hasSharedTarget || enemy)
            && distSq <= mgRangeSq
            && (shieldRatio > 0.08 || healthRatio > 0.32)
            && aggression >= 0.4
            && targetInFront
            && survivalPressure < 0.85
        ) {
            input.shootMG = true;
        }

        const rocketIndex = findStrongestRocketIndex(player.inventory);
        if (rocketIndex >= 0 && (hasSharedTarget || enemy)) {
            const shouldUseRocket =
                enemyShieldRatio > 0.18
                || enemyHealthRatio > 0.45
                || distSq > 22 * 22
                || pressure > 0.56
                || projectileThreat
                || survivalPressure > 0.54
                || vitalityRatio < 0.52;
            if (shouldUseRocket) {
                input.shootItem = true;
                input.shootItemIndex = rocketIndex;
            }
        }

        if (!(Number.isInteger(input.useItem) && input.useItem >= 0) && fallbackItemAction.useItem >= 0) {
            input.useItem = fallbackItemAction.useItem;
        } else if (
            rocketIndex < 0
            && input.shootItem !== true
            && fallbackItemAction.shootItem === true
            && fallbackItemAction.shootItemIndex >= 0
        ) {
            input.shootItem = true;
            input.shootItemIndex = fallbackItemAction.shootItemIndex;
        }

        const shouldRetreat = !!enemy && (vitalityRatio <= 0.34 || (vitalityRatio < 0.52 && survivalPressure > 0.76));
        if (shouldRetreat) {
            const gateAssistRange = Math.max(24, Number(huntConfig?.RETREAT_GATE_RANGE || 54));
            const readyGate = (survivalPressure > 0.8 || vitalityRatio < 0.3)
                ? findNearestReadySpecialGate(this, player, specialGates, gateAssistRange * gateAssistRange)
                : null;
            const portalAssistRange = Math.max(30, gateAssistRange * 1.25);
            const readyPortal = readyGate?.gate
                ? null
                : findNearestReadyPortal(this, player, runtimeContext?.arena, portalAssistRange * portalAssistRange);
            const hasSensorSteering = snapshot && (Math.abs(snapshot.targetYaw || 0) > 0.01 || Math.abs(snapshot.targetPitch || 0) > 0.01);
            clearSteeringInput(input);
            if (readyGate?.gate) {
                applySteeringTowardPosition(this, input, player, readyGate.gate.pos);
            } else if (readyPortal?.entry) {
                applySteeringTowardPosition(this, input, player, readyPortal.entry);
            } else if (hasSensorSteering) {
                applyRetreatSteeringFromSensors(input, snapshot, player);
            } else {
                applyRetreatSteeringFallback(this, input, player, enemy);
            }
            input.shootMG = false;
            input.boost = true;
            if (rocketIndex < 0) {
                input.shootItem = false;
                input.shootItemIndex = -1;
            }
        }

        return input;
    }

    setDifficulty(profileName) {
        if (typeof this._fallbackPolicy.setDifficulty === 'function') {
            this._fallbackPolicy.setDifficulty(profileName);
        }
    }

    onBounce(type, normal = null) {
        if (typeof this._fallbackPolicy.onBounce === 'function') {
            this._fallbackPolicy.onBounce(type, normal);
        }
    }

    setSensePhase(phase) {
        const normalizedPhase = Number.isFinite(Number(phase)) ? Math.max(0, Math.trunc(Number(phase))) : 0;
        this.sensePhase = normalizedPhase;
        if (typeof this._fallbackPolicy.setSensePhase === 'function') {
            this._fallbackPolicy.setSensePhase(normalizedPhase);
        }
    }

    getSensorSnapshot() {
        if (typeof this._fallbackPolicy.getSensorSnapshot === 'function') {
            return this._fallbackPolicy.getSensorSnapshot();
        }
        return null;
    }

    getSensorArray() {
        if (typeof this._fallbackPolicy.getSensorArray === 'function') {
            return this._fallbackPolicy.getSensorArray();
        }
        return null;
    }
}
