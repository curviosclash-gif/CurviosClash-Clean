import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DANDELION_SKY_MAP } from '../src/core/config/maps/presets/dandelion_sky.js';
import {
    DANDELION_SKY_ROOT_CHAMBER_MODELS,
    DANDELION_SKY_ROOT_CHAMBER_OBSTACLES,
} from '../src/core/config/maps/presets/dandelion_sky/DandelionSkySecretRoom.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { DandelionSeedController } from '../src/entities/arena/DandelionSeedController.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import {
    isPointInSecretRoom,
    normalizeSecretRooms,
    resolveSecretRoomUnlockSeconds,
} from '../src/shared/contracts/SecretRoomContract.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { formatDandelionSeedStatus } from '../src/ui/DandelionSeedStatusText.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP = DANDELION_SKY_MAP.dandelion_sky;
const ROOM = normalizeSecretRooms(MAP.secretRooms)[0];

function boxOf(obstacle) {
    return {
        min: [0, 1, 2].map((axis) => obstacle.pos[axis] - obstacle.size[axis] / 2),
        max: [0, 1, 2].map((axis) => obstacle.pos[axis] + obstacle.size[axis] / 2),
    };
}

function axisOverlap(aMin, aMax, bMin, bMax) {
    return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

test('the chamber mushrooms stay inside the chamber and clear of its pickups', () => {
    // Decoration has no collider, so nothing stops a mushroom from standing half inside a wall
    // or from covering the exit portal - it simply looks wrong, in a room the player had to
    // earn. The bound below is deliberately pessimistic: targetSize is the model's *largest*
    // dimension, so treating it as a radius over-reserves for every mushroom whose height wins,
    // which is most of them. A placement that passes this cannot clip.
    const bounds = ROOM.bounds;
    assert.ok(DANDELION_SKY_ROOT_CHAMBER_MODELS.length >= 8, 'the room is actually decorated');
    for (const model of DANDELION_SKY_ROOT_CHAMBER_MODELS) {
        const [x, y, z] = model.position;
        const reach = model.targetSize / 2;
        assert.ok(x - reach >= bounds.min[0] && x + reach <= bounds.max[0],
            `${model.id} stays between the side walls`);
        assert.ok(z - reach >= bounds.min[2] && z + reach <= bounds.max[2],
            `${model.id} stays between the end walls`);
        // GLBMapLoader puts a model's underside on its position, so height runs upward from y.
        assert.ok(y >= bounds.min[1] && y + model.targetSize <= bounds.max[1],
            `${model.id} fits between floor and ceiling`);
        assert.equal(model.collision, false, `${model.id} stays decoration`);
    }
    // The exit portal and the pickups have to stay readable. A mushroom is allowed to stand near
    // one, not on top of it.
    const claimed = [ROOM.roomPortal.pos, ...ROOM.items.map((item) => item.pos)];
    for (const model of DANDELION_SKY_ROOT_CHAMBER_MODELS) {
        for (const point of claimed) {
            const distance = Math.hypot(model.position[0] - point[0], model.position[2] - point[2]);
            const verticallyApart = point[1] > model.position[1] + model.targetSize
                || point[1] < model.position[1];
            assert.ok(distance > 3 || verticallyApart,
                `${model.id} leaves ${point.join('/')} visible`);
        }
    }
});

test('the root chamber unlock is normalized, persisted and resolved only at all seeds', () => {
    assert.equal(ROOM.id, 'root_chamber');
    assert.deepEqual(ROOM.unlock, {
        source: 'dandelionSeeds', when: 'allReleased', delaySeconds: 0,
    });
    assert.equal(resolveSecretRoomUnlockSeconds(ROOM, {
        total: 220, released: 219, allReleased: false, completedAtSeconds: 40,
    }), Infinity);
    assert.equal(resolveSecretRoomUnlockSeconds(ROOM, {
        total: 220, released: 220, allReleased: true, completedAtSeconds: 41.25,
    }), 41.25);

    const document = normalizeMapSchemaDocument({ secretRooms: MAP.secretRooms });
    assert.deepEqual(document.secretRooms[0].unlock, {
        source: 'dandelionSeeds', when: 'allReleased', delaySeconds: 0,
    });
});

test('the runtime opens the root chamber exactly on the last released seed', () => {
    const progress = {
        total: 220, released: 219, remaining: 1, allReleased: false, completedAtSeconds: 0,
    };
    const portal = {
        secret: true,
        roomId: ROOM.id,
        active: false,
        meshA: { visible: false },
        meshB: { visible: false },
        cooldowns: new Map(),
    };
    const arena = {
        currentMapDefinition: MAP,
        portals: [portal],
        glbAnimationElapsedSeconds: 40,
        getDandelionSeedProgress: () => progress,
    };
    const system = new SecretRoomSystem({
        arena,
        players: [],
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
    });
    assert.equal(system.startRound(), 1);
    assert.equal(system.isRoomOpen(ROOM.id), false);
    assert.equal(portal.active, false);

    system.update(0);
    assert.equal(system.isRoomOpen(ROOM.id), false);
    progress.released = 220;
    progress.remaining = 0;
    progress.allReleased = true;
    progress.completedAtSeconds = 41.25;
    arena.glbAnimationElapsedSeconds = 41.25;
    system.update(0);

    assert.equal(system.isRoomOpen(ROOM.id), true);
    assert.equal(portal.active, true);
    assert.equal(portal.meshA.visible, true);
    assert.equal(system.getOpenedRoomCount(), 1);
});

test('the root chamber shell encloses a safe interior with no turret inside', () => {
    assert.equal(DANDELION_SKY_ROOT_CHAMBER_OBSTACLES.length, 6);
    for (const obstacle of DANDELION_SKY_ROOT_CHAMBER_OBSTACLES) {
        assert.equal(obstacle.compileWithGlb, true);
        assert.equal(obstacle.renderWithGlb, true);
        const box = boxOf(obstacle);
        const overlaps = [0, 1, 2].map((axis) => axisOverlap(
            box.min[axis], box.max[axis], ROOM.bounds.min[axis], ROOM.bounds.max[axis],
        ));
        assert.ok(overlaps.some((value) => value <= 0), `wall ${obstacle.pos} enters the room`);
    }
    assert.ok(ROOM.bounds.max[1] <= -2, 'the room needs rock between it and the arena floor');
    assert.equal(isPointInSecretRoom(ROOM, ROOM.roomPortal.pos), true);
    for (const item of ROOM.items) assert.equal(isPointInSecretRoom(ROOM, item.pos), true);
    for (const entry of MAP.staticTurrets) {
        assert.equal(isPointInSecretRoom(ROOM, entry.pos), false, `${entry.id} is inside`);
        const turret = normalizeStaticTurretDefinition(entry, 0, { preserveSpatialRange: true });
        assert.equal(turret.secretRoomId, ROOM.id);
        const portalDistance = Math.hypot(...ROOM.entryPortal.pos.map((value, axis) => value - turret.pos[axis]));
        assert.ok(portalDistance < turret.range, `${turret.id} cannot cover the portal`);
        const nearestRoomDistance = Math.hypot(
            Math.max(ROOM.bounds.min[0] - turret.pos[0], 0, turret.pos[0] - ROOM.bounds.max[0]),
            Math.max(ROOM.bounds.min[1] - turret.pos[1], 0, turret.pos[1] - ROOM.bounds.max[1]),
            Math.max(ROOM.bounds.min[2] - turret.pos[2], 0, turret.pos[2] - ROOM.bounds.max[2]),
        );
        assert.ok(nearestRoomDistance > turret.range, `${turret.id} can fire into the room`);
    }
});

test('root chamber guards stay hidden and untargetable until the room opens', () => {
    let roomOpen = false;
    const roots = [];
    const system = new StaticTurretSystem({
        renderer: {
            addToScene(root) { roots.push(root); },
            removeFromScene() {},
        },
        gameModeStrategy: { modeType: 'HUNT' },
        arena: { currentMapDefinition: MAP, checkCollisionFast: () => false },
        _secretRoomSystem: { isRoomOpen: (id) => id === ROOM.id && roomOpen },
        humanPlayers: [],
    });
    assert.equal(system.startRound(), 3);
    assert.ok(roots.every((root) => root.visible === false));
    assert.deepEqual(system.getDestructibleTargets(), []);
    const blockedDamage = system.damageTurret(system.turrets[0], 10);
    assert.equal(blockedDamage.applied, 0);

    roomOpen = true;
    system.update(0);
    assert.ok(roots.every((root) => root.visible === true));
    assert.equal(system.getDestructibleTargets().length, 3);
    assert.ok(system.createNetworkSnapshot().every((entry) => entry.secretRoomId === ROOM.id));
    system.dispose();
});

test('new routes, pickups and the crown portal are clear of hard flower geometry', async () => {
    const result = await loadGLBMapCollection(MAP.glbModels, {
        loader: geometryOnlyGlbLoader,
        placementScale: 1,
        colliderMode: MAP.glbColliderMode,
    });
    const hard = result.colliders.filter((entry) => entry.meshCollider);
    const probes = [
        ROOM.entryPortal.pos,
        ROOM.ejectPoint.pos,
        ...MAP.staticTurrets.map((entry) => entry.pos),
        ...MAP.gates.slice(-2).map((entry) => entry.pos),
        ...MAP.items.slice(1).map((entry) => [entry.x, entry.y, entry.z]),
    ];
    for (const probe of probes) {
        const point = new THREE.Vector3(...probe);
        assert.equal(hard.some((entry) => sphereIntersectsStaticMeshCollider(
            entry.meshCollider, point, 4,
        )), false, `probe ${probe} intersects hard geometry`);
    }

    const seeds = new DandelionSeedController(result.scene);
    const rocket = MAP.items.find((entry) => entry.id === 'dandelion_sky_rocket_east');
    assert.equal(seeds.consumeCollision(
        new THREE.Vector3(rocket.x, rocket.y, rocket.z), 4, 0,
    ), null, 'the moved eastern rocket still touches an attached seed');
});

test('the HUD projection reports seed progress and announces the open portal', () => {
    const partial = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        dandelionSeeds: { total: 220, released: 137, allReleased: false },
    });
    assert.deepEqual(partial.dandelionSeeds, {
        active: true, total: 220, released: 137, remaining: 83,
        allReleased: false, completedAtSeconds: 0,
    });
    assert.equal(formatDandelionSeedStatus(partial.dandelionSeeds), 'PUSTEBLUME · 137/220 SAMEN');

    const complete = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        dandelionSeeds: { total: 220, released: 220, allReleased: true, completedAtSeconds: 42 },
    });
    assert.equal(formatDandelionSeedStatus(complete.dandelionSeeds), 'ALLE SAMEN GELÖST · PORTAL OFFEN');
});
