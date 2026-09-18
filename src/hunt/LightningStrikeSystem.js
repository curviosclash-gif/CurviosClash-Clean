import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { HUNT_CONFIG } from './HuntConfig.js';
import { isHuntHealthActive } from './HealthSystem.js';

export const LIGHTNING_CAUSE = 'LIGHTNING';

function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Picks who the strike hits, at the moment of the strike (E27): the highest flyers among the other
 * living players - a share of them rounded up, at least one (E20) - never the caster (E47) and never
 * a player under spawn protection. Diving in the warning window is what saves you.
 */
export function selectLightningTargets(players, caster, share, out = []) {
    out.length = 0;
    for (const player of players || []) {
        if (!player || player === caster || player.alive !== true || !player.position) continue;
        if (player.entitySlotActive === false || (Number(player.spawnProtectionTimer) || 0) > 0) continue;
        out.push(player);
    }
    if (out.length === 0) return out;
    // Highest first; equal heights keep the player order, so the choice is reproducible.
    out.sort((a, b) => (b.position.y - a.position.y) || (Number(a.index) - Number(b.index)));
    out.length = Math.max(1, Math.ceil(out.length * share));
    return out;
}

/**
 * How much the strike takes (E28, E31): 35, but a target with at least 30 hit points keeps one of
 * them. Below 30 the strike is lethal. A shield soaks damage first, so it counts towards what the
 * target can lose before its last point.
 */
export function resolveLightningDamage(target, damage, lethalBelowHp) {
    const hp = Math.max(0, Number(target?.hp) || 0);
    if (hp < lethalBelowHp) return damage;
    const shield = Math.max(0, Number(target?.shieldHP) || 0);
    return Math.max(0, Math.min(damage, hp + shield - 1));
}

/**
 * The lightning item (V20). Using it starts a warning over the whole map; WARNING_SECONDS later the
 * strike lands. Several casts run side by side. Only the host resolves strikes - a network replica
 * learns about them from the snapshot (S6.4).
 */
export class LightningStrikeSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.pending = [];
        this.lastStrike = null;
        this.networkReplica = false;
        this._targets = [];
        this._nextStrikeId = 1;
    }

    _config() {
        return resolveEntityRuntimeConfig(this.entityManager)?.HUNT?.LIGHTNING || HUNT_CONFIG.LIGHTNING;
    }

    canActivate() {
        return this.networkReplica !== true && isHuntHealthActive(resolveEntityRuntimeConfig(this.entityManager));
    }

    activate(caster) {
        if (!caster || !this.canActivate()) return false;
        const warning = positive(this._config()?.WARNING_SECONDS, 2);
        this.pending.push({ id: this._nextStrikeId++, caster, remaining: warning, duration: warning });
        this.entityManager?.recorder?.logEvent?.('LIGHTNING_CAST', Number.isInteger(caster.index) ? caster.index : -1, `warning=${warning}`);
        return true;
    }

    /** The warning the HUD and the sky show: the strike closest to landing, or null. */
    getWarningState() {
        let next = null;
        for (const strike of this.pending) if (!next || strike.remaining < next.remaining) next = strike;
        return next ? { remainingSeconds: next.remaining, durationSeconds: next.duration, count: this.pending.length } : null;
    }

    update(dt) {
        if (this.pending.length === 0) return;
        const safeDt = Math.max(0, Number(dt) || 0);
        for (let index = 0; index < this.pending.length;) {
            const strike = this.pending[index];
            strike.remaining -= safeDt;
            if (strike.remaining > 0 || this.networkReplica) {
                index += 1;
                continue;
            }
            this.pending.splice(index, 1);
            this._strike(strike);
        }
    }

    _strike(strike) {
        const owner = this.entityManager;
        const config = this._config() || {};
        const damage = positive(config.DAMAGE, 35);
        const lethalBelow = positive(config.LETHAL_BELOW_HP, 30);
        const targets = selectLightningTargets(owner?.players, strike.caster, positive(config.TARGET_SHARE, 0.2), this._targets);
        const hit = [];
        for (const target of targets) {
            const amount = resolveLightningDamage(target, damage, lethalBelow);
            if (amount <= 0 || typeof target.takeDamage !== 'function') continue;
            const damageResult = target.takeDamage(amount);
            hit.push(target.index);
            owner?._emitHuntDamageEvent?.({
                target,
                sourcePlayer: strike.caster,
                cause: LIGHTNING_CAUSE,
                damageResult,
                impactPoint: target.position,
            });
            if (damageResult?.isDead) {
                owner?._killPlayer?.(target, 'PROJECTILE', {
                    killer: strike.caster,
                    impactPoint: target.position,
                    projectileType: LIGHTNING_CAUSE,
                });
            }
        }
        this.lastStrike = { id: strike.id, casterIndex: strike.caster?.index ?? -1, targetIndices: hit };
        owner?.recorder?.logEvent?.('LIGHTNING_STRIKE', Number.isInteger(strike.caster?.index) ? strike.caster.index : -1, `targets=${hit.join(',')}`);
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    reset() {
        this.pending.length = 0;
        this.lastStrike = null;
    }
}
