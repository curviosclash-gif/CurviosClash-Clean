import * as THREE from 'three';
import { consumeRailgunShot, hasRailgunEffect } from '../entities/player/PlayerEffectOps.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { HUNT_CONFIG } from './HuntConfig.js';
import { RailgunBeamEffect } from '../entities/effects/RailgunBeamEffect.js';
import {
    nextPlayerArcadeWeaponColor,
    resolveArcadeWeaponColor,
} from '../shared/contracts/ArcadeVehicleCosmeticContract.js';

export const RAILGUN_CAUSE = 'RAILGUN';
// Beams kept for the network: more than can land between two snapshots.
const RECENT_BEAMS = 6;

function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** E81: 20 when tapped, rising linearly to 70 after 1.5 s of charge; more charge adds nothing. */
export function resolveRailgunDamage(chargeSeconds, config) {
    const min = positive(config?.MIN_DAMAGE, 20);
    const max = Math.max(min, positive(config?.MAX_DAMAGE, 70));
    const full = positive(config?.CHARGE_SECONDS, 1.5);
    const ratio = Math.max(0, Math.min(1, (Number(chargeSeconds) || 0) / full));
    return min + (max - min) * ratio;
}

/**
 * Where the beam meets a target, as the distance along the beam, or -1. `radius` is the target's
 * hit radius plus the beam's own. Targets behind the muzzle or beyond `maxDistance` are missed.
 */
export function measureBeamHit(origin, direction, position, radius, maxDistance, scratch) {
    const offset = scratch.subVectors(position, origin);
    const along = offset.dot(direction);
    if (along < 0 || along > maxDistance) return -1;
    const sideSq = offset.lengthSq() - along * along;
    return sideSq <= radius * radius ? along : -1;
}

/**
 * The railgun (V14). Arming it (the item) hands the machine gun key to it (E79): while held the
 * shot charges, the release fires. The beam passes through trails, stops at map geometry and hits
 * up to MAX_TARGETS players and registry targets (tanks, turrets) in the order it meets them.
 * Only the host shoots; a replica swallows the key so no machine gun bullets fly that the host
 * never saw.
 */
export class RailgunSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.lastBeam = null;
        this._nextBeamId = 1;
        this._aim = new THREE.Vector3();
        this._scratch = new THREE.Vector3();
        this._hits = [];
        this._effect = null;
        this._recentBeams = [];
        this._appliedBeamId = 0;
    }

    _resolveEffect() {
        const renderer = this.entityManager?.renderer;
        if (!this._effect && renderer?.addToScene) this._effect = new RailgunBeamEffect(renderer);
        return this._effect;
    }

    /** Fades the beams; the host and the replicas both call it every tick. */
    update(dt) {
        this._effect?.update(dt);
    }

    /** The rod and the sound. Also called on a replica when the host reports a shot. */
    _showBeam(beam, color = 0x7fe7ff) {
        this._resolveEffect()?.show(beam.from, beam.to, color);
        this.entityManager?.audio?.play?.('SLINGSHOT', { intensity: 0.4 + 0.6 * Math.min(1, (Number(beam.damage) || 0) / 70) });
    }

    dispose() {
        this._effect?.dispose();
        this._effect = null;
        this._recentBeams.length = 0;
        this._appliedBeamId = 0;
        this._stateInitialized = false;
    }

    /** A few recent beams, so two shots between two snapshots both reach the clients. */
    _rememberBeam(beam) {
        this._recentBeams.push(beam);
        if (this._recentBeams.length > RECENT_BEAMS) this._recentBeams.shift();
    }

    /** Host truth for clients: the recent beams, each drawn once on every screen. Null before the first. */
    serializeNetworkState() {
        return this._recentBeams.length > 0 ? this._recentBeams.map((beam) => ({ ...beam })) : null;
    }

    applyNetworkState(beams) {
        // The first snapshot a client sees only learns the ids: old beams are not redrawn.
        const firstState = this._stateInitialized !== true;
        this._stateInitialized = true;
        const list = Array.isArray(beams) ? beams : [];
        for (const beam of list) {
            const id = Math.trunc(Number(beam?.id));
            if (!Number.isFinite(id) || id <= this._appliedBeamId) continue;
            this._appliedBeamId = id;
            this.lastBeam = beam;
            if (!firstState) this._showBeam(beam);
        }
    }

    _config(player) {
        return resolveEntityRuntimeConfig(player)?.HUNT?.RAILGUN || HUNT_CONFIG.RAILGUN;
    }

    /** One tick of the key. Answers true when the railgun took the key this tick. */
    fire(player, dt, held = true) {
        if (player?.alive !== true) {
            if (player) player.railCharge = 0;
            return false;
        }
        if (!hasRailgunEffect(player)) {
            // The gun is gone (expired, respawned) while the key may still be down: a charge left
            // over is dropped, never fired, and the key stays swallowed until it comes up, so the
            // machine gun does not start in the middle of a held shot.
            const swallow = held === true && (Number(player.railCharge) || 0) > 0;
            if (!swallow) player.railCharge = 0;
            return swallow;
        }
        if (this.entityManager?.isFightOutcomeAuthority === false) return held === true;
        const config = this._config(player);
        if (held === true) {
            const full = positive(config?.CHARGE_SECONDS, 1.5);
            player.railCharge = Math.min(full, (Number(player.railCharge) || 0) + Math.max(0, Number(dt) || 0));
            const styleId = player?.arcadeCosmeticLoadout?.weaponStyleIds?.railgun || 'standard';
            this._resolveEffect()?.showCharge(
                player.position,
                player.railCharge / full,
                resolveArcadeWeaponColor(styleId, this._nextBeamId, 0x7fe7ff)
            );
            return true;
        }
        const charge = Number(player.railCharge) || 0;
        player.railCharge = 0;
        this._effect?.hideCharge?.();
        if (charge <= 0) return false;
        // A shot is only spent when a beam actually left the barrel.
        if (this._shoot(player, resolveRailgunDamage(charge, config), config)) consumeRailgunShot(player);
        return true;
    }

    _collectHits(player, origin, aim, range, config) {
        const hits = this._hits;
        hits.length = 0;
        const beamRadius = Math.max(0, Number(config?.BEAM_RADIUS) || 0.5);
        const playerRadius = Number(resolveGameplayConfig(player).PLAYER?.HITBOX_RADIUS) || 0.8;
        for (const target of this.entityManager?.players || []) {
            if (!target || target === player || target.alive !== true || !target.position) continue;
            if ((Number(target.spawnProtectionTimer) || 0) > 0) continue;
            const radius = (Number(target.hitboxRadius) || playerRadius) + beamRadius;
            const along = measureBeamHit(origin, aim, target.position, radius, range, this._scratch);
            if (along >= 0) hits.push({ target, along, isPlayer: true });
        }
        for (const target of this.entityManager?._targetableRegistry?.collect?.() || []) {
            if (!target?.position || !(Number(target.hp) > 0)) continue;
            if (target.ownerPlayer === player || (Number.isInteger(player.index) && target.ownerIndex === player.index)) continue;
            const radius = (Number(target.hitboxRadius) || 2.2) + beamRadius;
            const along = measureBeamHit(origin, aim, target.position, radius, range, this._scratch);
            if (along >= 0) hits.push({ target, along, isPlayer: false });
        }
        hits.sort((a, b) => a.along - b.along);
        hits.length = Math.min(hits.length, Math.max(1, Math.trunc(Number(config?.MAX_TARGETS) || 3)));
        return hits;
    }

    _shoot(player, damage, config) {
        const owner = this.entityManager;
        const aim = player.getAimDirection?.(this._aim);
        if (!aim || aim.lengthSq() <= 0.000001) return false;
        aim.normalize();
        const origin = player.position;
        let range = positive(config?.RANGE, 250);
        // Map geometry stops the beam; trails do not (E48 "durch Spuren").
        const wall = owner?.arena?.raycast?.(origin, aim, range);
        const wallSource = wall?.hit ? String(wall.sourceName || '') : '';
        const wallPoint = wall?.hit && wall.point ? { x: wall.point.x, y: wall.point.y, z: wall.point.z } : null;
        if (wall?.hit) range = Math.max(0, Number(wall.distance) || 0);

        const hits = this._collectHits(player, origin, aim, range, config);
        // Copied first: a tank dying here explodes and may refill the registry list.
        const struck = hits.map((hit) => hit.target);
        for (let i = 0; i < struck.length; i += 1) {
            const target = struck[i];
            if (!hits[i].isPlayer) {
                target.takeDamage?.(damage, { sourcePlayer: player, cause: RAILGUN_CAUSE });
                continue;
            }
            const damageResult = target.takeDamage(damage);
            owner?._emitHuntDamageEvent?.({ target, sourcePlayer: player, cause: RAILGUN_CAUSE, damageResult, impactPoint: target.position });
            if (damageResult?.isDead) {
                owner?._killPlayer?.(target, 'PROJECTILE', { killer: player, impactPoint: target.position, projectileType: RAILGUN_CAUSE });
            }
        }
        // Where the beam ends on destructible geometry, it hits that too.
        if (wallSource && wallPoint) {
            owner?.getMapDestructibleSystem?.()?.applyMeshHit?.(wallSource, damage, {
                hitPoint: wallPoint, hitDirection: aim, sourcePlayer: player, cause: RAILGUN_CAUSE,
            });
        }
        const end = origin.clone().addScaledVector(aim, range);
        const cosmeticColor = nextPlayerArcadeWeaponColor(player, 'railgun', 0x7fe7ff);
        this.lastBeam = {
            id: this._nextBeamId++,
            ownerIndex: player.index,
            from: [origin.x, origin.y, origin.z],
            to: [end.x, end.y, end.z],
            damage,
            targetCount: struck.length,
        };
        this._rememberBeam(this.lastBeam);
        this._showBeam(this.lastBeam, cosmeticColor);
        owner?.recorder?.logEvent?.('RAILGUN_SHOT', Number.isInteger(player.index) ? player.index : -1, `damage=${Math.round(damage)}:targets=${struck.length}`);
        return true;
    }
}
