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
    isPickupTypeShootable,
    normalizePickupType,
} from '../PickupRegistry.js';
import { applyEmpPulse } from './EmpPulseOps.js';
import { isItemProjectileType, resolveItemProjectileTarget } from './projectile/ItemProjectileTargetingOps.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../shared/contracts/GameplayActionResultContract.js';
import { applyFightHumanAimAssist } from '../../hunt/FightAimAssist.js';
import { resolveFightMachineGunConfig } from '../../shared/contracts/FightMachineGunContract.js';
import { ensurePlayerInventoryCollections } from '../player/PlayerInventoryOps.js';

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
        this._itemLockDirection = new THREE.Vector3();
        this._itemLockScratch = new THREE.Vector3();
        this._fallbackLockOnCache = new Map();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
    }

    _resolveInventoryIndex(player, preferredIndex = -1) {
        ensurePlayerInventoryCollections(player);
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
        player.inventory.splice(index, 1);
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
        const modeType = String(strategy?.getPickupModeType?.() || strategy?.modeType || 'CLASSIC').trim().toUpperCase();
        const config = resolveEntityRuntimeConfig(this.runtime);
        const huntCombatActive = this._isHuntCombatStrategyActive();
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
        const selfUsable = isPickupTypeSelfUsable(itemPreview.type, modeType);
        if (!selfUsable && isPickupTypeShootable(itemPreview.type, modeType)) {
            // Attack items fire through "use item" and share the projectile cooldown.
            return this.shootItemProjectile(player, Number(itemPreview.meta?.index));
        }
        const cooldownRemaining = Math.max(0, Number(player?.itemUseCooldownRemaining || 0));
        if (huntCombatActive && cooldownRemaining > 0.001) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_COOLDOWN,
                message: `Item-Cooldown: ${cooldownRemaining.toFixed(2)}s`,
                cooldownRemaining,
            });
        }
        if (!selfUsable) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
                message: 'Item kann nicht direkt genutzt werden',
                type: itemPreview.type,
            });
        }

        const deploy = itemPreview.type === 'MG_TURRET' ? this.runtime?.combat?.deployMgTurret
            : itemPreview.type === 'ROCKET_TURRET' ? this.runtime?.combat?.deployRocketTurret : null;
        const isTurret = itemPreview.type === 'MG_TURRET' || itemPreview.type === 'ROCKET_TURRET';
        const isGlobalFog = itemPreview.type === 'FOG';
        const canActivateGlobalFog = this.runtime?.callbacks?.globalEffects?.canActivateFog;
        const activateGlobalFog = this.runtime?.callbacks?.globalEffects?.activateFog;
        if (isTurret && !deploy?.(player)) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
                message: 'Geschuetz konnte nicht aufgestellt werden',
                type: itemPreview.type,
            });
        }
        if (
            isGlobalFog
            && (typeof activateGlobalFog !== 'function' || canActivateGlobalFog?.() === false)
        ) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
                message: 'Nebel konnte nicht aktiviert werden',
                type: itemPreview.type,
            });
        }

        const inventoryBefore = isGlobalFog ? player.inventory.slice() : null;
        const selectedItemIndexBefore = player.selectedItemIndex;
        const itemResult = this.takeInventoryItem(player, preferredIndex, 'use');
        if (!itemResult.ok) return itemResult;
        if (isGlobalFog) {
            if (activateGlobalFog() !== true) {
                player.inventory.length = 0;
                player.inventory.push(...inventoryBefore);
                player.selectedItemIndex = selectedItemIndexBefore;
                return buildGameplayActionResult({
                    ok: false,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
                    message: 'Nebel konnte nicht aktiviert werden',
                    type: itemResult.type,
                });
            }
        } else if (itemResult.type === 'EMP') {
            applyEmpPulse({
                owner: player,
                players: this.runtime?.players,
                planar: config?.GAMEPLAY?.PLANAR_MODE === true,
            });
        } else if (!isTurret) {
            player.applyPowerup(itemResult.type);
        }
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

    shootItemProjectile(player, preferredIndex = -1, rocketOnly = false) {
        return this.runtime?.combat?.shootItemProjectile?.(player, preferredIndex, rocketOnly)
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

    // Item projectiles only ever lock enemy vehicles; the marker and the fired
    // projectile share this rule, while rockets and the MG keep checkLockOn.
    checkItemLockOn(player) {
        const runtime = this.runtime;
        if (!runtime || !player?.position || !Array.isArray(runtime.players)) return null;
        const direction = this._itemLockDirection;
        if (typeof player.getAimDirection === 'function') {
            player.getAimDirection(direction).normalize();
        } else {
            player.getDirection(direction).normalize();
        }
        const players = player?.isBot
            ? player?.entityManager?._globalFogEffectSystem?.filterVisiblePlayers?.(player, runtime.players) || runtime.players
            : runtime.players;
        return resolveItemProjectileTarget({
            owner: player,
            players,
            origin: player.position,
            direction,
            scratch: this._itemLockScratch,
        });
    }

    // The HUD marker follows the shot "use item" would fire: a selected attack
    // item shows its own vehicle lock, everything else the rocket/MG lock.
    resolveMarkerLockOn(player) {
        if (!player?.alive) return null;
        const selectedType = player.inventory?.[player.selectedItemIndex];
        return isItemProjectileType(selectedType) ? this.checkItemLockOn(player) : this.checkLockOn(player);
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
            // Without MG and rockets the only homing shots left are item projectiles.
            const itemTarget = this.checkItemLockOn(player);
            lockOnCache.set(player.index, itemTarget);
            return itemTarget;
        }

        const mg = resolveFightMachineGunConfig(
            config?.HUNT?.MG || {},
            player?.fightLoadout?.machineGunId
        );
        const visiblePlayers = player?.isBot
            ? player?.entityManager?._globalFogEffectSystem?.filterVisiblePlayers?.(player, runtime.players) || runtime.players
            : runtime.players;
        applyFightHumanAimAssist(player, visiblePlayers, tmpDir, mg, tmpVec);
        const muzzle = this._fallbackMuzzle;
        const muzzleOffset = Math.max(0, Number(config?.HUNT?.TARGETING?.MUZZLE_OFFSET || 2.1));
        muzzle.copy(player.position).addScaledVector(tmpDir, muzzleOffset);

        const configuredMgRange = Math.max(10, Number(mg.RANGE || 95));
        const fogRange = player?.isBot
            ? player?.entityManager?.getGlobalFogVisibilityRange?.()
            : Infinity;
        const mgRange = Math.min(
            configuredMgRange,
            Number.isFinite(fogRange) ? fogRange : configuredMgRange
        );
        const descriptor = resolveHuntLineTarget({
            sourcePlayer: player,
            players: visiblePlayers,
            trailSpatialIndex: runtime.getTrailSpatialIndex?.() || runtime.trails?.spatialIndex || null,
            origin: muzzle,
            direction: tmpDir,
            playerRange: mgRange,
            trailRange: mgRange,
            trailSampleStep: Number(mg.TRAIL_SAMPLE_STEP),
            trailHitRadius: Number(mg.TRAIL_HIT_RADIUS),
            trailSelfSkipRecent: Number(mg.TRAIL_SELF_SKIP_RECENT),
            allowSelfTrailFallback: false,
            preferPlayerTargets: true,
            runtimeProfiler: runtime?.services?.runtimeProfiler || runtime?.runtimeProfiler || null,
            targetingTelemetry: this._targetingTelemetry,
            scratch: this._targetingScratch,
        });

        lockOnCache.set(player.index, descriptor || null);
        return descriptor || null;
    }
}
