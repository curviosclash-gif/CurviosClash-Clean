// ============================================
// StateReconciler.js - client-side state correction
// ============================================
import { normalizeMultiplayerStateUpdateEvent } from '../shared/contracts/MultiplayerSessionContract.js';
import { applyHuntNetworkState } from '../hunt/HuntNetworkState.js';
import { replayPlayerDeathPresentation } from '../entities/EntityPlayerDeathOps.js';

const MIN_POSITION_DISTANCE = 0.01;
const MIN_VECTOR_DISTANCE = 0.001;
const MIN_QUATERNION_ANGLE = 0.0005;

function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, toFiniteNumber(value, 0)));
}

function normalizeQuaternion(x, y, z, w) {
    const nx = toFiniteNumber(x, 0);
    const ny = toFiniteNumber(y, 0);
    const nz = toFiniteNumber(z, 0);
    const nw = toFiniteNumber(w, 1);
    const length = Math.hypot(nx, ny, nz, nw);
    if (length <= 0.000001) {
        return { x: 0, y: 0, z: 0, w: 1 };
    }
    return {
        x: nx / length,
        y: ny / length,
        z: nz / length,
        w: nw / length,
    };
}

function readQuaternionTarget(serverPlayer) {
    const rot = Array.isArray(serverPlayer?.rot)
        ? serverPlayer.rot
        : Array.isArray(serverPlayer?.rotation)
            ? serverPlayer.rotation
            : null;
    if (!rot || rot.length < 4) return null;
    return normalizeQuaternion(rot[0], rot[1], rot[2], rot[3]);
}

function readVectorTarget(source, primaryKey, fallbackKey = null) {
    const value = Array.isArray(source?.[primaryKey])
        ? source?.[primaryKey]
        : fallbackKey && Array.isArray(source?.[fallbackKey])
            ? source?.[fallbackKey]
            : null;
    if (!value || value.length < 3) return null;
    return {
        x: toFiniteNumber(value[0], 0),
        y: toFiniteNumber(value[1], 0),
        z: toFiniteNumber(value[2], 0),
    };
}

function vectorDistance(localVector, targetVector) {
    const dx = targetVector.x - toFiniteNumber(localVector?.x, 0);
    const dy = targetVector.y - toFiniteNumber(localVector?.y, 0);
    const dz = targetVector.z - toFiniteNumber(localVector?.z, 0);
    return Math.hypot(dx, dy, dz);
}

function quaternionAngle(localQuaternion, targetQuaternion) {
    const lx = toFiniteNumber(localQuaternion?.x, 0);
    const ly = toFiniteNumber(localQuaternion?.y, 0);
    const lz = toFiniteNumber(localQuaternion?.z, 0);
    const lw = toFiniteNumber(localQuaternion?.w, 1);
    const localLength = Math.hypot(lx, ly, lz, lw);
    if (localLength <= 0.000001) {
        return Math.PI;
    }
    const local = {
        x: lx / localLength,
        y: ly / localLength,
        z: lz / localLength,
        w: lw / localLength,
    };
    const dot = Math.min(1, Math.max(-1, Math.abs(
        local.x * targetQuaternion.x
        + local.y * targetQuaternion.y
        + local.z * targetQuaternion.z
        + local.w * targetQuaternion.w
    )));
    return 2 * Math.acos(dot);
}

function setVector(localVector, targetVector) {
    if (!localVector || !targetVector) return;
    if (typeof localVector.set === 'function') {
        localVector.set(targetVector.x, targetVector.y, targetVector.z);
        return;
    }
    localVector.x = targetVector.x;
    localVector.y = targetVector.y;
    localVector.z = targetVector.z;
}

function blendVector(localVector, targetVector, alpha) {
    if (!localVector || !targetVector) return;
    const t = clamp01(alpha);
    localVector.x = toFiniteNumber(localVector.x, 0) + (targetVector.x - toFiniteNumber(localVector.x, 0)) * t;
    localVector.y = toFiniteNumber(localVector.y, 0) + (targetVector.y - toFiniteNumber(localVector.y, 0)) * t;
    localVector.z = toFiniteNumber(localVector.z, 0) + (targetVector.z - toFiniteNumber(localVector.z, 0)) * t;
}

function setQuaternion(localQuaternion, targetQuaternion) {
    if (!localQuaternion || !targetQuaternion) return;
    if (typeof localQuaternion.set === 'function') {
        localQuaternion.set(targetQuaternion.x, targetQuaternion.y, targetQuaternion.z, targetQuaternion.w);
        return;
    }
    localQuaternion.x = targetQuaternion.x;
    localQuaternion.y = targetQuaternion.y;
    localQuaternion.z = targetQuaternion.z;
    localQuaternion.w = targetQuaternion.w;
}

function blendQuaternion(localQuaternion, targetQuaternion, alpha) {
    if (!localQuaternion || !targetQuaternion) return;
    const t = clamp01(alpha);
    const blended = normalizeQuaternion(
        toFiniteNumber(localQuaternion.x, 0) + (targetQuaternion.x - toFiniteNumber(localQuaternion.x, 0)) * t,
        toFiniteNumber(localQuaternion.y, 0) + (targetQuaternion.y - toFiniteNumber(localQuaternion.y, 0)) * t,
        toFiniteNumber(localQuaternion.z, 0) + (targetQuaternion.z - toFiniteNumber(localQuaternion.z, 0)) * t,
        toFiniteNumber(localQuaternion.w, 1) + (targetQuaternion.w - toFiniteNumber(localQuaternion.w, 1)) * t
    );
    setQuaternion(localQuaternion, blended);
}

function normalizeEffects(effects) {
    if (!Array.isArray(effects)) return [];
    return effects
        .map((effect) => {
            const type = String(effect?.type || '').trim();
            if (!type) return null;
            return {
                type,
                remaining: Math.max(0, toFiniteNumber(effect?.remaining, 0)),
                sourcePlayerIndex: Number.isInteger(effect?.sourcePlayerIndex)
                    ? effect.sourcePlayerIndex
                    : null,
            };
        })
        .filter(Boolean);
}

/**
 * Compares local predicted state with authoritative host state.
 * Applies corrections via interpolation to avoid visual snapping.
 */
export class StateReconciler {
    constructor(options = {}) {
        this._correctionRate = toFiniteNumber(options.correctionRate, 0.3);
        this._snapThreshold = toFiniteNumber(options.snapThreshold, 5.0);
        this._positionCorrectionRate = clamp01(toFiniteNumber(options.positionCorrectionRate, this._correctionRate));
        this._rotationCorrectionRate = clamp01(toFiniteNumber(options.rotationCorrectionRate, 0.35));
        this._velocityCorrectionRate = clamp01(toFiniteNumber(options.velocityCorrectionRate, 0.4));
        this._snapThresholds = {
            position: Math.max(0, toFiniteNumber(options.positionSnapThreshold, this._snapThreshold)),
            rotation: Math.max(0, toFiniteNumber(options.rotationSnapThreshold, 0.35)),
            velocity: Math.max(0, toFiniteNumber(options.velocitySnapThreshold, 8)),
        };
        this._lastStateUpdate = null;
    }

    receiveServerState(serverState) {
        this._lastStateUpdate = normalizeMultiplayerStateUpdateEvent(serverState);
    }

    reconcile(localPlayers, entityManager) {
        if (!this._lastStateUpdate) return;

        entityManager?.applyNetworkSnapshot?.(this._lastStateUpdate?.state);
        applyHuntNetworkState(entityManager, this._lastStateUpdate?.state?.fight);

        const serverPlayers = this._lastStateUpdate?.state?.players;
        if (!Array.isArray(localPlayers) || !serverPlayers) return;

        for (const serverPlayer of serverPlayers) {
            const localPlayer = localPlayers.find((player) => player.index === serverPlayer.index);
            if (!localPlayer) continue;

            this._reconcilePosition(localPlayer, serverPlayer);
            this._reconcileRotation(localPlayer, serverPlayer);
            this._reconcileVelocity(localPlayer, serverPlayer);
            this._reconcileEffects(localPlayer, serverPlayer);
            this._reconcileAuthoritativeFields(localPlayer, serverPlayer, entityManager);
        }
    }

    _reconcileAuthoritativeFields(localPlayer, serverPlayer, entityManager = null) {
        if (typeof serverPlayer.alive === 'boolean') {
            const aliveChanged = localPlayer.alive !== serverPlayer.alive;
            if (aliveChanged && serverPlayer.alive === false) {
                // The local simulation never saw this death happen (e.g. a rocket hit,
                // which only the host resolves in ProjectileSystem.update). Replay only its
                // presentation: host state owns scoring, lifecycle and respawn timing.
                replayPlayerDeathPresentation(entityManager, localPlayer, serverPlayer.deathCause || 'UNKNOWN', {
                    projectileType: serverPlayer.deathProjectileType || null,
                });
            }
            localPlayer.alive = serverPlayer.alive;
            if (aliveChanged && serverPlayer.alive === true) {
                localPlayer.view?.setVisible?.(true);
            }
        }

        const health = Number(serverPlayer.hp ?? serverPlayer.health);
        if (Number.isFinite(health)) {
            localPlayer.hp = health;
            // Plain legacy network actors may still expose `health`; keep that alias synchronized when present.
            if (Object.prototype.hasOwnProperty.call(localPlayer, 'health')) {
                localPlayer.health = health;
            }
        }

        const shieldHP = Number(serverPlayer.shieldHP);
        if (Number.isFinite(shieldHP)) {
            localPlayer.shieldHP = shieldHP;
            localPlayer.hasShield = typeof serverPlayer.hasShield === 'boolean'
                ? serverPlayer.hasShield
                : shieldHP > 0;
        } else if (typeof serverPlayer.hasShield === 'boolean') {
            localPlayer.hasShield = serverPlayer.hasShield;
        }

        if (Array.isArray(serverPlayer.inventory)) {
            if (!Array.isArray(localPlayer.inventory)) {
                localPlayer.inventory = [];
            }
            localPlayer.inventory.length = 0;
            localPlayer.inventory.push(...serverPlayer.inventory);
        }
        if (Array.isArray(serverPlayer.rocketInventory)) {
            if (!Array.isArray(localPlayer.rocketInventory)) localPlayer.rocketInventory = [];
            localPlayer.rocketInventory.length = 0;
            localPlayer.rocketInventory.push(...serverPlayer.rocketInventory);
        }

        if (typeof serverPlayer.score === 'number') {
            localPlayer.score = serverPlayer.score;
        }
        if (typeof serverPlayer.speed === 'number') {
            localPlayer.speed = serverPlayer.speed;
        }
        if (serverPlayer.exclusionZone && typeof serverPlayer.exclusionZone === 'object') {
            const zoneSystem = entityManager?._exclusionZoneSystem;
            if (zoneSystem?.applyNetworkState) zoneSystem.applyNetworkState(localPlayer, serverPlayer.exclusionZone);
            else localPlayer.exclusionZoneState = { ...serverPlayer.exclusionZone };
        }
    }

    _reconcilePosition(localPlayer, serverPlayer) {
        if (!localPlayer?.position) return;
        const target = readVectorTarget(serverPlayer, 'pos', 'position');
        if (!target) return;
        const distance = vectorDistance(localPlayer.position, target);
        if (distance > this._snapThresholds.position) {
            setVector(localPlayer.position, target);
            return;
        }
        if (distance > MIN_POSITION_DISTANCE) {
            blendVector(localPlayer.position, target, this._positionCorrectionRate);
        }
    }

    _reconcileRotation(localPlayer, serverPlayer) {
        if (!localPlayer?.quaternion) return;
        const target = readQuaternionTarget(serverPlayer);
        if (!target) return;
        const angle = quaternionAngle(localPlayer.quaternion, target);
        if (angle > this._snapThresholds.rotation) {
            setQuaternion(localPlayer.quaternion, target);
            return;
        }
        if (angle > MIN_QUATERNION_ANGLE) {
            blendQuaternion(localPlayer.quaternion, target, this._rotationCorrectionRate);
        }
    }

    _reconcileVelocity(localPlayer, serverPlayer) {
        if (!localPlayer?.velocity) return;
        const target = readVectorTarget(serverPlayer, 'vel', 'velocity');
        if (!target) return;
        const distance = vectorDistance(localPlayer.velocity, target);
        if (distance > this._snapThresholds.velocity) {
            setVector(localPlayer.velocity, target);
            return;
        }
        if (distance > MIN_VECTOR_DISTANCE) {
            blendVector(localPlayer.velocity, target, this._velocityCorrectionRate);
        }
    }

    _reconcileEffects(localPlayer, serverPlayer) {
        const effects = normalizeEffects(serverPlayer?.effects ?? serverPlayer?.activeEffects);
        if (!Array.isArray(localPlayer?.activeEffects)) {
            if (effects.length > 0) {
                localPlayer.activeEffects = effects;
            }
            return;
        }
        localPlayer.activeEffects.length = 0;
        for (const effect of effects) {
            localPlayer.activeEffects.push(effect);
        }
    }

    reset() {
        this._lastStateUpdate = null;
    }
}
