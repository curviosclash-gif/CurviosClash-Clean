import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { RocketTrailSystem } from '../src/entities/systems/projectile/RocketTrailSystem.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createRenderer() {
    const sceneObjects = new Set();
    return {
        sceneObjects,
        addToScene(object) {
            sceneObjects.add(object);
        },
        removeFromScene(object) {
            sceneObjects.delete(object);
        },
    };
}

test('rocket rainbow trail renders distinct segment colors and registers collision', () => {
    const players = [{ index: 1 }];
    const renderer = createRenderer();
    const spatialIndex = new TrailSpatialIndex({ players });
    const rocketTrails = new RocketTrailSystem({
        renderer,
        trailSpatialIndex: spatialIndex,
        maxSegments: 8,
        width: 0.4,
    });
    assert.ok(rocketTrails.mesh.instanceColor);
    assert.deepEqual(Array.from(rocketTrails.mesh.instanceColor.array.slice(0, 3)), [1, 1, 1]);
    assert.equal(rocketTrails.material.vertexColors, false);
    const handle = rocketTrails.createTrailHandle(players[0]);

    const firstEntry = rocketTrails.appendSegment(
        handle,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(4, 0, 0)
    );
    rocketTrails.appendSegment(
        handle,
        new THREE.Vector3(10, 0, 0),
        new THREE.Vector3(14, 0, 0)
    );

    assert.equal(rocketTrails.mesh.count, 2);
    assert.equal(rocketTrails.glowMesh.count, 2);
    assert.equal(renderer.sceneObjects.has(rocketTrails.mesh), true);
    assert.ok(rocketTrails.mesh.instanceColor);

    const firstColor = new THREE.Color();
    const secondColor = new THREE.Color();
    rocketTrails.mesh.getColorAt(0, firstColor);
    rocketTrails.mesh.getColorAt(1, secondColor);
    assert.notDeepEqual(firstColor.toArray(), secondColor.toArray());
    assert.ok(Math.max(...firstColor.toArray()) > 0.5);

    const playerHit = spatialIndex.checkGlobalCollision(
        new THREE.Vector3(2, 0, 0),
        0.2
    );
    assert.equal(playerHit?.hit, true);
    assert.equal(playerHit?.playerIndex, 1);

    const ownProjectileHit = spatialIndex.checkProjectileTrailCollision(
        new THREE.Vector3(2, 0, 0),
        0.2,
        { excludeRocketTrailId: handle.id }
    );
    assert.equal(ownProjectileHit, null);

    const immediateOwnerHit = spatialIndex.checkGlobalCollision(
        new THREE.Vector3(2, 0, 0),
        0.2,
        players[0].index,
        2
    );
    assert.equal(immediateOwnerHit, null);

    rocketTrails.appendSegment(
        handle,
        new THREE.Vector3(20, 0, 0),
        new THREE.Vector3(24, 0, 0)
    );
    assert.equal(
        spatialIndex.checkGlobalCollision(new THREE.Vector3(2, 0, 0), 0.2, players[0].index, 2)?.hit,
        true
    );

    assert.equal(spatialIndex.destroySegment(firstEntry), true);
    assert.equal(spatialIndex.checkGlobalCollision(new THREE.Vector3(2, 0, 0), 0.2), null);

    rocketTrails.dispose();
    assert.equal(renderer.sceneObjects.size, 0);
    assert.equal(spatialIndex.spatialGrid.size, 0);
});

test('fight rockets leave persistent colliding trails without hitting their own trail', () => {
    const renderer = createRenderer();
    const owner = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(0, 0, 0),
    };
    const players = [owner];
    const spatialIndex = new TrailSpatialIndex({ players });
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const projectiles = new ProjectileSystem({
        renderer,
        entityRuntimeConfig,
        players,
        trailSpatialIndex: spatialIndex,
        arena: {
            getCollisionInfo() {
                return null;
            },
        },
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });

    const projectile = projectiles.spawnExternalProjectile({
        owner,
        type: 'ROCKET_WEAK',
        position: owner.position,
        direction: new THREE.Vector3(1, 0, 0),
    });
    assert.ok(projectile);

    projectiles.update(0.08);
    assert.equal(projectiles.projectiles.length, 1);
    assert.equal(projectiles._rocketTrailSystem.segmentCount, 1);

    const firstRef = projectiles._rocketTrailSystem.segmentRefs[0];
    const midpoint = new THREE.Vector3(
        (firstRef.entry.fromX + firstRef.entry.toX) * 0.5,
        (firstRef.entry.fromY + firstRef.entry.toY) * 0.5,
        (firstRef.entry.fromZ + firstRef.entry.toZ) * 0.5
    );
    assert.equal(spatialIndex.checkGlobalCollision(midpoint, 0.1)?.playerIndex, owner.index);

    projectiles.update(0.08);
    assert.equal(projectiles.projectiles.length, 1);
    assert.ok(projectiles._rocketTrailSystem.segmentCount >= 2);

    projectiles.clear();
    assert.equal(projectiles._rocketTrailSystem.segmentCount, 0);
    assert.equal(spatialIndex.spatialGrid.size, 0);
    projectiles.dispose();
});
