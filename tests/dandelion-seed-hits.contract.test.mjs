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
        previousPosition: new THREE.Vector3(0, 1.8, 5),
        position: new THREE.Vector3(0, 1.8, -1),
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
