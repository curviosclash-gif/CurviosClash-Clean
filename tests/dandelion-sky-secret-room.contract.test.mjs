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
    progress.completedAtSeconds = 41.017;
    arena.glbAnimationElapsedSeconds = 41 + 1 / 60;
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
    const seeds = new DandelionSeedController(result.scene);
    const turretProbes = MAP.staticTurrets.map((entry) => entry.pos);
    const openSkyProbes = [
        [MAP.playerSpawn.x, MAP.playerSpawn.y, MAP.playerSpawn.z],
        ...MAP.botSpawns.map((spawn) => [spawn.x, spawn.y, spawn.z]),
        ...MAP.items.map((entry) => [entry.x, entry.y, entry.z]),
        ...MAP.portals.flatMap((portal) => [portal.a, portal.b]),
        ...MAP.gates.map((entry) => entry.pos),
    ];
    for (const probe of [ROOM.entryPortal.pos, ROOM.ejectPoint.pos, ...turretProbes, ...openSkyProbes]) {
        const point = new THREE.Vector3(...probe);
        assert.equal(hard.some((entry) => sphereIntersectsStaticMeshCollider(
            entry.meshCollider, point, 4,
        )), false, `probe ${probe} intersects hard geometry`);
    }
    // Guards and the chamber portal stand where the crown was; they only appear once it is bare.
    for (const probe of openSkyProbes) {
        assert.equal(seeds.consumeCollision(new THREE.Vector3(...probe), 4, 0), null,
            `probe ${probe} touches an attached seed`);
    }
});

test('every start is equally far from the others and has a pickup within reach', () => {
    const starts = [MAP.playerSpawn, ...MAP.botSpawns].map((spawn) => [spawn.x, spawn.y, spawn.z]);
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(MAP.botSpawns.length >= 7, 'eight players never share a start');
    const items = MAP.items.map((entry) => [entry.x, entry.y, entry.z]);
    const portalEnds = MAP.portals.flatMap((portal) => [portal.a, portal.b]);
    for (const start of starts) {
        const nearestStart = Math.min(...starts.filter((other) => other !== start)
            .map((other) => distance(start, other)));
        assert.ok(nearestStart > 90, `start ${start} is only ${nearestStart.toFixed(0)} from another`);
        const nearestItem = Math.min(...items.map((item) => distance(start, item)));
        assert.ok(nearestItem < 70, `start ${start} has no pickup nearby (${nearestItem.toFixed(0)})`);
        const nearestPortal = Math.min(...portalEnds.map((end) => distance(start, end)));
        assert.ok(nearestPortal > 30, `start ${start} sits on a portal`);
    }
    // The first bots of a small match must not start next to the player.
    const player = starts[0];
    for (const spawn of starts.slice(1, 5)) {
        assert.ok(distance(player, spawn) > 200, `early bot start ${spawn} crowds the player`);
    }
    assert.ok(MAP.items.length >= 12, 'the widest map on the list needs more than a handful of pickups');
});

test('the chamber guards cover the whole approach to the entry portal', () => {
    const turrets = MAP.staticTurrets.map((entry) => normalizeStaticTurretDefinition(
        entry, 0, { preserveSpatialRange: true },
    ));
    const portal = ROOM.entryPortal.pos;
    // A ring around the portal at the distance a visitor commits to his run.
    for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        const point = [portal[0] + Math.cos(angle) * 60, portal[1], portal[2] + Math.sin(angle) * 60];
        const covering = turrets.filter((turret) => Math.hypot(
            ...point.map((value, axis) => value - turret.pos[axis]),
        ) < turret.range).length;
        assert.ok(covering >= 2, `approach ${point.map(Math.round)} is covered by ${covering} guard(s)`);
    }
});

test('the HUD projection reports seed progress and announces the open portal', () => {
    const partial = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        dandelionSeeds: { total: 220, released: 137, allReleased: false },
    });
    assert.deepEqual(partial.dandelionSeeds, {
        active: true, source: 'dandelionSeeds', total: 220, released: 137, remaining: 83,
        allReleased: false, completedAtSeconds: 0, portalOpen: false, portalPosition: null,
    });
    assert.equal(formatDandelionSeedStatus(partial.dandelionSeeds),
        'PUSTEBLUME · 137/220 SAMEN → WURZELKAMMER');

    const complete = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        dandelionSeeds: { total: 220, released: 220, allReleased: true, completedAtSeconds: 42 },
    });
    assert.equal(formatDandelionSeedStatus(complete.dandelionSeeds), 'ALLE SAMEN GELÖST · PORTAL ÖFFNET');

    const open = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        dandelionSeeds: {
            total: 220, released: 220, allReleased: true, completedAtSeconds: 42,
            portalOpen: true, portalPosition: { x: 117, y: 954, z: 0 },
        },
    });
    assert.equal(formatDandelionSeedStatus(open.dandelionSeeds), 'PORTAL OFFEN · WURZELKAMMER');
    assert.deepEqual(open.dandelionSeeds.portalPosition, { x: 117, y: 954, z: 0 });
});
