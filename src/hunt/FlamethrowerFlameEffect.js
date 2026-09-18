// ============================================
// FlamethrowerFlameEffect.js - the visible jet of the flamethrower (S4.6)
// ============================================
// Presentation only: host and replica both call this, the damage stays with the host.

import * as THREE from 'three';

import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { isPlayerBurning } from '../entities/player/PlayerEffectOps.js';

const DEFAULT_RANGE = 18;
// How long a particle needs to travel the whole range. Short enough that the jet ends where
// the cone ends instead of drifting on as a cloud.
const FLIGHT_SECONDS = 0.32;
const PARTICLES_PER_STAGE = 2;

// Yellow at the muzzle, orange in the middle, red at the tip. The colour cannot change over a
// particle's life, so the gradient comes from the lifetime instead: the yellow ones die first.
const FLAME_STAGES = Object.freeze([
    Object.freeze({ color: 0xffe066, lifeRatio: 0.34, size: 0.5 }),
    Object.freeze({ color: 0xff8c1a, lifeRatio: 0.68, size: 0.72 }),
    Object.freeze({ color: 0xd93a10, lifeRatio: 1, size: 0.95 }),
]);

// Fixed budget per call, per firing player: three stages of two particles. The particle buffer
// is shared with explosions and impacts, so a held burst must not be able to eat it.
export const FLAME_JET_PARTICLE_BUDGET = FLAME_STAGES.length * PARTICLES_PER_STAGE;

// Fire rises, so the gravity is positive; the spread keeps the jet a jet.
const JET_OPTIONS = Object.freeze({ gravity: 1.5, spread: 0.16, drift: 0.2, type: 'flamethrower-jet' });

// One scratch direction for every caller: the spawn is synchronous and never yields, so a
// module level vector is enough to keep the update loop free of new objects.
const AIM = new THREE.Vector3();

/**
 * Sprays one tick of flame along the aim direction and answers how many particles it spawned.
 * The host calls it while the cone burns, a replica while the host snapshot says flameActive.
 *
 * ponytail: the jet starts at the vehicle centre, like the cone itself - the machine gun muzzle
 * has no published position yet. Give the module an origin offset once it has one.
 */
export function spawnFlameJet(particles, player) {
    if (typeof particles?.spawnDirectional !== 'function') return 0;
    if (!player?.position || typeof player.getAimDirection !== 'function') return 0;

    player.getAimDirection(AIM);
    if (AIM.lengthSq() <= 0.000001) return 0;
    AIM.normalize();

    const flame = resolveEntityRuntimeConfig(player)?.HUNT?.FLAMETHROWER || {};
    const parsedRange = Number(flame.RANGE);
    const range = Number.isFinite(parsedRange) && parsedRange > 0 ? parsedRange : DEFAULT_RANGE;
    const speed = range / FLIGHT_SECONDS;

    for (const stage of FLAME_STAGES) {
        particles.spawnDirectional(
            player.position,
            AIM,
            PARTICLES_PER_STAGE,
            stage.color,
            speed,
            stage.size,
            FLIGHT_SECONDS * stage.lifeRatio,
            JET_OPTIONS,
        );
    }
    return FLAME_JET_PARTICLE_BUDGET;
}

// The afterburn on a hit vehicle: the same two warm colours as the jet, one particle each, so a
// whole field of burning players stays far cheaper than a single held burst.
const BURNING_FLAME_STAGES = Object.freeze([
    Object.freeze({ color: 0xff8c1a, size: 0.34 }),
    Object.freeze({ color: 0xd93a10, size: 0.46 }),
]);
const BURNING_FLAME_LIFE_SECONDS = 0.4;
const BURNING_FLAME_RISE_SPEED = 2.6;

export const BURNING_FLAME_PARTICLE_BUDGET = BURNING_FLAME_STAGES.length;

// Fire rises, so the particles go up with enough spread to look like flames instead of a column.
const BURNING_UP = Object.freeze(new THREE.Vector3(0, 1, 0));
const BURNING_OPTIONS = Object.freeze({ gravity: 1.2, spread: 0.5, drift: 0.3, type: 'burning-afterburn' });

/**
 * Draws one frame of the afterburn and answers how many particles it spawned. The host calls it
 * from the player view, and so does every replica: BURNING travels in the snapshot as a plain
 * effect entry, so both sides see the same fire without the client ever computing damage.
 *
 * ponytail: the flames start at the vehicle centre, like the jet - there is no published hull
 * anchor to hang them off yet.
 */
export function spawnBurningFlames(particles, player) {
    if (typeof particles?.spawnDirectional !== 'function') return 0;
    if (!player?.position || player.alive !== true) return 0;
    if (!isPlayerBurning(player)) return 0;

    for (const stage of BURNING_FLAME_STAGES) {
        particles.spawnDirectional(
            player.position,
            BURNING_UP,
            1,
            stage.color,
            BURNING_FLAME_RISE_SPEED,
            stage.size,
            BURNING_FLAME_LIFE_SECONDS,
            BURNING_OPTIONS,
        );
    }
    return BURNING_FLAME_PARTICLE_BUDGET;
}
