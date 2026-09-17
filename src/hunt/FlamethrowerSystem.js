import * as THREE from 'three';
import { consumeFlamethrowerFuel, igniteBurning } from '../entities/player/PlayerEffectOps.js';
import { spawnFlameJet } from './FlamethrowerFlameEffect.js';
import { isDestructibleTurret } from '../shared/contracts/TurretCombatContract.js';
import { shouldSkipOwnerSegment } from '../entities/systems/trails/TrailCollisionQuery.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { isHuntHealthActive } from './HealthSystem.js';

export const FLAMETHROWER_CAUSE = 'FLAMETHROWER';

const DEFAULT_RANGE = 18;
const DEFAULT_CONE_DEGREES = 30;
const DEFAULT_DAMAGE_PER_SECOND = 30;
const DEFAULT_TRAIL_BURN_SECONDS = 0.3;
const DEFAULT_TRAIL_SELF_SKIP_RECENT = 8;
// Summed frame deltas never land exactly on the threshold, so a rest far below one frame counts
// as reached instead of costing the segment another whole tick.
const BURN_EPSILON = 0.000001;

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Is the target inside the flame cone? The cone is widened by the hit radius of the target, so a
 * vehicle whose hull reaches into the flame burns even when its centre sits just outside.
 *
 * ponytail: the check knows the target centre and its radius, nothing about partial cover - a
 * target half behind a pillar still burns as long as its centre is visible.
 */
export function isInsideFlameCone(origin, direction, targetPosition, targetRadius, range, tanHalfAngle, scratch) {
    if (!origin || !direction || !targetPosition || !scratch) return false;
    const radius = Math.max(0, Number(targetRadius) || 0);
    const reach = Math.max(0, Number(range) || 0) + radius;
    const offset = scratch.subVectors(targetPosition, origin);
    const distanceSq = offset.lengthSq();
    if (distanceSq > reach * reach) return false;
    if (distanceSq <= radius * radius) return true;

    const forward = offset.dot(direction);
    if (forward <= 0) return false;
    const perpendicularSq = Math.max(0, distanceSq - forward * forward);
    const allowed = forward * Math.max(0, Number(tanHalfAngle) || 0) + radius;
    return perpendicularSq <= allowed * allowed;
}

export class FlamethrowerSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this._aim = new THREE.Vector3();
        this._offset = new THREE.Vector3();
        this._sight = new THREE.Vector3();
        this._trailPoint = new THREE.Vector3();
        this._trailCandidates = [];
    }

    /**
     * One tick of fire. Answers true when the flamethrower took the tick, which is what tells
     * the caller that the machine gun stays silent (E79). It is called on every tick, held or
     * not, because only a tick that knows the key was released can end the jet.
     */
    fire(player, dt, held = true) {
        if (player?.alive !== true) return false;
        const armed = player.hasFlamethrower === true;
        // Only the host burns. A replica still swallows the key so it fires no machine gun
        // bullets the host never saw, but the tank, the damage and the visible jet follow the
        // host snapshot (player.flameActive, applied by StateReconciler).
        if (this.entityManager?.isFightOutcomeAuthority === false) return armed && held === true;

        const seconds = armed && held === true ? consumeFlamethrowerFuel(player, dt) : 0;
        // A per tick fact, not a state: an empty tank or a released key ends the jet at once.
        player.flameActive = seconds > 0;
        if (seconds > 0) this._burn(player, seconds);
        return armed && held === true;
    }

    _burn(player, seconds) {
        const runtimeConfig = resolveEntityRuntimeConfig(player);
        const flame = runtimeConfig?.HUNT?.FLAMETHROWER || {};
        const range = positiveNumber(flame.RANGE, DEFAULT_RANGE);
        const coneDegrees = positiveNumber(flame.CONE_DEGREES, DEFAULT_CONE_DEGREES);
        const tanHalfAngle = Math.tan((Math.min(179, coneDegrees) * 0.5 * Math.PI) / 180);
        const damage = positiveNumber(flame.DAMAGE_PER_SECOND, DEFAULT_DAMAGE_PER_SECOND) * seconds;
        if (damage <= 0) return;

        // ponytail: the flame starts at the vehicle centre instead of the machine gun muzzle -
        // 2.1 of 18 units. S4.6 adds the muzzle offset together with the particle jet.
        const origin = player.position;
        const aim = this._aim;
        player.getAimDirection(aim);
        if (aim.lengthSq() <= 0.000001) return;
        aim.normalize();
        spawnFlameJet(this.entityManager?.particles, player);

        if (isHuntHealthActive(runtimeConfig)) this._burnPlayers(player, origin, aim, range, tanHalfAngle, damage);
        this._burnTurrets(player, origin, aim, range, tanHalfAngle, damage);
        this._burnMap(player, origin, aim, range, damage);
        // Trails burn in every mode, Classic included: there the gap in the wall is the whole
        // point of the item, because Classic knows no player damage at all.
        this._burnTrails(player, origin, aim, range, tanHalfAngle, seconds, runtimeConfig);
    }

    /**
     * Burns gaps into trails. Segments collect contact time and vanish once they have spent
     * TRAIL_BURN_SECONDS inside the cone, so a short sweep marks a wall while a held burst opens it.
     * Own segments burn too - freeing yourself from your own trap is the point - except for the
     * freshest pieces at the tail, which follow the same skip rule the machine gun uses.
     *
     * ponytail: collected contact time never decays, so releasing the key and firing again
     * continues where it stopped. Add a decay if freeing yourself turns out too easy.
     * ponytail: one line of sight ray per segment inside the cone. The area query is bounded by
     * the cone box, so the count is bounded too; add a per tick cap if profiling asks for it.
     */
    _burnTrails(player, origin, aim, range, tanHalfAngle, seconds, runtimeConfig) {
        const trails = this.entityManager?.getTrailSpatialIndex?.();
        if (typeof trails?.collectSegmentsInArea !== 'function') return;

        const halfWidth = range * tanHalfAngle;
        const endX = origin.x + aim.x * range;
        const endZ = origin.z + aim.z * range;
        const candidates = trails.collectSegmentsInArea(
            Math.min(origin.x, endX) - halfWidth,
            Math.min(origin.z, endZ) - halfWidth,
            Math.max(origin.x, endX) + halfWidth,
            Math.max(origin.z, endZ) + halfWidth,
            this._trailCandidates,
        );
        if (candidates.length === 0) return;

        const flame = runtimeConfig?.HUNT?.FLAMETHROWER || {};
        const burnSeconds = positiveNumber(flame.TRAIL_BURN_SECONDS, DEFAULT_TRAIL_BURN_SECONDS);
        const skipRecent = positiveNumber(runtimeConfig?.HUNT?.MG?.TRAIL_SELF_SKIP_RECENT, DEFAULT_TRAIL_SELF_SKIP_RECENT);
        const ownerIndex = Number.isInteger(player?.index) ? player.index : -1;
        const players = this.entityManager?.players || [];
        const point = this._trailPoint;

        for (const segment of candidates) {
            if (segment.destroyed) continue;
            if (shouldSkipOwnerSegment(segment, players, ownerIndex, skipRecent)) continue;
            point.set(
                (segment.fromX + segment.toX) * 0.5,
                (segment.fromY + segment.toY) * 0.5,
                (segment.fromZ + segment.toZ) * 0.5,
            );
            const radius = Math.max(0, Number(segment.radius) || 0);
            if (!isInsideFlameCone(origin, aim, point, radius, range, tanHalfAngle, this._offset)) continue;
            // Only map geometry blocks the flame; other trail segments do not, so the fire eats
            // its way through a stack of walls instead of stopping at the first one.
            if (!this._hasLineOfSight(origin, point)) continue;

            const burned = (Number(segment.burnSeconds) || 0) + seconds;
            if (burned + BURN_EPSILON < burnSeconds) {
                segment.burnSeconds = burned;
                continue;
            }
            trails.destroySegment(segment);
        }
    }

    _burnPlayers(player, origin, aim, range, tanHalfAngle, damage) {
        for (const target of this.entityManager?.players || []) {
            if (!target || target === player || target.alive !== true || !target.position) continue;
            if ((Number(target.spawnProtectionTimer) || 0) > 0) continue;
            const radius = Math.max(
                0.2,
                Number(target.hitboxRadius) || Number(resolveGameplayConfig(target).PLAYER?.HITBOX_RADIUS) || 0.8,
            );
            if (!isInsideFlameCone(origin, aim, target.position, radius, range, tanHalfAngle, this._offset)) continue;
            if (!this._hasLineOfSight(origin, target.position)) continue;

            const damageResult = target.takeDamage(damage);
            this.entityManager?._emitHuntDamageEvent?.({
                target,
                sourcePlayer: player,
                cause: FLAMETHROWER_CAUSE,
                damageResult,
                impactPoint: target.position,
            });
            if (damageResult?.isDead) {
                this.entityManager?._killPlayer?.(target, 'PROJECTILE', {
                    killer: player,
                    impactPoint: target.position,
                    projectileType: FLAMETHROWER_CAUSE,
                });
                continue;
            }
            igniteBurning(target, player);
        }
    }

    _burnTurrets(player, origin, aim, range, tanHalfAngle, damage) {
        const turrets = this.entityManager?._staticTurretSystem?.getDestructibleTargets?.() || [];
        for (const turret of turrets) {
            if (!isDestructibleTurret(turret) || turret.hp <= 0 || !turret.position) continue;
            if (turret.ownerPlayer === player || turret.ownerIndex === player?.index) continue;
            const radius = Math.max(0.5, Number(turret.hitboxRadius) || 2.2);
            if (!isInsideFlameCone(origin, aim, turret.position, radius, range, tanHalfAngle, this._offset)) continue;
            if (!this._hasLineOfSight(origin, turret.position)) continue;
            turret.takeDamage?.(damage, { sourcePlayer: player, cause: FLAMETHROWER_CAUSE });
        }
    }

    /**
     * Destructible map geometry burns along the centre line only: one ray, one mesh, the same
     * path the machine gun already uses. Walls that are not destructible swallow the flame.
     */
    _burnMap(player, origin, aim, range, damage) {
        const destructibles = this.entityManager?.getMapDestructibleSystem?.();
        if (typeof destructibles?.applyMeshHit !== 'function') return;
        const arena = this.entityManager?.arena;
        if (typeof arena?.raycast !== 'function') return;
        const result = arena.raycast(origin, aim, range);
        if (!result?.hit || !result.sourceName) return;
        destructibles.applyMeshHit(String(result.sourceName), damage, {
            hitPoint: result.point || null,
            hitDirection: aim,
            sourcePlayer: player || null,
            cause: FLAMETHROWER_CAUSE,
        });
    }

    _hasLineOfSight(origin, targetPosition) {
        const arena = this.entityManager?.arena;
        if (typeof arena?.raycast !== 'function') return true;
        const sight = this._sight.subVectors(targetPosition, origin);
        const distance = sight.length();
        if (distance <= 0.0001) return true;
        sight.multiplyScalar(1 / distance);
        return arena.raycast(origin, sight, distance)?.hit !== true;
    }
}
