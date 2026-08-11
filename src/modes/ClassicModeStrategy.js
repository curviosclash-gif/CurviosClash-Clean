// ============================================
// ClassicModeStrategy.js - Classic mode (instant-kill, no HP system)
// ============================================

import { GameModeContract } from './GameModeContract.js';
import { isPickupTypeAllowedForMode, pickWeightedPickupType } from '../shared/contracts/PickupRegistryContract.js';
import { createRuntimeRng } from '../shared/contracts/RuntimeRngContract.js';
import { createRuntimeClock } from '../shared/contracts/RuntimeClockContract.js';

export class ClassicModeStrategy extends GameModeContract {
    constructor(options = {}) {
        super();
        this.runtimeRng = options?.runtimeRng && typeof options.runtimeRng.next === 'function'
            ? options.runtimeRng
            : createRuntimeRng({ random: options?.random });
        this._random = this.runtimeRng.next;
        this._nowMs = createRuntimeClock({ nowMs: options?.nowMs }).nowMs;
    }

    // Gleiche Schnittstelle wie ArcadeModeStrategy, damit die Runtime beiden
    // Strategien dieselbe Uhr unterschieben kann.
    setNowMsSource(nowMs) {
        if (typeof nowMs === 'function') this._nowMs = nowMs;
    }

    _nowSeconds() {
        return Math.max(0, Number(this._nowMs()) || 0) * 0.001;
    }

    get modeType() { return 'CLASSIC'; }

    // --- Lifecycle (V84 / 84.3.2) ---
    bootstrap(_context) { /* no mode-specific init required */ }
    cleanup(_context) { /* no mode-specific teardown required */ }

    computeRoundResult(players, context) {
        const alivePlayers = (players || []).filter((p) => p && p.alive);
        const winner = alivePlayers.length === 1 ? (alivePlayers[0].playerIndex ?? null) : null;
        return {
            modeType: this.modeType,
            winner,
            scores: {},
            roundIndex: context?.roundIndex ?? 0,
        };
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
            if (count > maxWins) {
                maxWins = count;
                winnerIndex = Number(idx);
            }
        }
        return { modeType: this.modeType, winnerIndex, roundResults: roundResults || [] };
    }

    // --- Health & Damage ---
    resetPlayerHealth(player) {
        if (!player) return null;
        player.maxHp = 1;
        player.hp = 1;
        player.maxShieldHp = 1;
        player.shieldHP = player.hasShield ? 1 : 0;
        player.lastDamageTimestamp = -Infinity;
        player.shieldHitFeedback = 0;
        return player;
    }

    applyDamage(player, amount, options) {
        if (!player) return { applied: 0, absorbedByShield: 0, remainingHp: 0, isDead: true };
        const requestedDamage = Math.max(0, Number(amount) || 0);
        if (requestedDamage <= 0) {
            return { applied: 0, absorbedByShield: 0, remainingHp: Math.max(0, Number(player.hp) || 0), isDead: (Number(player.hp) || 0) <= 0 };
        }
        player.maxHp = 1;
        player.hp = 0;
        player.shieldHP = 0;
        player.hasShield = false;
        player.lastDamageTimestamp = typeof options?.nowSeconds === 'number'
            ? options.nowSeconds
            : this._nowSeconds();
        return { applied: requestedDamage, absorbedByShield: 0, remainingHp: 0, isDead: true };
    }

    applyHealing(player) {
        if (!player) return { healed: 0, hp: 0 };
        player.maxHp = 1;
        player.hp = 1;
        return { healed: 1, hp: 1 };
    }

    resolveCollisionDamage() { return 1; }

    grantShield(player) {
        if (!player) return 0;
        player.hasShield = true;
        player.maxShieldHp = 1;
        player.shieldHP = 1;
        player.shieldHitFeedback = 0;
        return 1;
    }

    updateHealthRegen() { /* no-op in Classic */ }

    // --- Collision Response ---
    handleWallCollision(player, arenaCollision, entityManager) {
        if (player.hasShield) {
            if (entityManager.audio && !player.isBot) {
                entityManager.audio.play('SHIELD_HIT', { intensity: 1, depleted: true });
            }
            if (entityManager.particles) entityManager.particles.spawnHit(player.position, player.color);
            player.hasShield = false;
            player.getDirection(entityManager._tmpDir).multiplyScalar(2.2);
            player.position.sub(entityManager._tmpDir);
            return false;
        }
        if (entityManager.audio && !player.isBot) entityManager.audio.play('HIT');
        if (entityManager.particles) entityManager.particles.spawnHit(player.position, player.color);
        entityManager._killPlayer(player, 'WALL');
        return true;
    }

    handlePlayerCrash(player, otherPlayer, crashNormal, entityManager) {
        void crashNormal;
        // Classic has no health pool: a wall is lethal, so a head-on crash is too. The
        // shield absorbs it for whoever still carries one.
        const shieldedSelf = player.hasShield === true;
        const shieldedOther = otherPlayer.hasShield === true;
        // Blocks the mirrored check on otherPlayer later in this frame from resolving the
        // same crash a second time (relevant when a shield kept someone alive).
        const cooldown = this.resolveCollisionCooldown('PLAYER_CRASH');
        player.crashDamageCooldown = cooldown;
        otherPlayer.crashDamageCooldown = cooldown;
        if (entityManager.audio && (!player.isBot || !otherPlayer.isBot)) {
            entityManager.audio.play(shieldedSelf || shieldedOther ? 'SHIELD_HIT' : 'HIT');
        }
        if (entityManager.particles) entityManager.particles.spawnHit(player.position, player.color);

        if (shieldedOther) {
            otherPlayer.hasShield = false;
        } else {
            entityManager._killPlayer(otherPlayer, 'PLAYER_CRASH', { killer: player });
        }
        if (shieldedSelf) {
            player.hasShield = false;
            return false;
        }
        entityManager._killPlayer(player, 'PLAYER_CRASH', { killer: otherPlayer });
        return true;
    }

    handleTrailCollision(player, collision, trailCause, sourcePlayer, entityManager) {
        if (player.hasShield) {
            if (entityManager.audio && !player.isBot) {
                entityManager.audio.play('SHIELD_HIT', { intensity: 1, depleted: true });
            }
            if (entityManager.particles) entityManager.particles.spawnHit(player.position, player.color);
            player.hasShield = false;
            return false;
        }
        if (entityManager.audio && !player.isBot) entityManager.audio.play('HIT');
        if (entityManager.particles) entityManager.particles.spawnHit(player.position, player.color);
        entityManager._killPlayer(player, trailCause);
        return true;
    }

    // --- Actions ---
    requiresShootItemIndex() { return false; }
    hasMachineGun() { return false; }

    // --- Projectiles ---
    resolveRocketProjectileParams() { return null; }

    resolveProjectileHitOnPlayer(target, projectile, players, system) {
        if (target.hasShield) {
            target.hasShield = false;
        } else {
            target.applyPowerup(projectile.type, { sourcePlayerIndex: projectile.owner?.index });
            system?.onProjectilePowerup?.(target, projectile);
        }
    }

    // --- Spawning ---
    isRespawnEnabled() { return false; }

    filterSpawnableTypes(typeKeys, powerupTypes) {
        return typeKeys.filter((typeKey) => {
            const entry = powerupTypes[typeKey];
            if (!entry) return false;
            if (entry.huntOnly) return false;
            return isPickupTypeAllowedForMode(typeKey, this.modeType);
        });
    }

    resolveSpawnType(spawnableTypes, config, context = {}) {
        const candidates = context?.excludeType && spawnableTypes.length > 1
            ? spawnableTypes.filter((type) => type !== context.excludeType)
            : spawnableTypes;
        return pickWeightedPickupType(candidates, this.modeType, this._random, config?.POWERUP?.TYPES);
    }

    // --- Features ---
    hasScoring() { return false; }
    hasDamageEvents() { return false; }
    hasDestructibleTrails() { return false; }
    isHudVisible() { return false; }
}
