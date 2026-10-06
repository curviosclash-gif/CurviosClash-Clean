import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ExclusionZoneSystem } from '../src/entities/systems/ExclusionZoneSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const STEP_SECONDS = 1 / 60;
// Rocket body (radius 0.7 x collision multiplier 1.65) plus the ship hitbox, rounded up.
const HIT_DISTANCE = 2;

function createConfig(playerOverrides = {}) {
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    Object.assign(config.PLAYER, playerOverrides);
    return config;
}

/**
 * A real ProjectileSystem launches the rockets, so the test sees the speed the game
 * really gives them. Only the flight itself is integrated here as straight pursuit,
 * because the homing simulation needs a whole match around it.
 */
function createPursuitHarness(config) {
    const arena = {
        bounds: { minX: -10, maxX: 10, minY: 0, maxY: 20, minZ: -10, maxZ: 10 },
        openFaces: ['maxX'],
        obstacles: [],
        staticCollisionRevision: 0,
    };
    arena.collision = new ArenaCollision(arena);
    arena.checkWorldGeometryCollision = (position, radius) => arena.collision.checkWorldGeometryCollision(position, radius);
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        isGhost: false,
        spawnProtectionTimer: 0,
        hitboxRadius: 1,
        position: new THREE.Vector3(12, 5, 0),
        velocity: new THREE.Vector3(),
    };
    const projectileSystem = new ProjectileSystem({
        entityRuntimeConfig: config,
        getStrategy: () => new ClassicModeStrategy(),
    });
    const manager = { arena, players: [player], audio: { play() {} }, entityRuntimeConfig: config };
    const zone = new ExclusionZoneSystem(manager, { projectileSystem });
    return { player, projectileSystem, zone };
}

/** Steady boost duty: the reserve lasts BOOST_DURATION and refills over BOOST_COOLDOWN. */
function boostIsActive(config, elapsedSeconds) {
    const duration = config.PLAYER.BOOST_DURATION;
    const cycle = duration + config.PLAYER.BOOST_COOLDOWN;
    return (elapsedSeconds % cycle) < duration;
}

function fleeWithBoostDuty(config, seconds) {
    const { player, projectileSystem, zone } = createPursuitHarness(config);
    const launched = new Set();
    const hit = new Set();
    const toTarget = new THREE.Vector3();
    try {
        for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
            const shipSpeed = config.PLAYER.SPEED
                * (boostIsActive(config, elapsed) ? config.PLAYER.BOOST_MULTIPLIER : 1);
            player.position.x += shipSpeed * STEP_SECONDS;
            zone.update(STEP_SECONDS);
            for (let index = projectileSystem.projectiles.length - 1; index >= 0; index -= 1) {
                const rocket = projectileSystem.projectiles[index];
                launched.add(rocket.zoneSequence);
                toTarget.subVectors(player.position, rocket.position);
                const step = rocket.velocity.length() * STEP_SECONDS;
                if (toTarget.length() <= HIT_DISTANCE + step) {
                    hit.add(rocket.zoneSequence);
                    projectileSystem.projectiles.splice(index, 1);
                    continue;
                }
                rocket.position.addScaledVector(toTarget.normalize(), step);
            }
        }
        const alive = new Set(projectileSystem.projectiles.map((rocket) => rocket.zoneSequence));
        const trimmedEarly = [...launched].filter((sequence) => !hit.has(sequence) && !alive.has(sequence));
        return { launched: launched.size, hit: hit.size, trimmedEarly: trimmedEarly.length };
    } finally {
        projectileSystem.dispose();
    }
}

for (const [label, config] of [
    ['product ship', createConfig()],
    ['slower ship with a weaker boost', createConfig({ SPEED: 30, BOOST_MULTIPLIER: 1.8 })],
]) {
    test(`every exclusion salvo rocket is at least as fast as the boosted ${label}`, () => {
        const { player, projectileSystem, zone } = createPursuitHarness(config);
        try {
            player.position.x = 12;
            const boostedShipSpeed = config.PLAYER.SPEED * config.PLAYER.BOOST_MULTIPLIER;
            const speedsByType = new Map();
            for (let elapsed = 0; elapsed < 40; elapsed += 1) {
                zone.update(1);
                for (const rocket of projectileSystem.projectiles) {
                    speedsByType.set(rocket.type, rocket.velocity.length());
                }
            }
            assert.deepEqual([...speedsByType.keys()].sort(), ['ROCKET_HEAVY', 'ROCKET_MEDIUM', 'ROCKET_WEAK']);
            for (const [type, speed] of speedsByType) {
                assert.ok(speed + 1e-9 >= boostedShipSpeed,
                    `${type} flies ${speed.toFixed(2)} u/s, slower than the boosted ship at ${boostedShipSpeed.toFixed(2)} u/s`);
            }
        } finally {
            projectileSystem.dispose();
        }
    });

    test(`no salvo rocket is deleted before it reaches a fleeing ${label} that boosts whenever it can`, () => {
        const result = fleeWithBoostDuty(config, 40);
        assert.ok(result.launched > 0, 'the fleeing ship drew salvos');
        assert.equal(result.trimmedEarly, 0,
            `${result.trimmedEarly} of ${result.launched} rockets were deleted before they could reach the fleeing ship`);
        assert.ok(result.hit > 0, 'pursuing rockets reach the fleeing ship');
    });
}
