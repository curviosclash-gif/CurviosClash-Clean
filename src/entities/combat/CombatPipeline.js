import { areTeammates, canDamage } from '../../shared/contracts/TeamCombatContract.js';
import { normalizeCombatHealInput, normalizeCombatHitInput } from '../../shared/contracts/CombatHitContract.js';

const PLAYER_CRASH_CAUSE = 'PLAYER_CRASH';

function resolveEntityManager(world) {
    return world?.entityManager || world?.runtime?.entityManager || world || null;
}

function isDead(target) {
    return target?.alive === false
        || Number(target?.hp) <= 0
        || (typeof target?.isDead === 'function' && target.isDead() === true);
}

function isInvulnerable(target) {
    return target?.invulnerable === true
        || target?.isInvulnerable === true
        || (typeof target?.isInvulnerable === 'function' && target.isInvulnerable() === true);
}

function makeBlockedResult(target, blocked) {
    const hp = Math.max(0, Number(target?.hp) || 0);
    return {
        blocked,
        applied: 0,
        absorbedByShield: 0,
        hpApplied: 0,
        remainingHp: hp,
        isDead: isDead(target),
    };
}

function resolveStrategy(world, entityManager) {
    return entityManager?.gameModeStrategy || world?.gameModeStrategy || world?.strategy || null;
}

/**
 * Apply one hit through the mode's existing damage rule, then publish its damage and death once.
 * `world` is normally the EntityManager; an owning context with `entityManager` is also accepted.
 *
 * @param {object} world
 * @param {unknown} input
 * @returns {{ blocked: null | 'TEAM' | 'SPAWN_PROTECTION' | 'DEAD' | 'INVULNERABLE', applied: number, absorbedByShield: number, hpApplied: number, remainingHp: number, isDead: boolean } | null}
 */
export function applyHit(world, input) {
    const hit = normalizeCombatHitInput(input);
    if (!hit) return null;

    const { target, amount, cause, weaponKind, sourcePlayer } = hit;
    const entityManager = resolveEntityManager(world);
    const strategy = resolveStrategy(world, entityManager);
    const causeKey = cause.toUpperCase();
    const selfDamageWithoutCredit = hit.selfDamagePolicy === 'ALLOW_WITHOUT_KILL_CREDIT'
        && sourcePlayer === target;

    // Authored map-collapse blasts are environmental hazards and can hit their source or teammates.
    if (
        sourcePlayer
        && causeKey !== PLAYER_CRASH_CAUSE
        && causeKey !== 'BLAST'
        && !selfDamageWithoutCredit
        && !canDamage(sourcePlayer, target, weaponKind)
    ) {
        return makeBlockedResult(target, 'TEAM');
    }
    if ((Number(target.spawnProtectionTimer) || 0) > 0) {
        return makeBlockedResult(target, 'SPAWN_PROTECTION');
    }
    if (isDead(target)) return makeBlockedResult(target, 'DEAD');
    if (isInvulnerable(target)) return makeBlockedResult(target, 'INVULNERABLE');
    if (amount <= 0) return makeBlockedResult(target, null);

    const hpBefore = Math.max(0, Number(target.hp) || 0);
    const shieldBefore = Math.max(0, Number(target.shieldHP) || 0);
    const strategyOptions = {
        ignoreShield: hit.ignoreShield === true,
        nowSeconds: hit.nowSeconds,
        sourcePlayer,
        cause,
    };
    const modeResult = typeof strategy?.applyDamage === 'function'
        ? strategy.applyDamage(target, amount, strategyOptions, target.entityRuntimeConfig)
        : target.takeDamage?.(amount, strategyOptions);
    if (!modeResult || typeof modeResult !== 'object') return null;

    const hpAfter = Math.max(0, Number(target.hp) || 0);
    const shieldAfter = Math.max(0, Number(target.shieldHP) || 0);
    const hpApplied = Math.max(0, hpBefore - hpAfter);
    const absorbedByShield = Math.max(0, shieldBefore - shieldAfter);
    const remainingHp = hpAfter;
    const deadAfterHit = modeResult.isDead === true || isDead(target);
    const damageResult = {
        ...modeResult,
        applied: Number.isFinite(Number(modeResult.applied)) ? Number(modeResult.applied) : hpApplied + absorbedByShield,
        absorbedByShield,
        hpApplied,
        remainingHp,
        isDead: deadAfterHit,
    };
    const effectiveDamage = hpApplied + absorbedByShield;

    if (effectiveDamage > 0 && hit.emitDamageEvent !== false) {
        entityManager?._emitHuntDamageEvent?.({
            target,
            sourcePlayer,
            cause,
            weaponKind,
            hitNormal: hit.hitNormal,
            damageResult,
            impactPoint: hit.impactPoint || target.position || null,
            projectileType: hit.projectileType,
        });
    }

    if (deadAfterHit && effectiveDamage > 0) {
        const teamCrash = causeKey === PLAYER_CRASH_CAUSE
            && areTeammates(sourcePlayer, target);
        entityManager?._killPlayer?.(target, hit.deathCause || cause, {
            killer: teamCrash || selfDamageWithoutCredit ? null : sourcePlayer,
            impactPoint: hit.impactPoint || target.position || null,
            projectileType: hit.projectileType,
        });
    }

    return { ...damageResult, blocked: null };
}

/**
 * Heal using the active mode's existing maximum-health and healing rules.
 * Spawn protection deliberately does not block healing.
 *
 * @param {object} world
 * @param {unknown} input
 * @returns {{ healed: number, hp: number, blocked: null | 'DEAD' | 'INVULNERABLE' } | null}
 */
export function applyHeal(world, input) {
    const heal = normalizeCombatHealInput(input);
    if (!heal) return null;
    const { target, amount } = heal;
    if (isDead(target)) return { healed: 0, hp: Math.max(0, Number(target.hp) || 0), blocked: 'DEAD' };
    if (isInvulnerable(target)) return { healed: 0, hp: Math.max(0, Number(target.hp) || 0), blocked: 'INVULNERABLE' };
    if (amount <= 0) return { healed: 0, hp: Math.max(0, Number(target.hp) || 0), blocked: null };

    const entityManager = resolveEntityManager(world);
    const strategy = resolveStrategy(world, entityManager);
    const result = typeof strategy?.applyHealing === 'function'
        ? strategy.applyHealing(target, amount, target.entityRuntimeConfig)
        : target.heal?.(amount);
    if (!result || typeof result !== 'object') return null;
    return {
        ...result,
        healed: Math.max(0, Number(result.healed) || 0),
        hp: Math.max(0, Number(target.hp) || Number(result.hp) || 0),
        blocked: null,
    };
}
