// ============================================
// ArcadeModeStrategy.js - Arcade mode (survival gauntlet, HP, scoring)
// Extends the shared game-mode contract with arcade-specific health,
// scoring and sector progression behaviour.
// ============================================

import { GameModeContract } from './GameModeContract.js';

const DEFAULT_MAX_HP = 100;
const DEFAULT_SHIELD_HP = 40;

function toSafe(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function nowSeconds() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now() * 0.001;
    }
    return Date.now() * 0.001;
}

// 61.4.1: Modifier effect constants
const MODIFIER_EFFECTS = Object.freeze({
    tight_turns: Object.freeze({ turnRateMultiplier: 0.7 }),
    heat_stress: Object.freeze({ hpDrainPerSecond: 2.5 }),
    portal_storm: Object.freeze({ spawnRateMultiplier: 2.0 }),
    boost_tax: Object.freeze({ boostHpCostPerSecond: 8.0 }),
});

const NULL_SLOT_BONUSES = Object.freeze({ turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 0 });

// 82.8.4: Max upgrade bonus per stat (+50%)
const UPGRADE_STAT_CAP_PCT = 50;

// 61.6.2: Incoming damage increase per stacked SD modifier (10% per stack)
const SD_DAMAGE_STACK_MULTIPLIER = 0.1;
// 61.6.2: Seconds between each additional stacked modifier in Sudden Death
const SD_MODIFIER_STACK_INTERVAL_S = 30;
const BASE_INTERMISSION_HEAL_PCT = 0.12;
const SD_INTERMISSION_HEAL_PCT = 0.04;

function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

// 82.1.1: Known sector types
export const ARCADE_SECTOR_TYPES = Object.freeze({
    ARENA: 'sector_arena',
    PARCOURS: 'sector_parcours',
});

export class ArcadeModeStrategy extends GameModeContract {
    constructor() {
        super();
        this._activeModifierId = null;
        this._slotBonuses = NULL_SLOT_BONUSES;
        this._roundScores = {};
        // 61.6.2: Sudden Death state
        this._sdActive = false;
        this._sdAccumulatedSeconds = 0;
        this._sdStackedModifiers = [];
        this._sdDamageMultiplier = 1.0;
        // 82.1.1: Current sector type (null = default arena)
        this._sectorType = null;
    }

    // --- Lifecycle (V84 / 84.3.2) ---
    bootstrap(_context) {
        this._resetRunTransientState();
    }

    cleanup(_context) {
        this._resetRunTransientState();
    }

    _resetRunTransientState() {
        this._roundScores = {};
        this.exitSuddenDeath();
        this.setActiveModifier(null);
        this.setSectorType(null);
        this.applyVehicleUpgrades(null);
    }

    /**
     * recordScore – accumulate a score delta for a player index during the run.
     * Called by Arcade-specific game logic (sectors, kills, survival ticks).
     */
    recordScore(playerIndex, delta) {
        const idx = Number(playerIndex);
        if (!Number.isFinite(idx)) return;
        this._roundScores[idx] = (this._roundScores[idx] || 0) + (Number.isFinite(delta) ? delta : 0);
    }

    computeRoundResult(players, context) {
        const scores = {};
        for (const p of (players || [])) {
            if (p && p.playerIndex != null) {
                const idx = p.playerIndex;
                scores[idx] = {
                    accumulatedScore: this._roundScores[idx] ?? 0,
                    alive: !!p.alive,
                    hp: toSafe(p.hp, 0),
                };
            }
        }
        // Arcade: highest accumulated score wins the round; ties prefer alive player.
        let winner = null;
        let best = -Infinity;
        for (const [idx, s] of Object.entries(scores)) {
            const effective = s.accumulatedScore + (s.alive ? 1000 : 0);
            if (effective > best) { best = effective; winner = Number(idx); }
        }
        return { modeType: this.modeType, winner, scores, roundIndex: context?.roundIndex ?? 0 };
    }

    computeMatchResult(players, roundResults, _context) {
        void players;
        // Arcade typically has a single run (no multi-round), aggregate total scores.
        const totalScores = {};
        for (const r of (roundResults || [])) {
            for (const [idx, s] of Object.entries(r?.scores || {})) {
                totalScores[idx] = (totalScores[idx] || 0) + (s?.accumulatedScore ?? 0);
            }
        }
        let winnerIndex = null;
        let maxScore = -Infinity;
        for (const [idx, score] of Object.entries(totalScores)) {
            if (score > maxScore) { maxScore = score; winnerIndex = Number(idx); }
        }
        return { modeType: this.modeType, winnerIndex, totalScores, roundResults: roundResults || [] };
    }

    // 61.8.1: Apply vehicle upgrade slot bonuses (turning, speed, max HP)
    applyVehicleUpgrades(bonuses) {
        if (!bonuses || typeof bonuses !== 'object') {
            this._slotBonuses = NULL_SLOT_BONUSES;
        } else {
            this._slotBonuses = Object.freeze({
                turningBonusPct: Number.isFinite(bonuses.turningBonusPct) ? bonuses.turningBonusPct : 0,
                speedBonusPct: Number.isFinite(bonuses.speedBonusPct) ? bonuses.speedBonusPct : 0,
                maxHpBonus: Number.isFinite(bonuses.maxHpBonus) ? bonuses.maxHpBonus : 0,
            });
        }
    }

    get modeType() { return 'ARCADE'; }

    // --- Sudden Death (61.6.2) ---

    /**
     * Activate Sudden Death mode. Disables healing and begins stacking modifiers.
     */
    enterSuddenDeath() {
        this._sdActive = true;
        this._sdAccumulatedSeconds = 0;
        this._sdStackedModifiers = [];
        this._sdDamageMultiplier = 1.0;
    }

    /**
     * Advance Sudden Death timer by dt seconds.
     * Every SD_MODIFIER_STACK_INTERVAL_S seconds a new modifier is stacked and
     * incoming damage multiplier increases by SD_DAMAGE_STACK_MULTIPLIER per stack.
     * Returns { addedModifiers, damageMultiplier } if new stacks were added, else null.
     */
    tickSuddenDeath(dt) {
        if (!this._sdActive) return null;
        this._sdAccumulatedSeconds += Math.max(0, toSafe(dt, 0));
        const targetStacks = Math.floor(this._sdAccumulatedSeconds / SD_MODIFIER_STACK_INTERVAL_S);
        const currentStacks = this._sdStackedModifiers.length;
        if (targetStacks <= currentStacks) return null;

        const modifierKeys = Object.keys(MODIFIER_EFFECTS);
        const addedModifiers = [];
        for (let i = currentStacks; i < targetStacks; i += 1) {
            addedModifiers.push(modifierKeys[i % modifierKeys.length]);
        }
        this._sdStackedModifiers = this._sdStackedModifiers.concat(addedModifiers);
        this._sdDamageMultiplier = 1.0 + this._sdStackedModifiers.length * SD_DAMAGE_STACK_MULTIPLIER;
        return { addedModifiers, damageMultiplier: this._sdDamageMultiplier };
    }

    exitSuddenDeath() {
        this._sdActive = false;
        this._sdAccumulatedSeconds = 0;
        this._sdStackedModifiers = [];
        this._sdDamageMultiplier = 1.0;
    }

    isSuddenDeathActive() { return this._sdActive; }

    getSuddenDeathState() {
        return {
            active: this._sdActive,
            stackedModifiers: [...this._sdStackedModifiers],
            damageMultiplier: this._sdDamageMultiplier,
            accumulatedSeconds: this._sdAccumulatedSeconds,
        };
    }

    // 82.1.1: Sector type — set by ArcadeRunRuntime when a sector begins
    setSectorType(sectorType) {
        this._sectorType = typeof sectorType === 'string' ? sectorType : null;
    }

    getSectorType() {
        return this._sectorType;
    }

    /** Returns true when the current sector is a parcours time-trial (no combat). */
    isSectorParcours() {
        return this._sectorType === ARCADE_SECTOR_TYPES.PARCOURS;
    }

    // 61.4.1: Active sector modifier
    setActiveModifier(modifierId) {
        this._activeModifierId = typeof modifierId === 'string' ? modifierId : null;
    }

    getActiveModifier() {
        return this._activeModifierId;
    }

    _getModifierEffect() {
        return this._activeModifierId ? (MODIFIER_EFFECTS[this._activeModifierId] || null) : null;
    }

    // 61.6.2: Aggregate effects from base modifier + all SD stacked modifiers
    _getAggregatedModifierEffects() {
        const base = this._getModifierEffect();
        const sdMods = this._sdActive ? this._sdStackedModifiers : [];
        if (!base && sdMods.length === 0) return null;

        const agg = {
            turnRateMultiplier: 1.0,
            hpDrainPerSecond: 0,
            spawnRateMultiplier: 1.0,
            boostHpCostPerSecond: 0,
        };

        const allEffects = base ? [base, ...sdMods.map((id) => MODIFIER_EFFECTS[id]).filter(Boolean)]
            : sdMods.map((id) => MODIFIER_EFFECTS[id]).filter(Boolean);

        for (const fx of allEffects) {
            if (fx.turnRateMultiplier != null) agg.turnRateMultiplier *= fx.turnRateMultiplier;
            if (fx.hpDrainPerSecond != null) agg.hpDrainPerSecond += fx.hpDrainPerSecond;
            if (fx.spawnRateMultiplier != null) agg.spawnRateMultiplier *= fx.spawnRateMultiplier;
            if (fx.boostHpCostPerSecond != null) agg.boostHpCostPerSecond += fx.boostHpCostPerSecond;
        }

        return agg;
    }

    // --- Health & Damage ---
    resetPlayerHealth(player) {
        if (!player) return null;
        // 61.8.1 / 82.8.4: T2 Core adds HP bonus, capped at +50% of base
        const hpBonus = Math.min(DEFAULT_MAX_HP * (UPGRADE_STAT_CAP_PCT / 100), Math.max(0, this._slotBonuses.maxHpBonus));
        player.maxHp = DEFAULT_MAX_HP + hpBonus;
        player.hp = player.maxHp;
        player.maxShieldHp = DEFAULT_SHIELD_HP;
        player.shieldHP = player.hasShield ? DEFAULT_SHIELD_HP : 0;
        player.lastDamageTimestamp = -Infinity;
        player.shieldHitFeedback = 0;
        return player;
    }

    applyDamage(player, amount, options) {
        if (!player) return { applied: 0, absorbedByShield: 0, remainingHp: 0, isDead: true };
        // 61.6.2: Scale incoming damage by SD damage multiplier
        const rawDmg = Math.max(0, toSafe(amount, 0));
        const dmg = this._sdActive ? rawDmg * this._sdDamageMultiplier : rawDmg;
        if (dmg <= 0) {
            return { applied: 0, absorbedByShield: 0, remainingHp: Math.max(0, toSafe(player.hp, 0)), isDead: toSafe(player.hp, 0) <= 0 };
        }

        let remaining = dmg;
        let absorbed = 0;
        if (!options?.ignoreShield && player.shieldHP > 0) {
            absorbed = Math.min(player.shieldHP, remaining);
            player.shieldHP = Math.max(0, player.shieldHP - absorbed);
            remaining -= absorbed;
            if (absorbed > 0) {
                const shieldMax = Math.max(1, player.maxShieldHp || DEFAULT_SHIELD_HP);
                player.shieldHitFeedback = Math.max(player.shieldHitFeedback || 0, Math.min(1, Math.max(0.2, absorbed / shieldMax)));
            }
            if (player.shieldHP <= 0) player.hasShield = false;
        }

        if (remaining > 0) {
            player.hp = Math.max(0, toSafe(player.hp, player.maxHp) - remaining);
            player.lastDamageTimestamp = toSafe(options?.nowSeconds, nowSeconds());
        }

        return { applied: dmg, absorbedByShield: absorbed, remainingHp: player.hp, isDead: player.hp <= 0 };
    }

    applyHealing(player, amount) {
        if (!player) return { healed: 0, hp: 0 };
        // 61.6.2: No healing in Sudden Death
        if (this._sdActive) return { healed: 0, hp: Math.max(0, toSafe(player.hp, 0)) };
        const heal = Math.max(0, toSafe(amount, 0));
        if (heal <= 0) return { healed: 0, hp: toSafe(player.hp, 0) };
        const maxHp = Math.max(1, toSafe(player.maxHp, DEFAULT_MAX_HP));
        const before = Math.max(0, toSafe(player.hp, maxHp));
        player.hp = Math.min(maxHp, before + heal);
        return { healed: player.hp - before, hp: player.hp };
    }

    // 68.3.3: Intermission healing with mission/reward scaling.
    applyIntermissionHealing(player, context = {}) {
        if (!player || !player.alive) {
            return { healed: 0, shieldGranted: 0, requestedHeal: 0 };
        }
        const maxHp = Math.max(1, toSafe(player.maxHp, DEFAULT_MAX_HP));
        const missionTotal = Math.max(0, toSafeInt(context.totalMissions, 0));
        const missionCompleted = Math.max(0, Math.min(missionTotal, toSafeInt(context.completedMissions, 0)));
        const missionRatio = missionTotal > 0 ? missionCompleted / missionTotal : 0;
        const rewardId = String(context.selectedRewardId || '').trim().toLowerCase();

        let healPct = this._sdActive ? SD_INTERMISSION_HEAL_PCT : BASE_INTERMISSION_HEAL_PCT;
        healPct += missionRatio * 0.08;
        if (rewardId === 'run_armor_t1') healPct += 0.16;
        if (rewardId === 'run_speed_t1') healPct += 0.08;
        if (rewardId === 'run_pickup_t1') healPct += 0.06;
        healPct = Math.max(0, Math.min(0.4, healPct));

        const requestedHeal = Math.max(0, Math.round(maxHp * healPct));
        const hpBefore = Math.max(0, toSafe(player.hp, maxHp));
        let healed = 0;
        if (this._sdActive) {
            player.hp = Math.min(maxHp, hpBefore + requestedHeal);
            healed = Math.max(0, player.hp - hpBefore);
        } else {
            const healResult = this.applyHealing(player, requestedHeal);
            healed = Math.max(0, toSafe(healResult.healed, 0));
        }

        let shieldGranted = 0;
        const spill = Math.max(0, requestedHeal - healed);
        if (spill > 0) {
            const shieldTopupFactor = rewardId === 'run_portal_t1' ? 1.0 : 0.5;
            const maxShield = Math.max(0, toSafe(player.maxShieldHp, DEFAULT_SHIELD_HP));
            const targetShield = Math.min(maxShield, Math.max(0, toSafe(player.shieldHP, 0)) + Math.round(spill * shieldTopupFactor));
            shieldGranted = Math.max(0, targetShield - Math.max(0, toSafe(player.shieldHP, 0)));
            if (shieldGranted > 0) {
                player.shieldHP = targetShield;
                player.hasShield = player.shieldHP > 0;
            }
        }

        return {
            healed,
            shieldGranted,
            requestedHeal,
        };
    }

    resolveCollisionDamage(cause) {
        const key = String(cause || '').toUpperCase();
        if (key === 'TRAIL' || key === 'TRAIL_SELF' || key === 'TRAIL_OTHER') return 34;
        if (key === 'PLAYER_CRASH') return 40;
        return 22;
    }

    grantShield(player) {
        if (!player) return 0;
        player.hasShield = true;
        player.maxShieldHp = DEFAULT_SHIELD_HP;
        player.shieldHP = DEFAULT_SHIELD_HP;
        player.shieldHitFeedback = 0;
        return player.shieldHP;
    }

    // 61.4.1: heat_stress drains HP over time; no natural regen in Arcade
    // 61.6.2: Also aggregates SD stacked modifier effects
    updateHealthRegen(player, dt) {
        if (!player || player.hp <= 0) return;
        const fx = this._getAggregatedModifierEffects();
        if (!fx || !fx.hpDrainPerSecond) return;
        const drain = fx.hpDrainPerSecond * Math.max(0, dt);
        if (drain <= 0) return;
        player.hp = Math.max(0, toSafe(player.hp, player.maxHp) - drain);
        if (player.hp <= 0) {
            player.lastDamageTimestamp = nowSeconds();
        }
    }

    // 61.4.1: boost_tax — drains HP while boosting
    // 61.6.2: Also aggregates SD stacked modifier effects
    applyBoostTick(player, dt) {
        if (!player || player.hp <= 0 || !player.isBoosting) return;
        const fx = this._getAggregatedModifierEffects();
        if (!fx || !fx.boostHpCostPerSecond) return;
        const cost = fx.boostHpCostPerSecond * Math.max(0, dt);
        if (cost <= 0) return;
        player.hp = Math.max(0, toSafe(player.hp, player.maxHp) - cost);
        if (player.hp <= 0) {
            player.lastDamageTimestamp = nowSeconds();
        }
    }

    // 61.4.1: tight_turns — multiplier applied to turn rate
    // 61.6.2: Also aggregates SD stacked modifier effects
    // 61.8.1: T2 Wing adds +10% turning on top of modifier; 82.8.4: capped at +50%
    getTurnRateMultiplier() {
        const fx = this._getAggregatedModifierEffects();
        const modifierMultiplier = (fx && fx.turnRateMultiplier) ? fx.turnRateMultiplier : 1.0;
        const cappedPct = Math.min(UPGRADE_STAT_CAP_PCT, this._slotBonuses.turningBonusPct);
        const upgradeMultiplier = 1.0 + (cappedPct / 100);
        return modifierMultiplier * upgradeMultiplier;
    }

    // 61.8.1: T2 Engine adds +8% speed; 82.8.4: capped at +50%
    getSpeedMultiplier() {
        const cappedPct = Math.min(UPGRADE_STAT_CAP_PCT, this._slotBonuses.speedBonusPct);
        return 1.0 + (cappedPct / 100);
    }

    // 82.8.1: Apply upgrade speed bonus to player base speed at spawn
    applySpawnStatBonuses(player) {
        if (!player) return;
        const speedMult = this.getSpeedMultiplier();
        if (speedMult > 1.0) {
            player.baseSpeed = player.baseSpeed * speedMult;
            player.speed = player.baseSpeed;
        }
    }

    // 61.4.1: portal_storm — multiplier for item/portal spawn frequency
    // 61.6.2: Also aggregates SD stacked modifier effects
    getSpawnRateMultiplier() {
        const fx = this._getAggregatedModifierEffects();
        return (fx && fx.spawnRateMultiplier) ? fx.spawnRateMultiplier : 1.0;
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
    requiresShootItemIndex() { return false; }
    hasMachineGun() { return false; }

    // --- Projectiles ---
    resolveRocketProjectileParams() { return null; }
    resolveProjectileHitOnPlayer(target, projectile, _players, system) {
        if (target.hasShield) {
            target.hasShield = false;
        } else {
            target.applyPowerup(projectile.type);
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
            return true;
        });
    }

    resolveSpawnType(spawnableTypes) {
        return spawnableTypes[Math.floor(Math.random() * spawnableTypes.length)];
    }

    // --- Features ---
    hasScoring() { return true; }
    hasDamageEvents() { return true; }
    hasDestructibleTrails() { return false; }
    isHudVisible() { return true; }
}
