import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DandelionSeedController } from '../src/entities/arena/DandelionSeedController.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';

function seedArena() {
    const root = new THREE.Group();
    const seed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1));
    seed.name = 'AttachedSeed_001_SHOOTABLE_nocol';
    seed.userData = { role: 'shootable_seed', seed_index: 1, pappus_height: 1.8 };
    root.add(seed);
    const controller = new DandelionSeedController(root);
    return {
        controller,
        raycast: () => ({ hit: false }),
        getCollisionInfo: () => null,
        raycastDandelionSeed: (...args) => controller.raycast(...args),
        releaseDandelionSeed: (name) => controller.releaseByName(name, 5),
    };
}

test('MG chooses a shootable seed before a farther target and detaches it on impact', () => {
    const arena = seedArena();
    const resolver = new MGHitResolver({ arena, players: [] });
    const origin = new THREE.Vector3(0, 1.8, 5);
    const aim = new THREE.Vector3(0, 0, -1);
    const hit = resolver.resolveHit({ position: origin }, { RANGE: 30 }, null, null, aim);
    assert.equal(hit.arena.sourceName, 'AttachedSeed_001_SHOOTABLE_nocol');
    assert.equal(OverheatGunSystem.prototype._applyMapDestructibleHit.call(
        { entityManager: { arena } }, null, { arena: hit.arena, point: hit.point }, aim,
    ), true);
    assert.deepEqual(arena.controller.serialize(), [[1, 5]]);
    assert.equal(arena.raycastDandelionSeed(origin, aim, 30), null);
});

test('a rocket sweep reaches a seed and releases it before the projectile is removed', () => {
    const arena = seedArena();
    const projectile = {
        previousPosition: new THREE.Vector3(0, 0.45, 5),
        position: new THREE.Vector3(0, 0.45, -1),
        radius: 0.2,
        type: 'ROCKET_WEAK',
    };
    const simulation = new ProjectileSimulationOps({});
    const collision = simulation._resolveArenaCollision(projectile, arena);
    assert.equal(collision.sourceName, 'AttachedSeed_001_SHOOTABLE_nocol');
    const hitResolver = new ProjectileHitResolver({ getArena: () => arena });
    assert.equal(hitResolver._applyDestructibleMapHit(projectile,
        { arenaCollision: collision }).applied, true);
    assert.deepEqual(arena.controller.serialize(), [[1, 5]]);
});

test('game-state snapshots replicate released seeds in every mode without replaying the hit', () => {
    const hostArena = seedArena();
    const replicaArena = seedArena();
    hostArena.releaseDandelionSeed('AttachedSeed_001_SHOOTABLE_nocol');
    const host = {
        huntEnabled: false,
        arena: { serializeDandelionSeeds: () => hostArena.controller.serialize() },
        players: [],
    };
    const replica = {
        arena: { applyDandelionSeedState: (state) => replicaArena.controller.applyNetworkState(state) },
    };
    const snapshot = createGameStateSnapshot(host);
    assert.deepEqual(snapshot.dandelionSeeds, [[1, 5]]);
    EntityManager.prototype.applyNetworkSnapshot.call(replica, snapshot);
    assert.deepEqual(replicaArena.controller.serialize(), [[1, 5]]);
});

test('a seed contact applies one point of mode damage and only a weak deflection', () => {
    let damage = null;
    let slingshot = null;
    const player = {
        alive: true,
        index: 3,
        position: new THREE.Vector3(1, 2, 3),
        takeDamage: () => { throw new Error('mode-aware damage path should be used'); },
        activateSlingshot: (params, forward, up) => {
            slingshot = { params, forward: { ...forward }, up: { ...up } };
        },
    };
    const previousPosition = new THREE.Vector3(-2, 2, 3);
    let receivedPreviousPosition = null;
    const phase = new PlayerCollisionPhase({
        arena: {
            consumeDandelionSeedCollision: (_position, _radius, _index, previous) => {
                receivedPreviousPosition = previous;
                return { seedIndex: 11, normal: new THREE.Vector3(1, 0, 0) };
            },
        },
        _applyModeDamage: (_player, amount, cause, options) => {
            damage = { amount, cause, options };
            return { applied: amount, isDead: false };
        },
    });

    assert.equal(phase._resolveDandelionSeedCollision(player, 0.4, previousPosition), true);
    assert.equal(damage.amount, 1);
    assert.equal(damage.cause, 'DANDELION_SEED');
    assert.equal(damage.options.impactPoint, player.position);
    assert.equal(receivedPreviousPosition, previousPosition);
    assert.deepEqual(slingshot.params, { duration: 0.12, forwardImpulse: 1.3, liftImpulse: 0.25 });
    assert.deepEqual(slingshot.forward, { x: 1, y: 0, z: 0 });
    assert.deepEqual(slingshot.up, { x: 0, y: 1, z: 0 });
});

test('classic mode keeps the soft deflection without inventing a fractional health path', () => {
    let slingshotCalls = 0;
    const player = {
        alive: true,
        index: 1,
        position: new THREE.Vector3(),
        activateSlingshot: () => { slingshotCalls += 1; },
    };
    const phase = new PlayerCollisionPhase({
        arena: {
            consumeDandelionSeedCollision: () => ({
                seedIndex: 1,
                normal: new THREE.Vector3(0, 1, 0),
            }),
        },
        gameModeStrategy: { hasDamageEvents: () => false },
        _applyModeDamage: () => { throw new Error('classic must not receive gradual damage'); },
    });
    assert.equal(phase._resolveDandelionSeedCollision(player, 0.4), true);
    assert.equal(slingshotCalls, 1);
});
