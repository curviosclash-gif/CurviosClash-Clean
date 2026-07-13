import { GAME_MODE_TYPES, isHuntMode } from './HuntMode.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';

function toSafeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getNowSeconds() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now() * 0.001;
    }
    return Date.now() * 0.001;
}

function resolveConfig(config = null, source = null) {
    return resolveEntityRuntimeConfig(config || source || null);
}

function getActiveMode(config = null) {
    const activeConfig = resolveConfig(config);
    return String(activeConfig?.HUNT?.ACTIVE_MODE || activeConfig?.HUNT?.DEFAULT_MODE || GAME_MODE_TYPES.CLASSIC).toUpperCase();
}

/** @deprecated Use gameModeStrategy instead (V47 Strategy Pattern). */
export function isHuntHealthActive(config = null) {
    const activeConfig = resolveConfig(config);
    const enabled = activeConfig?.HUNT?.ENABLED !== false;
    return enabled && isHuntMode(getActiveMode(activeConfig), enabled);
}

export function getPlayerMaxHp(config = null) {
    const activeConfig = resolveConfig(config);
    return Math.max(1, toSafeNumber(activeConfig?.HUNT?.PLAYER_MAX_HP, 100));
}

export function getShieldMaxHp(config = null) {
    const activeConfig = resolveConfig(config);
    return Math.max(1, toSafeNumber(activeConfig?.HUNT?.SHIELD_MAX_HP, 40));
}

export function resetPlayerHealth(player, config = null) {
    const activeConfig = resolveConfig(config, player);
    if (!player) return null;

    if (!isHuntHealthActive(activeConfig)) {
        player.maxHp = 1;
        player.hp = 1;
        player.maxShieldHp = 1;
        player.shieldHP = player.hasShield ? 1 : 0;
        player.lastDamageTimestamp = -Infinity;
        player.shieldHitFeedback = 0;
        return player;
    }

    const maxHp = getPlayerMaxHp(activeConfig);
    player.maxHp = maxHp;
    player.hp = maxHp;
    player.maxShieldHp = getShieldMaxHp(activeConfig);
    if (player.hasShield) {
        player.shieldHP = player.maxShieldHp;
    } else {
        player.shieldHP = 0;
    }
    player.lastDamageTimestamp = -Infinity;
    player.shieldHitFeedback = 0;
    return player;
}

export function applyDamage(player, amount, options = {}, config = null) {
    const activeConfig = resolveConfig(config, player);
    if (!player) {
        return {
            applied: 0,
            absorbedByShield: 0,
            hpApplied: 0,
            remainingHp: 0,
            isDead: true,
        };
    }
    const hpBefore = Math.max(0, toSafeNumber(player.hp, 0));

    const requestedDamage = Math.max(0, toSafeNumber(amount, 0));
    if (requestedDamage <= 0) {
        return {
            applied: 0,
            absorbedByShield: 0,
            hpApplied: 0,
            remainingHp: Math.max(0, toSafeNumber(player.hp, 0)),
            isDead: toSafeNumber(player.hp, 0) <= 0,
        };
    }

    if (!isHuntHealthActive(activeConfig)) {
        player.maxHp = 1;
        player.hp = 0;
        player.shieldHP = 0;
        player.hasShield = false;
        player.lastDamageTimestamp = toSafeNumber(options.nowSeconds, getNowSeconds());
        return {
            applied: requestedDamage,
            absorbedByShield: 0,
            hpApplied: Math.max(0, hpBefore - Math.max(0, toSafeNumber(player.hp, 0))),
            remainingHp: 0,
            isDead: true,
        };
    }

    let remainingDamage = requestedDamage;
    let absorbedByShield = 0;
    const ignoreShield = !!options.ignoreShield;
    if (!ignoreShield && player.shieldHP > 0) {
        absorbedByShield = Math.min(player.shieldHP, remainingDamage);
        player.shieldHP = Math.max(0, player.shieldHP - absorbedByShield);
        remainingDamage -= absorbedByShield;
        if (absorbedByShield > 0) {
            const feedbackValue = Math.min(1, Math.max(0.2, absorbedByShield / Math.max(1, player.maxShieldHp || getShieldMaxHp(activeConfig))));
            player.shieldHitFeedback = Math.max(player.shieldHitFeedback || 0, feedbackValue);
        }
        if (player.shieldHP <= 0) {
            player.hasShield = false;
        }
    }

    const damageContact = absorbedByShield > 0 || remainingDamage > 0;
    if (remainingDamage > 0) {
        player.hp = Math.max(0, toSafeNumber(player.hp, player.maxHp) - remainingDamage);
    }
    if (damageContact) {
        player.lastDamageTimestamp = toSafeNumber(options.nowSeconds, getNowSeconds());
    }

    const hpApplied = Math.max(0, hpBefore - Math.max(0, toSafeNumber(player.hp, 0)));
    return {
        applied: requestedDamage,
        absorbedByShield,
        hpApplied,
        remainingHp: player.hp,
        isDead: player.hp <= 0,
    };
}

export function applyHealing(player, amount, config = null) {
    const activeConfig = resolveConfig(config, player);
    if (!player) return { healed: 0, hp: 0 };
    const healing = Math.max(0, toSafeNumber(amount, 0));
    if (healing <= 0) {
        return { healed: 0, hp: toSafeNumber(player.hp, 0) };
    }

    if (!isHuntHealthActive(activeConfig)) {
        player.maxHp = 1;
        player.hp = 1;
        return { healed: 1, hp: 1 };
    }

    const maxHp = Math.max(1, toSafeNumber(player.maxHp, getPlayerMaxHp(activeConfig)));
    const before = Math.max(0, toSafeNumber(player.hp, maxHp));
    player.hp = Math.min(maxHp, before + healing);
    return { healed: player.hp - before, hp: player.hp };
}

export function updatePlayerHealthRegen(player, dt, config = null, nowSeconds = getNowSeconds()) {
    const activeConfig = resolveConfig(config, player);
    if (!player || !isHuntHealthActive(activeConfig)) return;
    if (player.hp <= 0) return;

    const maxHp = Math.max(1, toSafeNumber(player.maxHp, getPlayerMaxHp(activeConfig)));
    if (player.hp >= maxHp) return;

    const regenDelay = Math.max(0, toSafeNumber(activeConfig?.HUNT?.PLAYER_REGEN_DELAY, 3.0));
    const lastDamageTimestamp = toSafeNumber(player.lastDamageTimestamp, -Infinity);
    if ((nowSeconds - lastDamageTimestamp) < regenDelay) return;

    const regenPerSecond = Math.max(0, toSafeNumber(activeConfig?.HUNT?.PLAYER_REGEN_PER_SECOND, 2.5));
    if (regenPerSecond <= 0) return;

    player.hp = Math.min(maxHp, player.hp + regenPerSecond * Math.max(0, dt));
}

export function resolveCollisionDamage(cause = 'WALL', config = null) {
    const activeConfig = resolveConfig(config);
    if (!isHuntHealthActive(activeConfig)) {
        return 1;
    }

    const table = activeConfig?.HUNT?.COLLISION_DAMAGE || {};
    const key = String(cause || '').toUpperCase();
    if (key === 'TRAIL' || key === 'TRAIL_SELF' || key === 'TRAIL_OTHER') {
        return Math.max(1, toSafeNumber(table.TRAIL, 34));
    }
    if (key === 'PLAYER_CRASH') {
        return Math.max(1, toSafeNumber(table.PLAYER_CRASH, 40));
    }
    return Math.max(1, toSafeNumber(table.WALL, 22));
}

export function grantShield(player, config = null) {
    const activeConfig = resolveConfig(config, player);
    if (!player) return 0;
    player.hasShield = true;
    if (!isHuntHealthActive(activeConfig)) {
        player.maxShieldHp = 1;
        player.shieldHP = 1;
        player.shieldHitFeedback = 0;
        return player.shieldHP;
    }
    player.maxShieldHp = getShieldMaxHp(activeConfig);
    player.shieldHP = player.maxShieldHp;
    player.shieldHitFeedback = 0;
    return player.shieldHP;
}
