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
        const pulseStrength = Math.min(1, Math.max(0, Number(gate.visualPulseRemaining) || 0) / 0.35);
        gate.mesh.updateGateVisualState?.(timeSeconds, pulseStrength);
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
                gate.visualPulseRemaining = 0.35;
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
            gate.visualPulseRemaining = Math.max(0, Number(gate.visualPulseRemaining || 0) - dt);
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
