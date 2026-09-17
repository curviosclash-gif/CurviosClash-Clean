import { applyHealing, grantShield } from '../../hunt/HealthSystem.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { isPickupTypeAllowedForMode, getPickupDefinition } from '../PickupRegistry.js';
import { resolveGlobalTimeScale } from './PlayerChargeOps.js';

const SPEED_EFFECT_TYPES = Object.freeze(['SPEED_UP', 'SLOW_DOWN']);
const TRAIL_EFFECT_TYPES = Object.freeze(['THICK', 'THIN']);
const GLOBAL_TIME_EFFECT_TYPES = Object.freeze(['SLOW_TIME']);
const FLAMETHROWER_EFFECT_TYPES = Object.freeze(['FLAMETHROWER']);
const FUEL_EMPTY_SECONDS = 0.000001;

function resolveFlamethrowerFuelSeconds(player) {
    const configured = Number(resolveEntityRuntimeConfig(player)?.HUNT?.FLAMETHROWER?.FUEL_SECONDS);
    return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

function removeEffectsByRole(player, role) {
    for (let i = player.activeEffects.length - 1; i >= 0; i -= 1) {
        if (getPickupDefinition(player.activeEffects[i]?.type)?.actionRole === role) {
            removeEffectAtIndex(player, i);
        }
    }
}

function resolveModeType(player) {
    const strategyMode = player?.entityManager?.gameModeStrategy?.getPickupModeType?.();
    if (strategyMode) return String(strategyMode).trim().toUpperCase();
    const config = resolveEntityRuntimeConfig(player);
    const enabled = config?.HUNT?.ENABLED !== false;
    const activeMode = String(config?.HUNT?.ACTIVE_MODE || config?.HUNT?.DEFAULT_MODE || 'CLASSIC').trim().toUpperCase();
    if (!enabled && activeMode === 'HUNT') {
        return 'CLASSIC';
    }
    return activeMode || 'CLASSIC';
}

function findLatestAllowedEffect(player, effectTypes = [], modeType = 'CLASSIC') {
    const activeEffects = Array.isArray(player?.activeEffects) ? player.activeEffects : [];
    for (let i = activeEffects.length - 1; i >= 0; i -= 1) {
        const effect = activeEffects[i];
        if (!effectTypes.includes(effect?.type)) continue;
        if (!isPickupTypeAllowedForMode(effect.type, modeType)) continue;
        return effect;
    }
    return null;
}

function hasAllowedEffect(player, type, modeType = 'CLASSIC') {
    const activeEffects = Array.isArray(player?.activeEffects) ? player.activeEffects : [];
    for (let i = 0; i < activeEffects.length; i += 1) {
        const effect = activeEffects[i];
        if (effect?.type !== type) continue;
        if (!isPickupTypeAllowedForMode(type, modeType)) continue;
        return true;
    }
    return false;
}

function removeEffectAtIndex(player, index) {
    if (!player || !Array.isArray(player.activeEffects)) return;
    if (index < 0 || index >= player.activeEffects.length) return;
    player.activeEffects.splice(index, 1);
}

function resetShieldState(player) {
    player.hasShield = false;
    player.shieldHP = 0;
    player.shieldHitFeedback = 0;
}

export function recomputePlayerEffectState(player) {
    if (!player) return;

    const modeType = resolveModeType(player);
    const runtimeConfig = resolveEntityRuntimeConfig(player);
    const playerConfig = resolveGameplayConfig(player).PLAYER;

    // Speed: latest-wins among SPEED_UP/SLOW_DOWN, multiplier from registry
    const speedEffect = findLatestAllowedEffect(player, SPEED_EFFECT_TYPES, modeType);
    const speedDef = speedEffect ? getPickupDefinition(speedEffect.type) : null;
    const speedMultiplier = Number(speedDef?.multiplier);
    if (Number.isFinite(speedMultiplier)) {
        if (!Number.isFinite(player._speedEffectBaseSpeed)) {
            const currentBaseSpeed = Number(player.baseSpeed);
            player._speedEffectBaseSpeed = Number.isFinite(currentBaseSpeed)
                ? currentBaseSpeed
                : playerConfig.SPEED;
        }
        player.baseSpeed = player._speedEffectBaseSpeed * speedMultiplier;
    } else {
        if (Number.isFinite(player._speedEffectBaseSpeed)) {
            player.baseSpeed = player._speedEffectBaseSpeed;
        } else if (!Number.isFinite(Number(player.baseSpeed))) {
            player.baseSpeed = playerConfig.SPEED;
        }
        player._speedEffectBaseSpeed = null;
    }
    player.speed = player.baseSpeed;

    // Trail: latest-wins among THICK/THIN, trailWidth from registry
    const trailEffect = findLatestAllowedEffect(player, TRAIL_EFFECT_TYPES, modeType);
    const trailDef = trailEffect ? getPickupDefinition(trailEffect.type) : null;
    const trailWidth = Number(trailDef?.trailWidth);
    if (player.trail) {
        if (Number.isFinite(trailWidth) && trailWidth > 0) {
            player.trail.setWidth(trailWidth);
        } else {
            player.trail.resetWidth();
        }
    }

    // Boolean effects: any-active-wins, mode-filtered
    player.isGhost = hasAllowedEffect(player, 'GHOST', modeType);
    player.invertControls = hasAllowedEffect(player, 'INVERT', modeType);
    player.trailGapActive = hasAllowedEffect(player, 'TRAIL_GAP', modeType);
    player.decoyActive = hasAllowedEffect(player, 'DECOY', modeType);
    player.itemActionsDisabled = hasAllowedEffect(player, 'EMP', modeType);
    const magnetDefinition = getPickupDefinition('MAGNET');
    player.pickupRadiusMultiplier = hasAllowedEffect(player, 'MAGNET', modeType)
        ? Math.max(1, Number(magnetDefinition?.pickupRadiusMultiplier) || 1)
        : 1;

    // Global time: latest-wins, timeScale from registry (applied globally by PlanarAimAssistSystem)
    const slowTimeEffect = findLatestAllowedEffect(player, GLOBAL_TIME_EFFECT_TYPES, modeType);
    const slowTimeDef = slowTimeEffect ? getPickupDefinition(slowTimeEffect.type) : null;
    player.hasSlowTime = !!slowTimeEffect;
    player.slowTimeScale = Number.isFinite(slowTimeDef?.timeScale) ? slowTimeDef.timeScale : 1;
    player.slowTimeExemptsOwner = !!slowTimeEffect && slowTimeDef?.timeScaleExemptsOwner === true;

    // Flamethrower tank: the fuel lives on the effect entry, so every activeEffects reset
    // (death, respawn, round restart) empties the tank without a second bookkeeping site.
    // S4.2 drains effect.fuelSeconds while the machine gun key is held.
    const flameEffect = findLatestAllowedEffect(player, FLAMETHROWER_EFFECT_TYPES, modeType);
    player.flameFuelSeconds = flameEffect ? Math.max(0, Number(flameEffect.fuelSeconds) || 0) : 0;
    player.hasFlamethrower = !!flameEffect && player.flameFuelSeconds > 0;

    // Shield: mode-specific - in HUNT expires by HP, in CLASSIC/ARCADE by timer
    const shieldEffectActive = hasAllowedEffect(player, 'SHIELD', modeType);
    if (shieldEffectActive) {
        player._pickupShieldOwned = true;
        if (modeType !== 'HUNT' && !player.hasShield) {
            grantShield(player, runtimeConfig);
        }
    } else if (player._pickupShieldOwned === true) {
        resetShieldState(player);
        player._pickupShieldOwned = false;
    }
}

/**
 * Burns tank fuel for one tick and answers the seconds the tank could actually deliver, so the
 * cone damage of a tick never outlives the fuel that paid for it. An empty tank ends the effect
 * through the normal removal path, which also clears player.hasFlamethrower.
 */
export function consumeFlamethrowerFuel(player, seconds) {
    const requested = Math.max(0, Number(seconds) || 0);
    if (!player || requested <= 0) return 0;
    const effect = findLatestAllowedEffect(player, FLAMETHROWER_EFFECT_TYPES, resolveModeType(player));
    const fuel = Math.max(0, Number(effect?.fuelSeconds) || 0);
    if (!effect || fuel <= 0) return 0;

    const consumed = Math.min(requested, fuel);
    // Summing 1/60 second steps never lands exactly on zero, so a leftover far below one frame
    // counts as empty instead of keeping a spent effect alive.
    effect.fuelSeconds = fuel - consumed <= FUEL_EMPTY_SECONDS ? 0 : fuel - consumed;
    player.flameFuelSeconds = effect.fuelSeconds;
    if (effect.fuelSeconds <= 0) removePlayerEffect(player, effect);
    return consumed;
}

export function removePlayerEffect(player, effect) {
    if (!player || !effect || !Array.isArray(player.activeEffects)) return;
    const index = player.activeEffects.indexOf(effect);
    if (index >= 0) {
        removeEffectAtIndex(player, index);
    }
    recomputePlayerEffectState(player);
}

export function updatePlayerEffects(player, dt) {
    if (!player) return;

    const modeType = resolveModeType(player);
    // Powerup timers count real seconds, so they are divided by the same global clock
    // factor the loop runs on. This deliberately includes the slow-motion key: a five
    // second shield stays five real seconds whether or not somebody slowed the clock,
    // exactly as the SLOW_TIME powerup already behaved.
    const effectDt = Math.max(0, Number(dt) || 0) / resolveGlobalTimeScale(player);
    for (let i = player.activeEffects.length - 1; i >= 0; i -= 1) {
        const effect = player.activeEffects[i];
        if (!effect || !isPickupTypeAllowedForMode(effect.type, modeType)) {
            removeEffectAtIndex(player, i);
            continue;
        }

        if (effect.type === 'SHIELD') {
            // Shield contract per mode:
            //   HUNT:          HP-based expiry only (no timer), shield removed when shieldHP <= 0
            //   CLASSIC/ARCADE: timer-based expiry (duration from registry), shields block trail collision
            const shieldActive = !!player.hasShield && (Number(player.shieldHP) || 0) > 0;
            if (!shieldActive) {
                removeEffectAtIndex(player, i);
                continue;
            }
            if (modeType === 'HUNT') {
                continue;
            }
        }

        effect.remaining -= effectDt;
        if (effect.remaining <= 0) {
            removeEffectAtIndex(player, i);
        }
    }

    recomputePlayerEffectState(player);

    if (player.boostPortalTimer > 0) {
        player.boostPortalTimer -= dt;
        if (player.boostPortalTimer <= 0) {
            player.boostPortalParams = null;
        }
    }
    if (player.slingshotTimer > 0) {
        player.slingshotTimer -= dt;
        if (player.slingshotTimer <= 0) {
            player.slingshotParams = null;
        }
    }
}

export function applyPlayerPowerup(player, type, options = {}) {
    if (!player) return;

    const definition = getPickupDefinition(type);
    if (!definition) return;

    const modeType = resolveModeType(player);
    if (!isPickupTypeAllowedForMode(type, modeType)) {
        return;
    }

    if (type === 'HEALTH') {
        const runtimeConfig = resolveEntityRuntimeConfig(player);
        const strategy = player.entityManager?.gameModeStrategy || null;
        const healing = Number(definition.healing) || 0;
        const healResult = typeof strategy?.applyHealing === 'function'
            ? strategy.applyHealing(player, healing, runtimeConfig)
            : applyHealing(player, healing, runtimeConfig);
        if (healResult.healed > 0) {
            player.entityManager?._emitArcadeGameplayEvent?.({
                type: 'health_update',
                playerIndex: player.index,
                hp: player.hp,
                maxHp: player.maxHp,
            });
        }
        return;
    }

    if (type === 'PURGE') {
        removeEffectsByRole(player, 'debuff');
        recomputePlayerEffectState(player);
        return;
    }

    if (type === 'MINE') {
        player.entityManager?._projectileSystem?.deployMine?.(player);
        return;
    }

    if (type === 'EMP') {
        removeEffectsByRole(player, 'buff');
        resetShieldState(player);
        player._pickupShieldOwned = false;
    }

    const effectCategory = String(definition.effectCategory || '');
    for (let i = player.activeEffects.length - 1; i >= 0; i -= 1) {
        const activeDefinition = getPickupDefinition(player.activeEffects[i]?.type);
        const sameType = player.activeEffects[i]?.type === type;
        const sameReplaceCategory = definition.stackPolicy === 'replace-category'
            && effectCategory
            && activeDefinition?.effectCategory === effectCategory;
        const sameTypeReplaces = sameType && definition.stackPolicy !== 'add-instance';
        if (sameTypeReplaces || sameReplaceCategory) {
            removeEffectAtIndex(player, i);
        }
    }

    player.activeEffects.push({
        type,
        remaining: Number.isFinite(definition.duration) ? definition.duration : 0,
        sourcePlayerIndex: Number.isInteger(options?.sourcePlayerIndex)
            ? options.sourcePlayerIndex
            : null,
    });

    if (type === 'SHIELD') {
        const runtimeConfig = resolveEntityRuntimeConfig(player);
        player._pickupShieldOwned = true;
        grantShield(player, runtimeConfig);
    }

    if (type === 'FLAMETHROWER') {
        player.activeEffects[player.activeEffects.length - 1].fuelSeconds = resolveFlamethrowerFuelSeconds(player);
    }

    recomputePlayerEffectState(player);
}
