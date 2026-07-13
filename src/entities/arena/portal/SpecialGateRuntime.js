import * as THREE from 'three';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../../shared/contracts/GameplayActionResultContract.js';
import {
    normalizeEntityKey,
    resolveEntityCooldown,
} from './TraversalCooldownOps.js';

function resolveGateResultCode(type = '') {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (normalizedType === 'boost') return GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_BOOST;
    if (normalizedType === 'slingshot') return GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_SLINGSHOT;
    return GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_UNKNOWN;
}

function buildGateInteractionResult({
    ok = false,
    code = '',
    type = null,
    message = '',
    cooldownSeconds = null,
    cooldownRemaining = null,
    meta = null,
    ...extra
} = {}) {
    return {
        ...buildGameplayActionResult({
            ok,
            code,
            message,
            mode: 'gate',
            type,
            cooldownSeconds,
            cooldownRemaining,
            meta,
        }),
        ...extra,
    };
}

export class SpecialGateRuntime {
    constructor(arena) {
        this.arena = arena;
        this._tmpVecGate1 = new THREE.Vector3();
        this._tmpVecGate2 = new THREE.Vector3();
    }

    _syncGateVisualState(gate, timeSeconds = 0) {
        if (!gate?.mesh) return;
        const engaged = gate.cooldowns instanceof Map && gate.cooldowns.size > 0;
        const scale = engaged ? 0.9 + Math.sin(timeSeconds * 7) * 0.025 : 1;
        if (gate.mesh.scale?.setScalar) {
            gate.mesh.scale.setScalar(scale);
            return;
        }
        gate.mesh.scale?.set?.(scale, scale, scale);
    }

    _normalizeEntityKey(entityId) {
        return normalizeEntityKey(entityId);
    }

    _resolveEntityCooldown(cooldownMap, entityId) {
        return resolveEntityCooldown(cooldownMap, entityId);
    }

    checkSpecialGates(position, previousPosition, radius, entityId) {
        if (!this.arena.specialGates || this.arena.specialGates.length === 0) return null;
        let blockedCooldownRemaining = 0;

        for (const gate of this.arena.specialGates) {
            const distSq = position.distanceToSquared(gate.pos);
            const checkDist = gate.radius + radius;
            if (distSq > checkDist * checkDist) continue;

            const cooldownRemaining = this._resolveEntityCooldown(gate.cooldowns, entityId);
            if (cooldownRemaining > 0) {
                blockedCooldownRemaining = Math.max(blockedCooldownRemaining, cooldownRemaining);
                continue;
            }

            this._tmpVecGate1.subVectors(previousPosition, gate.pos);
            this._tmpVecGate2.subVectors(position, gate.pos);

            const dotPrev = this._tmpVecGate1.dot(gate.forward);
            const dotCurr = this._tmpVecGate2.dot(gate.forward);

            if (dotPrev <= 0 && dotCurr > 0) {
                const dynamicCooldown = gate.params.cooldown || 4.0;
                gate.cooldowns.set(entityId, dynamicCooldown);
                return buildGateInteractionResult({
                    ok: true,
                    code: resolveGateResultCode(gate.type),
                    type: gate.type,
                    message: 'Spezial-Gate aktiviert',
                    cooldownSeconds: dynamicCooldown,
                    forward: gate.forward,
                    up: gate.up,
                    params: gate.params,
                });
            }
        }

        if (blockedCooldownRemaining > 0) {
            return buildGateInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_COOLDOWN,
                message: `Gate-Cooldown: ${blockedCooldownRemaining.toFixed(2)}s`,
                blockedReason: 'cooldown',
                cooldownRemaining: blockedCooldownRemaining,
            });
        }

        return null;
    }

    update(dt) {
        for (const gate of this.arena.specialGates) {
            for (const [id, t] of gate.cooldowns) {
                const newT = t - dt;
                if (newT <= 0) {
                    gate.cooldowns.delete(id);
                } else {
                    gate.cooldowns.set(id, newT);
                }
            }
        }

        const time = performance.now() * 0.001;
        for (const gate of this.arena.specialGates) {
            if (!gate.mesh) continue;
            const { spines, outerRing, innerDisk, frontRing, backRing } = gate.mesh.userData;
            if (spines) {
                for (let i = 0; i < spines.length; i++) {
                    if (spines[i]?.setRotation) {
                        spines[i].setRotation('x', time * 2 + i * 0.5);
                    } else if (spines[i]) {
                        spines[i].rotation.x = time * 2 + i * 0.5;
                    }
                }
            }
            if (outerRing?.setRotation) outerRing.setRotation('z', time * 0.8);
            else if (outerRing) outerRing.rotation.z = time * 0.8;
            if (innerDisk?.setRotation) innerDisk.setRotation('z', -time * 1.2);
            else if (innerDisk) innerDisk.rotation.z = -time * 1.2;
            if (frontRing?.setRotation) frontRing.setRotation('z', time * 0.6);
            else if (frontRing) frontRing.rotation.z = time * 0.6;
            if (backRing?.setRotation) backRing.setRotation('z', -time * 0.9);
            else if (backRing) backRing.rotation.z = -time * 0.9;
            this._syncGateVisualState(gate, time);
        }
    }

    getEntityGateRuntimeSignal(entityId) {
        if (!Array.isArray(this.arena.specialGates) || this.arena.specialGates.length === 0) {
            return {
                gateCount: 0,
                gateCooldownRemaining: 0,
            };
        }

        let gateCooldownRemaining = 0;
        for (const gate of this.arena.specialGates) {
            const remaining = this._resolveEntityCooldown(gate?.cooldowns, entityId);
            if (remaining > gateCooldownRemaining) {
                gateCooldownRemaining = remaining;
            }
        }

        return {
            gateCount: this.arena.specialGates.length,
            gateCooldownRemaining,
        };
    }
}
