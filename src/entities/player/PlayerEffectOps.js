import { grantShield } from '../../hunt/HealthSystem.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { isPickupTypeAllowedForMode, getPickupDefinition } from '../PickupRegistry.js';

const SPEED_EFFECT_TYPES = Object.freeze(['SPEED_UP', 'SLOW_DOWN']);
const TRAIL_EFFECT_TYPES = Object.freeze(['THICK', 'THIN']);
const GLOBAL_TIME_EFFECT_TYPES = Object.freeze(['SLOW_TIME']);

function resolveModeType(player) {
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
    player.baseSpeed = Number.isFinite(speedMultiplier)
        ? playerConfig.SPEED * speedMultiplier
        : playerConfig.SPEED;
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

    // Global time: latest-wins, timeScale from registry (applied globally by PlanarAimAssistSystem)
    const slowTimeEffect = findLatestAllowedEffect(player, GLOBAL_TIME_EFFECT_TYPES, modeType);
    const slowTimeDef = slowTimeEffect ? getPickupDefinition(slowTimeEffect.type) : null;
    player.hasSlowTime = !!slowTimeEffect;
    player.slowTimeScale = Number.isFinite(slowTimeDef?.timeScale) ? slowTimeDef.timeScale : 1;

    // Shield: mode-specific - in HUNT expires by HP, in CLASSIC/ARCADE by timer
    const shieldEffectActive = hasAllowedEffect(player, 'SHIELD', modeType);
    if (!shieldEffectActive) {
        resetShieldState(player);
    } else if (modeType !== 'HUNT' && !player.hasShield) {
        grantShield(player, runtimeConfig);
    }
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

        effect.remaining -= dt;
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

export function applyPlayerPowerup(player, type) {
    if (!player) return;

    const definition = getPickupDefinition(type);
    if (!definition) return;

    const modeType = resolveModeType(player);
    if (!isPickupTypeAllowedForMode(type, modeType)) {
        return;
    }

    for (let i = player.activeEffects.length - 1; i >= 0; i -= 1) {
        if (player.activeEffects[i]?.type === type) {
            removeEffectAtIndex(player, i);
        }
    }

    player.activeEffects.push({
        type,
        remaining: Number.isFinite(definition.duration) ? definition.duration : 0,
    });

    if (type === 'SHIELD') {
        const runtimeConfig = resolveEntityRuntimeConfig(player);
        grantShield(player, runtimeConfig);
    }

    recomputePlayerEffectState(player);
}
