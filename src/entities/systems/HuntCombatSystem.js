// ============================================
// HuntCombatSystem.js - inventory/projectile/lock-on combat helpers
// ============================================
//
// Contract:
// - Inputs: runtime context with explicit combat callbacks and temp vectors
// - Outputs: command results for inventory use, gun fire, lock-on target
// - Side effects: mutates player inventory/selection and lock-on cache
// - Hotpath guardrail: reuse runtime temp vectors and avoid per-call allocations

import * as THREE from 'three';
import {
    createHuntTargetingScratch,
    createHuntTargetingTelemetry,
    resolveHuntLineTarget,
} from '../../hunt/HuntTargetingOps.js';
import {
    isPickupTypeSelfUsable,
    normalizePickupType,
} from '../PickupRegistry.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../shared/contracts/GameplayActionResultContract.js';

function resolveActionResultCodes(action = 'use') {
    return action === 'shoot'
        ? {
            success: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_SUCCESS,
            invalidIndex: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_INVALID_INDEX,
            empty: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_EMPTY,
            invalidType: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_INVALID_TYPE,
        }
        : {
            success: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_SUCCESS,
            invalidIndex: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_INVALID_INDEX,
            empty: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_EMPTY,
            invalidType: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_INVALID_TYPE,
        };
}

export class HuntCombatSystem {
    constructor(runtimeContext) {
        this.runtime = runtimeContext || null;
        this._fallbackDirection = new THREE.Vector3();
        this._fallbackDelta = new THREE.Vector3();
        this._fallbackMuzzle = new THREE.Vector3();
        this._fallbackLockOnCache = new Map();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
    }

    _resolveInventoryIndex(player, preferredIndex = -1) {
        if (!Array.isArray(player?.inventory) || player.inventory.length === 0) {
            return -1;
        }
        if (Number.isInteger(preferredIndex) && preferredIndex >= player.inventory.length) {
            return -2;
        }
        const fallbackIndex = Number.isInteger(player?.selectedItemIndex)
            ? Math.max(0, player.selectedItemIndex)
            : 0;
        const requestedIndex = Number.isInteger(preferredIndex) && preferredIndex >= 0
            ? preferredIndex
            : fallbackIndex;
        return Math.min(requestedIndex, player.inventory.length - 1);
    }

    peekInventoryItem(player, preferredIndex = -1, action = 'use') {
        const codes = resolveActionResultCodes(action);
        const index = this._resolveInventoryIndex(player, preferredIndex);
        if (index === -2) {
            return buildGameplayActionResult({
                ok: false,
                code: codes.invalidIndex,
                message: 'Item-Slot ungueltig',
                type: null,
                meta: { requestedIndex: preferredIndex },
            });
        }
        if (index < 0) {
            return buildGameplayActionResult({
                ok: false,
                code: codes.empty,
                message: 'Kein Item verfuegbar',
                type: null,
                meta: { requestedIndex: preferredIndex },
            });
        }
        const rawType = player.inventory[index];
        const type = normalizePickupType(rawType, { fallback: rawType });
        if (!type) {
            return buildGameplayActionResult({
                ok: false,
                code: codes.invalidType,
                message: 'Item ungueltig',
                type: null,
                meta: { requestedIndex: preferredIndex, index },
            });
        }
        return buildGameplayActionResult({
            ok: true,
            code: codes.success,
            type,
            meta: { index, rawType, requestedIndex: preferredIndex },
        });
    }

    takeInventoryItem(player, preferredIndex = -1, action = 'use') {
        const codes = resolveActionResultCodes(action);
        const itemResult = this.peekInventoryItem(player, preferredIndex, action);
        if (!itemResult.ok) {
            return itemResult;
        }
        const index = Number(itemResult.meta?.index);
        const type = itemResult.type;
        const rawType = itemResult.meta?.rawType;
        const lastIdx = player.inventory.length - 1;
        if (index !== lastIdx) {
            player.inventory[index] = player.inventory[lastIdx];
        }
        player.inventory.length = lastIdx;
        if (player.inventory.length === 0 || player.selectedItemIndex >= player.inventory.length) {
            player.selectedItemIndex = 0;
        }
        return buildGameplayActionResult({
            ok: true,
            code: codes.success,
            type,
            meta: { rawType, index },
        });
    }

    _isHuntCombatStrategyActive() {
        const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
        return !!strategy?.hasMachineGun?.();
    }

    _resolveItemUseCooldownSeconds(itemType) {
        const config = resolveEntityRuntimeConfig(this.runtime);
        const huntConfig = config?.HUNT || {};
        const defaultCooldown = Math.max(0, Number(huntConfig.ITEM_USE_COOLDOWN_SECONDS || 0));
        const normalizedType = String(itemType || '').trim().toUpperCase();
        if (normalizedType !== 'SHIELD') return defaultCooldown;
        return Math.max(defaultCooldown, Number(huntConfig.SHIELD_USE_COOLDOWN_SECONDS || 0.65));
    }

    useInventoryItem(player, preferredIndex = -1) {
        const strategy = this.runtime?.callbacks?.getStrategy?.() || null;
        const modeType = String(strategy?.modeType || 'CLASSIC').trim().toUpperCase();
        const config = resolveEntityRuntimeConfig(this.runtime);
        const huntCombatActive = this._isHuntCombatStrategyActive();
        const cooldownRemaining = Math.max(0, Number(player?.itemUseCooldownRemaining || 0));
        if (huntCombatActive && cooldownRemaining > 0.001) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_COOLDOWN,
                message: `Item-Cooldown: ${cooldownRemaining.toFixed(2)}s`,
                cooldownRemaining,
            });
        }

        const itemPreview = this.peekInventoryItem(player, preferredIndex, 'use');
        if (!itemPreview.ok) {
            return itemPreview;
        }
        if (!config?.POWERUP?.TYPES?.[itemPreview.type]) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_INVALID_TYPE,
                message: 'Item ungueltig',
                type: itemPreview.type,
            });
        }
        if (!isPickupTypeSelfUsable(itemPreview.type, modeType)) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
                message: 'Item kann nicht direkt genutzt werden',
                type: itemPreview.type,
            });
        }

        const itemResult = this.takeInventoryItem(player, preferredIndex, 'use');
        if (!itemResult.ok) return itemResult;
        player.applyPowerup(itemResult.type);
        const nextCooldown = huntCombatActive ? this._resolveItemUseCooldownSeconds(itemResult.type) : 0;
        if (nextCooldown > 0) {
            player.itemUseCooldownRemaining = nextCooldown;
        }
        return buildGameplayActionResult({
            ok: true,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_SUCCESS,
            type: itemResult.type,
            mode: 'use',
            cooldownSeconds: nextCooldown,
        });
    }

    shootItemProjectile(player, preferredIndex = -1) {
        return this.runtime?.combat?.shootItemProjectile?.(player, preferredIndex)
            || buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_SYSTEM_MISSING,
                message: 'ProjectileSystem fehlt',
            });
    }

    shootHuntGun(player) {
        return this.runtime?.combat?.shootHuntGun?.(player)
            || { ok: false, reason: 'OverheatGunSystem fehlt' };
    }

    _resolveClassicLockOn(player, tmpDir, tmpVec) {
        const runtime = this.runtime;
        const config = resolveEntityRuntimeConfig(runtime);
        const maxAngle = (config.HOMING.LOCK_ON_ANGLE * Math.PI) / 180;
        const maxRangeSq = config.HOMING.MAX_LOCK_RANGE * config.HOMING.MAX_LOCK_RANGE;
        let bestTarget = null;
        let bestDistSq = Infinity;

        for (let i = 0; i < runtime.players.length; i++) {
            const other = runtime.players[i];
            if (other === player || !other?.alive) continue;
            tmpVec.subVectors(other.position, player.position);
            const distSq = tmpVec.lengthSq();
            if (distSq > maxRangeSq || distSq < 1) continue;
            const angle = tmpDir.angleTo(tmpVec.normalize());
            if (angle <= maxAngle && distSq < bestDistSq) {
                bestTarget = other;
                bestDistSq = distSq;
            }
        }

        return bestTarget;
    }

    checkLockOn(player) {
        const config = resolveEntityRuntimeConfig(this.runtime);
        const runtime = this.runtime;
        if (!runtime || !player) return null;

        const lockOnCache = runtime.cache?.lockOn || this._fallbackLockOnCache;
        if (lockOnCache.has(player.index)) return lockOnCache.get(player.index);

        const tmpDir = runtime.tempVectors?.direction || this._fallbackDirection;
        const tmpVec = runtime.tempVectors?.primary || this._fallbackDelta;
        if (typeof player.getAimDirection === 'function') {
            player.getAimDirection(tmpDir).normalize();
        } else {
            player.getDirection(tmpDir).normalize();
        }
        const strategy = runtime.callbacks?.getStrategy?.() || null;
        if (!strategy?.hasMachineGun()) {
            const legacyTarget = this._resolveClassicLockOn(player, tmpDir, tmpVec);
            lockOnCache.set(player.index, legacyTarget);
            return legacyTarget;
        }

        const muzzle = this._fallbackMuzzle;
        const muzzleOffset = Math.max(0, Number(config?.HUNT?.TARGETING?.MUZZLE_OFFSET || 2.1));
        muzzle.copy(player.position).addScaledVector(tmpDir, muzzleOffset);

        const mgRange = Math.max(10, Number(config?.HUNT?.MG?.RANGE || 95));
        const descriptor = resolveHuntLineTarget({
            sourcePlayer: player,
            players: runtime.players,
            trailSpatialIndex: runtime.getTrailSpatialIndex?.() || runtime.trails?.spatialIndex || null,
            origin: muzzle,
            direction: tmpDir,
            playerRange: Math.max(10, Number(config?.HOMING?.MAX_LOCK_RANGE || 100)),
            trailRange: mgRange,
            trailSampleStep: Number(config?.HUNT?.MG?.TRAIL_SAMPLE_STEP),
            trailHitRadius: Number(config?.HUNT?.MG?.TRAIL_HIT_RADIUS),
            trailSelfSkipRecent: Number(config?.HUNT?.MG?.TRAIL_SELF_SKIP_RECENT),
            allowSelfTrailFallback: false,
            runtimeProfiler: runtime?.services?.runtimeProfiler || runtime?.runtimeProfiler || null,
            targetingTelemetry: this._targetingTelemetry,
            scratch: this._targetingScratch,
        });

        lockOnCache.set(player.index, descriptor || null);
        return descriptor || null;
    }
}
