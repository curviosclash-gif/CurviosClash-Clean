import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const FRAME_SECONDS = 0.08;

/** Same owner object ExclusionZoneSystem hands to every salvo rocket. */
const ZONE_OWNER = Object.freeze({ index: -1, environment: true, name: 'Exclusion Zone' });

/** Stands in for Player: the collision phase reads pose, hitbox and the damage entry. */
function createShip(index, position) {
    return {
        index,
        isBot: false,
        alive: true,
        isGhost: false,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        hasShield: false,
        color: 0xffffff,
        hitboxRadius: 0.8,
        spawnProtectionTimer: 0,
        arenaCollisionGraceTimer: 0,
        wallDamageCooldown: 0,
        crashDamageCooldown: 0,
        trailDamageCooldown: 0,
        baseSpeed: 45,
        speed: 45,
        velocity: new THREE.Vector3(0, 0, 45),
        position,
        quaternion: new THREE.Quaternion(),
        trail: { forceGap() {} },
        takeDamage(amount) {
            this.hp = Math.max(0, this.hp - amount);
            return { applied: amount, absorbedByShield: 0, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
        getAimDirection(out) { return out.set(0, 0, 1); },
        getDirection(out) { return out.set(0, 0, 1); },
        refreshObbCollisionQuery() { return true; },
        markRenderDiscontinuity() {},
    };
}

/**
 * The real trail index behind a minimal EntityManager: the ship collision phase asks the very
 * index the rocket smoke is registered in, so whatever the smoke leaves there decides the hit.
 */
function createWorld(players) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const strategy = new HuntModeStrategy({ entityRuntimeConfig });
    const spatialIndex = new TrailSpatialIndex({ players });
    const environmentHits = [];
    const projectiles = new ProjectileSystem({
        renderer: { addToScene() {}, removeFromScene() {} },
        entityRuntimeConfig,
        players,
        trailSpatialIndex: spatialIndex,
        arena: { getCollisionInfo() { return null; } },
        getStrategy: () => strategy,
        applyEnvironmentDamage(player) { environmentHits.push(player.index); },
    });
    const kills = [];
    const entityManager = {
        players,
        audio: null,
        particles: null,
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpDir: new THREE.Vector3(),
        arena: { getCollisionInfo() { return null; }, checkCollision() { return false; } },
        checkGlobalCollision: (...args) => spatialIndex.checkGlobalCollision(...args),
        _emitHuntDamageEvent() {},
        _killPlayer(player, cause) {
            player.alive = false;
            kills.push({ index: player.index, cause });
        },
        _bounceBot() {},
        _bouncePlayerOnFoam() {},
        _pushPlayerOutOfCollision() { return false; },
    };
    entityManager.constructor = { deriveSelfTrailSkipRecentSegments: () => 0 };
    const collisionPhase = new PlayerCollisionPhase(entityManager);
    return { strategy, spatialIndex, projectiles, collisionPhase, kills, environmentHits };
}

/** Launches a rocket along +X from the origin and lets it lay one stretch of smoke. */
function launchAlongX(world, options) {
    const projectile = world.projectiles.spawnExternalProjectile({
        type: 'ROCKET_WEAK',
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(1, 0, 0),
        ...options,
    });
    assert.ok(projectile, 'the rocket launches');
    world.projectiles.update(FRAME_SECONDS);
    world.projectiles.update(FRAME_SECONDS);
    return projectile;
}

/** Flies the ship straight across the smoke laid between x 0 and the rocket. */
function crossSmoke(world, ship, rocket) {
    const crossingX = rocket.position.x * 0.5;
    const from = new THREE.Vector3(crossingX, 0, -3);
    ship.position.set(crossingX, 0, 3);
    return world.collisionPhase.run(ship, from, world.strategy);
}

function zoneRocketOptions(target) {
    // Exactly the flags ExclusionZoneSystem._spawnSalvo passes.
    return {
        owner: ZONE_OWNER,
        target,
        targetPlayerIndex: target.index,
        targetReacquireDisabled: true,
        ignoresTrails: true,
        ignoresTurrets: true,
        environmentProjectile: true,
        zoneProjectile: true,
        zoneSequence: 1,
    };
}

test('a ship flying through exclusion-zone rocket smoke takes no damage and does not die', () => {
    const target = createShip(0, new THREE.Vector3(400, 0, 0));
    const crosser = createShip(1, new THREE.Vector3());
    const world = createWorld([target, crosser]);

    const rocket = launchAlongX(world, zoneRocketOptions(target));
    assert.ok(rocket.position.x > 4, `the rocket laid a stretch of smoke, reached x ${rocket.position.x}`);
    assert.ok(world.projectiles._rocketTrailSystem.mesh.count > 0, 'the smoke stays visible');

    const died = crossSmoke(world, crosser, rocket);

    assert.equal(died, false, 'the smoke of a zone rocket must not kill');
    assert.deepEqual(world.kills, [], `nobody dies in the smoke, got ${JSON.stringify(world.kills)}`);
    assert.equal(crosser.hp, 100, 'the smoke of a zone rocket must not cost health');
    world.projectiles.dispose();
});

test('the zone rocket itself still hits its target', () => {
    const target = createShip(0, new THREE.Vector3(6, 0, 0));
    const world = createWorld([target]);

    world.projectiles.spawnExternalProjectile({
        type: 'ROCKET_WEAK',
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(1, 0, 0),
        ...zoneRocketOptions(target),
    });
    for (let frame = 0; frame < 20 && world.environmentHits.length === 0; frame += 1) {
        world.projectiles.update(1 / 60);
    }

    assert.deepEqual(world.environmentHits, [0], 'the salvo rocket is the penalty and still lands');
    world.projectiles.dispose();
});

test('the smoke of a ship-fired rocket still hurts a ship crossing it', () => {
    const shooter = createShip(0, new THREE.Vector3(-50, 0, 0));
    const crosser = createShip(1, new THREE.Vector3());
    const world = createWorld([shooter, crosser]);

    const rocket = launchAlongX(world, { owner: shooter });
    const died = crossSmoke(world, crosser, rocket);

    assert.ok(
        died || crosser.hp < 100,
        `a ship rocket trail keeps colliding, crosser ended with hp ${crosser.hp}`,
    );
    world.projectiles.dispose();
});

test('a ship trail still hurts another ship crossing it', () => {
    const owner = createShip(0, new THREE.Vector3(-50, 0, 0));
    const crosser = createShip(1, new THREE.Vector3());
    const world = createWorld([owner, crosser]);
    // Registered the way Trail._addSegment does for a colliding ship trail segment.
    world.spatialIndex.registerTrailSegment(owner.index, 0, {
        midX: 4, midZ: 0, fromX: 0, fromY: 0, fromZ: 0, toX: 8, toY: 0, toZ: 0,
        radius: 0.3, hp: 3, maxHp: 3, ownerTrail: null,
    });

    const died = crossSmoke(world, crosser, { position: new THREE.Vector3(8, 0, 0) });

    assert.ok(died || crosser.hp < 100, `a ship trail keeps colliding, crosser ended with hp ${crosser.hp}`);
    world.projectiles.dispose();
});
