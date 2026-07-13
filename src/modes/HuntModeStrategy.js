// ============================================
// HuntModeStrategy.js - Hunt mode (HP system, MG, rockets, respawn)
// ============================================

import { isRocketTierType, pickWeightedRocketTierType, resolveRocketTierDamage } from '../hunt/RocketPickupSystem.js';
import { isPickupTypeAllowedForMode, normalizePickupType } from '../entities/PickupRegistry.js';
import { GameModeContract } from './GameModeContract.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { createRuntimeRng } from '../shared/contracts/RuntimeRngContract.js';

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

const ENTITY_RUNTIME_CONFIG_SECTION_KEYS = Object.freeze([
    'PLAYER',
    'GAMEPLAY',
    'TRAIL',
    'POWERUP',
    'PROJECTILE',
    'HOMING',
    'HUNT',
    'BOT',
    'PORTAL',
    'ARENA',
    'COLORS',
    'MAPS',
    'runtimeConfig',
]);

function isDirectEntityRuntimeConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return ENTITY_RUNTIME_CONFIG_SECTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function resolveConfig(config, fallbackConfig = null) {
    if (isDirectEntityRuntimeConfig(config)) {
        return config;
    }
    const fallback = isDirectEntityRuntimeConfig(fallbackConfig)
        ? fallbackConfig
        : resolveEntityRuntimeConfig(fallbackConfig || null);
    return resolveEntityRuntimeConfig(config || null, fallback);
}

function pickWeightedType(typeEntries = [], random = Math.random) {
    const weighted = [];
    for (const entry of typeEntries) {
        const type = String(entry?.type || '').trim().toUpperCase();
        if (!type) continue;
        const rawWeight = Number(entry?.weight);
        weighted.push({
            type,
            weight: Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0,
        });
    }
    if (weighted.length === 0) return null;

    let totalWeight = 0;
    for (const entry of weighted) {
        totalWeight += entry.weight;
    }
    if (totalWeight <= 0) {
        return weighted[0].type;
    }

    const randomValue = Number.isFinite(Number(random())) ? Number(random()) : 0;
    let roll = Math.max(0, Math.min(0.999999, randomValue)) * totalWeight;
    for (const entry of weighted) {
        roll -= entry.weight;
        if (roll <= 0) return entry.type;
    }
    return weighted[weighted.length - 1]?.type || null;
}

export class HuntModeStrategy extends GameModeContract {
    constructor(options = {}) {
        super();
        this.entityRuntimeConfig = resolveEntityRuntimeConfig(options?.entityRuntimeConfig || null);
        const runtimeRng = options?.runtimeRng && typeof options.runtimeRng.next === 'function'
            ? options.runtimeRng
            : createRuntimeRng({
                seed: Number(options?.seed),
                random: typeof options?.random === 'function' ? options.random : Math.random,
            });
        this.runtimeRng = runtimeRng;
        this._random = typeof runtimeRng.next === 'function' ? runtimeRng.next.bind(runtimeRng) : Math.random;
    }

    get modeType() { return 'HUNT'; }

    // --- Lifecycle (V84 / 84.3.2) ---
    bootstrap(_context) { /* no mode-specific init required */ }
    cleanup(_context) { /* no mode-specific teardown required */ }

    computeRoundResult(players, context) {
        const alivePlayers = (players || []).filter((p) => p && p.alive);
        // Hunt: last alive wins; if multiple alive, pick by highest HP.
        let winner = null;
        if (alivePlayers.length === 1) {
            winner = alivePlayers[0].playerIndex ?? null;
        } else if (alivePlayers.length > 1) {
            let maxHp = -Infinity;
            for (const p of alivePlayers) {
                const hp = toSafeNumber(p.hp, 0);
                if (hp > maxHp) { maxHp = hp; winner = p.playerIndex ?? null; }
            }
        }
        const scores = {};
        for (const p of (players || [])) {
            if (p && p.playerIndex != null) {
                scores[p.playerIndex] = { kills: p.kills ?? 0, hp: toSafeNumber(p.hp, 0) };
            }
        }
        return { modeType: this.modeType, winner, scores, roundIndex: context?.roundIndex ?? 0 };
    }

    computeMatchResult(players, roundResults, context) {
        void players; void context;
        const wins = {};
        for (const r of (roundResults || [])) {
            if (r?.winner != null) {
                wins[r.winner] = (wins[r.winner] || 0) + 1;
            }
        }
        let winnerIndex = null;
        let maxWins = 0;
        for (const [idx, count] of Object.entries(wins)) {
            if (count > maxWins) { maxWins = count; winnerIndex = Number(idx); }
        }
        return { modeType: this.modeType, winnerIndex, roundResults: roundResults || [] };
    }

    // --- Health & Damage ---
    resetPlayerHealth(player, config) {
        if (!player) return null;
        const activeConfig = resolveConfig(config || player, this.entityRuntimeConfig);
        const maxHp = Math.max(1, toSafeNumber(activeConfig?.HUNT?.PLAYER_MAX_HP, 100));
        const maxShieldHp = Math.max(1, toSafeNumber(activeConfig?.HUNT?.SHIELD_MAX_HP, 40));
        player.maxHp = maxHp;
        player.hp = maxHp;
        player.maxShieldHp = maxShieldHp;
        player.shieldHP = player.hasShield ? maxShieldHp : 0;
        player.lastDamageTimestamp = -Infinity;
        player.shieldHitFeedback = 0;
        return player;
    }

    applyDamage(player, amount, options, config) {
        if (!player) return { applied: 0, absorbedByShield: 0, remainingHp: 0, isDead: true };
        const activeConfig = resolveConfig(config || player, this.entityRuntimeConfig);
        const requestedDamage = Math.max(0, toSafeNumber(amount, 0));
        if (requestedDamage <= 0) {
            return { applied: 0, absorbedByShield: 0, remainingHp: Math.max(0, toSafeNumber(player.hp, 0)), isDead: toSafeNumber(player.hp, 0) <= 0 };
        }

        let remainingDamage = requestedDamage;
        let absorbedByShield = 0;
        const ignoreShield = !!options?.ignoreShield;
        if (!ignoreShield && player.shieldHP > 0) {
            absorbedByShield = Math.min(player.shieldHP, remainingDamage);
            player.shieldHP = Math.max(0, player.shieldHP - absorbedByShield);
            remainingDamage -= absorbedByShield;
            if (absorbedByShield > 0) {
                const shieldMax = Math.max(1, player.maxShieldHp || toSafeNumber(activeConfig?.HUNT?.SHIELD_MAX_HP, 40));
                const feedbackValue = Math.min(1, Math.max(0.2, absorbedByShield / shieldMax));
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
            player.lastDamageTimestamp = toSafeNumber(options?.nowSeconds, getNowSeconds());
        }

        return { applied: requestedDamage, absorbedByShield, remainingHp: player.hp, isDead: player.hp <= 0 };
    }

    applyHealing(player, amount, config) {
        if (!player) return { healed: 0, hp: 0 };
        const activeConfig = resolveConfig(config || player, this.entityRuntimeConfig);
        const healing = Math.max(0, toSafeNumber(amount, 0));
        if (healing <= 0) return { healed: 0, hp: toSafeNumber(player.hp, 0) };
        const maxHp = Math.max(1, toSafeNumber(player.maxHp, toSafeNumber(activeConfig?.HUNT?.PLAYER_MAX_HP, 100)));
        const before = Math.max(0, toSafeNumber(player.hp, maxHp));
        player.hp = Math.min(maxHp, before + healing);
        return { healed: player.hp - before, hp: player.hp };
    }

    resolveCollisionDamage(cause, config) {
        const activeConfig = resolveConfig(config, this.entityRuntimeConfig);
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

    grantShield(player, config) {
        if (!player) return 0;
        const activeConfig = resolveConfig(config || player, this.entityRuntimeConfig);
        player.hasShield = true;
        player.maxShieldHp = Math.max(1, toSafeNumber(activeConfig?.HUNT?.SHIELD_MAX_HP, 40));
        player.shieldHP = player.maxShieldHp;
        player.shieldHitFeedback = 0;
        return player.shieldHP;
    }

    updateHealthRegen(player, dt, config, nowSeconds) {
        if (!player) return;
        const activeConfig = resolveConfig(config || player, this.entityRuntimeConfig);
        if (player.hp <= 0) return;
        const maxHp = Math.max(1, toSafeNumber(player.maxHp, toSafeNumber(activeConfig?.HUNT?.PLAYER_MAX_HP, 100)));
        if (player.hp >= maxHp) return;
        const regenDelay = Math.max(0, toSafeNumber(activeConfig?.HUNT?.PLAYER_REGEN_DELAY, 3.0));
        const now = toSafeNumber(nowSeconds, getNowSeconds());
        const lastDamageTimestamp = toSafeNumber(player.lastDamageTimestamp, -Infinity);
        if ((now - lastDamageTimestamp) < regenDelay) return;
        const regenPerSecond = Math.max(0, toSafeNumber(activeConfig?.HUNT?.PLAYER_REGEN_PER_SECOND, 2.5));
        if (regenPerSecond <= 0) return;
        player.hp = Math.min(maxHp, player.hp + regenPerSecond * Math.max(0, dt));
    }

    // --- Collision Response ---
    handleWallCollision(player, arenaCollision, entityManager) {
        const wallDamage = this.resolveCollisionDamage('WALL');
        const damageResult = player.takeDamage(wallDamage);
        entityManager._emitHuntDamageEvent({
            target: player,
            sourcePlayer: null,
            cause: 'WALL',
            hitNormal: arenaCollision.normal || null,
            damageResult,
            impactPoint: player.position,
        });
        if (damageResult.isDead) {
            entityManager._killPlayer(player, 'WALL');
            return true;
        }
        return false;
    }

    handleTrailCollision(player, collision, trailCause, sourcePlayer, entityManager) {
        const damageResult = player.takeDamage(this.resolveCollisionDamage('TRAIL'));
        entityManager._emitHuntDamageEvent({
            target: player,
            sourcePlayer,
            cause: trailCause,
            damageResult,
            impactPoint: player.position,
        });
        if (damageResult.isDead) {
            entityManager._killPlayer(player, trailCause, { killer: sourcePlayer || null });
            return true;
        }
        return false;
    }

    // --- Actions ---
    requiresShootItemIndex() { return true; }
    hasMachineGun() { return true; }

    // --- Projectiles ---
    resolveRocketProjectileParams(type, config) {
        if (!isRocketTierType(type)) return null;
        const activeConfig = resolveConfig(config, this.entityRuntimeConfig);
        const rocketConfig = activeConfig?.HUNT?.ROCKET || {};
        const normalized = String(type || '').toUpperCase();

        const visualScaleMap = {
            ROCKET_MEGA: rocketConfig.VISUAL_SCALE_MEGA || 2.6,
            ROCKET_HEAVY: rocketConfig.VISUAL_SCALE_HEAVY || 2.2,
            ROCKET_MEDIUM: rocketConfig.VISUAL_SCALE_MEDIUM || 1.95,
            ROCKET_WEAK: rocketConfig.VISUAL_SCALE_WEAK || 1.7,
        };

        return {
            visualScale: Math.max(1, Number(visualScaleMap[normalized] || 1)),
            collisionRadiusMultiplier: Math.max(1, Number(rocketConfig.COLLISION_RADIUS_MULTIPLIER || 1.65)),
            homingTurnRate: Math.max(0.1, Number(rocketConfig.HOMING_TURN_RATE || 6.2)),
            homingLockOnAngle: Math.max(5, Number(rocketConfig.HOMING_LOCK_ON_ANGLE || 32)),
            homingRange: Math.max(10, Number(rocketConfig.HOMING_RANGE || 130)),
            homingReacquireInterval: Math.max(0.04, Number(rocketConfig.HOMING_REACQUIRE_INTERVAL || 0.12)),
        };
    }

    resolveProjectileHitOnPlayer(target, projectile, players, system) {
        const damage = resolveRocketTierDamage(projectile.type, this.entityRuntimeConfig);
        const damageResult = target.takeDamage(damage);
        system?.onProjectilePowerup?.(target, projectile);
        system?.onProjectileDamage?.(target, projectile.owner, projectile.type, damageResult, projectile);
        this._applyRocketExplosion(projectile, players, target, system);
    }

    _applyRocketExplosion(projectile, players, directHitTarget, system) {
        const rocketConfig = resolveConfig(null, this.entityRuntimeConfig)?.HUNT?.ROCKET || {};
        const explosionRadius = Math.max(1, Number(rocketConfig.EXPLOSION_RADIUS || 25));
        const explosionDamageFalloff = Math.max(0, Math.min(1, Number(rocketConfig.EXPLOSION_DAMAGE_FALLOFF || 0.5)));
        const baseDamage = resolveRocketTierDamage(projectile.type, this.entityRuntimeConfig);
        const damageAtCenter = baseDamage * (1 + explosionDamageFalloff);

        for (const target of players || []) {
            if (!target.alive || target === projectile.owner || target === directHitTarget) continue;
            const distanceToTarget = target.position.distanceTo(projectile.position);
            if (distanceToTarget > explosionRadius) continue;
            const damageFalloff = 1 - (distanceToTarget / explosionRadius) * explosionDamageFalloff;
            const explosionDamage = Math.max(1, Math.floor(damageAtCenter * damageFalloff));
            const damageResult = target.takeDamage(explosionDamage);
            system?.onProjectileDamage?.(target, projectile.owner, projectile.type, damageResult, projectile);
        }
    }

    // --- Spawning ---
    isRespawnEnabled(config) {
        const activeConfig = resolveConfig(config, this.entityRuntimeConfig);
        return !!activeConfig?.HUNT?.RESPAWN_ENABLED;
    }

    filterSpawnableTypes(typeKeys, powerupTypes) {
        return typeKeys.filter((typeKey) => {
            const normalizedType = normalizePickupType(typeKey, { fallback: typeKey });
            const entry = powerupTypes[normalizedType];
            if (!entry) return false;
            if (entry.classicOnly) return false;
            return isPickupTypeAllowedForMode(normalizedType, this.modeType);
        });
    }

    resolveSpawnType(spawnableTypes, config) {
        const activeConfig = resolveConfig(config, this.entityRuntimeConfig);
        const rocketSpawnChance = Math.max(0, Math.min(1, Number(activeConfig?.HUNT?.ROCKET_PICKUP_SPAWN_CHANCE || 0)));
        const huntWeights = activeConfig?.HUNT?.PICKUP_WEIGHTS || {};
        const normalizedSpawnableTypes = Array.isArray(spawnableTypes)
            ? spawnableTypes.map((type) => String(type || '').trim().toUpperCase()).filter((type) => !!type)
            : [];

        const nonRocketTypes = normalizedSpawnableTypes.filter((type) => !isRocketTierType(type));
        const weightedNonRocketTypes = nonRocketTypes
            .map((typeKey) => ({
                type: typeKey,
                weight: Number.isFinite(Number(huntWeights?.[typeKey]))
                    ? Math.max(0, Number(huntWeights?.[typeKey]))
                    : 1,
            }));

        if (this._random() < rocketSpawnChance) {
            const weightedRocketType = pickWeightedRocketTierType({
                allowedTypes: normalizedSpawnableTypes,
                tiersConfig: activeConfig?.HUNT?.ROCKET_TIERS || null,
                random: this._random,
            });
            if (weightedRocketType && (normalizedSpawnableTypes.includes(weightedRocketType) || isRocketTierType(weightedRocketType))) {
                return weightedRocketType;
            }
        }

        if (weightedNonRocketTypes.length > 0) {
            return pickWeightedType(weightedNonRocketTypes, this._random) || nonRocketTypes[0];
        }
        if (nonRocketTypes.length > 0) {
            return nonRocketTypes[0];
        }
        return normalizedSpawnableTypes[0] || null;
    }

    // --- Features ---
    hasScoring() { return true; }
    hasDamageEvents() { return true; }
    hasDestructibleTrails() { return true; }
    isHudVisible() { return true; }
}
