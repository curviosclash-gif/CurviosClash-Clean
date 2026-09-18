import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { Arena } from '../src/entities/Arena.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ArenaExpansionController } from '../src/entities/arena/ArenaExpansionController.js';
import {
    PLAYABLE_VOLUME_INSIDE,
    PLAYABLE_VOLUME_OUTSIDE,
    PLAYABLE_VOLUME_WALL,
    probeArenaPlayableVolumes,
    resolveArenaPlayableVolumes,
} from '../src/entities/arena/ArenaPlayableVolumes.js';
import { ExclusionZoneSystem, EXCLUSION_ZONE_PHASES } from '../src/entities/systems/ExclusionZoneSystem.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const BOUNDS = Object.freeze({ minX: -40, maxX: 40, minY: 0, maxY: 30, minZ: -40, maxZ: 40 });

// Probe table of the bounds check, recorded from a run before playable volumes existed. Rows are
// [openFaces, mode, name, hit, kind, normal, checkCollisionFast]. A map without rooms has to keep
// answering exactly this, which is what makes the empty list a real early exit and not a rewrite.
const BASELINE_PROBES = Object.freeze([
    ['centre', 0, 15, 0],
    ['near minX', -39.5, 15, 0],
    ['near maxX', 39.5, 15, 0],
    ['near floor', 0, 0.5, 0],
    ['near ceiling', 0, 29.5, 0],
    ['near minZ', 0, 15, -39.5],
    ['near maxZ', 0, 15, 39.5],
    ['room centre', 0, -15, 0],
    ['room wall', 9.5, -15, 0],
    ['between floor and room', 0, -2.5, 0],
    ['far outside maxX', 60, 15, 0],
    ['far below', 0, -60, 0],
]);

const BASELINE_RESULTS = Object.freeze([
    ['closed', 'player', 'centre', false, '', '', false],
    ['closed', 'player', 'near minX', true, 'wall', '1,0,0', true],
    ['closed', 'player', 'near maxX', true, 'wall', '-1,0,0', true],
    ['closed', 'player', 'near floor', true, 'wall', '0,1,0', true],
    ['closed', 'player', 'near ceiling', true, 'wall', '0,-1,0', true],
    ['closed', 'player', 'near minZ', true, 'wall', '0,0,1', true],
    ['closed', 'player', 'near maxZ', true, 'wall', '0,0,-1', true],
    ['closed', 'player', 'room centre', true, 'wall', '0,1,0', true],
    ['closed', 'player', 'room wall', true, 'wall', '0,1,0', true],
    ['closed', 'player', 'between floor and room', true, 'wall', '0,1,0', true],
    ['closed', 'player', 'far outside maxX', true, 'wall', '-1,0,0', true],
    ['closed', 'player', 'far below', true, 'wall', '0,1,0', true],
    ['closed', 'bot', 'centre', false, '', '', false],
    ['closed', 'bot', 'near minX', true, 'wall', '1,0,0', true],
    ['closed', 'bot', 'near maxX', true, 'wall', '-1,0,0', true],
    ['closed', 'bot', 'near floor', true, 'wall', '0,1,0', true],
    ['closed', 'bot', 'near ceiling', true, 'wall', '0,-1,0', true],
    ['closed', 'bot', 'near minZ', true, 'wall', '0,0,1', true],
    ['closed', 'bot', 'near maxZ', true, 'wall', '0,0,-1', true],
    ['closed', 'bot', 'room centre', true, 'wall', '0,1,0', true],
    ['closed', 'bot', 'room wall', true, 'wall', '0,1,0', true],
    ['closed', 'bot', 'between floor and room', true, 'wall', '0,1,0', true],
    ['closed', 'bot', 'far outside maxX', true, 'wall', '-1,0,0', true],
    ['closed', 'bot', 'far below', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'player', 'centre', false, '', '', false],
    ['maxX+maxY', 'player', 'near minX', true, 'wall', '1,0,0', true],
    ['maxX+maxY', 'player', 'near maxX', false, '', '', false],
    ['maxX+maxY', 'player', 'near floor', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'player', 'near ceiling', false, '', '', false],
    ['maxX+maxY', 'player', 'near minZ', true, 'wall', '0,0,1', true],
    ['maxX+maxY', 'player', 'near maxZ', true, 'wall', '0,0,-1', true],
    ['maxX+maxY', 'player', 'room centre', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'player', 'room wall', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'player', 'between floor and room', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'player', 'far outside maxX', false, '', '', false],
    ['maxX+maxY', 'player', 'far below', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'bot', 'centre', false, '', '', false],
    ['maxX+maxY', 'bot', 'near minX', true, 'wall', '1,0,0', true],
    ['maxX+maxY', 'bot', 'near maxX', true, 'wall', '-1,0,0', true],
    ['maxX+maxY', 'bot', 'near floor', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'bot', 'near ceiling', true, 'wall', '0,-1,0', true],
    ['maxX+maxY', 'bot', 'near minZ', true, 'wall', '0,0,1', true],
    ['maxX+maxY', 'bot', 'near maxZ', true, 'wall', '0,0,-1', true],
    ['maxX+maxY', 'bot', 'room centre', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'bot', 'room wall', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'bot', 'between floor and room', true, 'wall', '0,1,0', true],
    ['maxX+maxY', 'bot', 'far outside maxX', true, 'wall', '-1,0,0', true],
    ['maxX+maxY', 'bot', 'far below', true, 'wall', '0,1,0', true],
]);

/** The room of the collision probes, in the same world units as BOUNDS: a cellar under the floor. */
const ROOM_VOLUME = Object.freeze({ minX: -10, maxX: 10, minY: -25, maxY: -5, minZ: -10, maxZ: 10 });

/**
 * Authored room block of a map, in map units. `roomPortal` has to sit inside the room and both
 * `entryPortal` and `ejectPoint` outside it, or the contract drops the whole room.
 */
function authoredRoom(overrides = {}) {
    return {
        id: 'cellar',
        bounds: { min: [-10, -25, -10], max: [10, -5, 10] },
        roomPortal: { pos: [0, -15, 0] },
        entryPortal: { pos: [0, 10, 0] },
        ejectPoint: { pos: [0, 12, 0] },
        ...overrides,
    };
}

function probeRow(collision, openFacesLabel, mode, name, x, y, z) {
    const point = new Vector3(x, y, z);
    const info = mode === 'bot' ? collision.getBotCollisionInfo(point, 1) : collision.getCollisionInfo(point, 1);
    const fast = mode === 'bot' ? collision.checkBotCollisionFast(point, 1) : collision.checkCollisionFast(point, 1);
    return [
        openFacesLabel,
        mode,
        name,
        !!info?.hit,
        info?.kind || '',
        info ? info.normal.toArray().join(',') : '',
        fast,
    ];
}

function collectProbeTable(playableVolumes) {
    const rows = [];
    for (const openFaces of [null, ['maxX', 'maxY']]) {
        const arena = { bounds: BOUNDS, obstacles: [], playableVolumes };
        if (openFaces) arena.openFaces = openFaces;
        const collision = new ArenaCollision(arena);
        for (const mode of ['player', 'bot']) {
            for (const [name, x, y, z] of BASELINE_PROBES) {
                rows.push(probeRow(collision, openFaces ? openFaces.join('+') : 'closed', mode, name, x, y, z));
            }
        }
    }
    return rows;
}

function createHeadlessArena() {
    const arena = new Arena({
        addToScene() {},
        removeFromScene() {},
        setMapLighting() {},
        setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; },
        getMaxAnisotropy() { return 1; },
    });
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    return arena;
}

test('without rooms every bounds answer stays exactly what it was', () => {
    assert.deepEqual(collectProbeTable(undefined), BASELINE_RESULTS.map((row) => [...row]));
    assert.deepEqual(collectProbeTable([]), BASELINE_RESULTS.map((row) => [...row]));
});

test('a room under the floor is playable while the ground above it stays solid', () => {
    const arena = { bounds: BOUNDS, obstacles: [], playableVolumes: [ROOM_VOLUME] };
    const collision = new ArenaCollision(arena);

    const centre = new Vector3(0, -15, 0);
    assert.equal(collision.getCollisionInfo(centre, 1), null, 'the middle of the room is free');
    assert.equal(collision.checkCollisionFast(centre, 1), false);
    assert.equal(collision.getBotCollisionInfo(centre, 1), null, 'bots read the same volume');
    assert.equal(collision.checkBotCollisionFast(centre, 1), false);

    const atSideWall = collision.getCollisionInfo(new Vector3(9.5, -15, 0), 1);
    assert.equal(atSideWall?.kind, 'wall', 'a room wall stops like an arena wall');
    assert.deepEqual(atSideWall.normal.toArray(), [-1, 0, 0], 'the normal points back into the room');

    const atRoomFloor = collision.getCollisionInfo(new Vector3(0, -24.5, 0), 1);
    assert.deepEqual(atRoomFloor?.normal.toArray(), [0, 1, 0]);

    const atRoomCeiling = collision.getCollisionInfo(new Vector3(0, -5.5, 0), 1);
    assert.deepEqual(atRoomCeiling?.normal.toArray(), [0, -1, 0]);

    // The only way in is a teleport, so the rock between arena floor and room ceiling stays shut.
    // Probed down to one radius above the ceiling; from there on the room wall answers (see the
    // wall-band test below).
    for (const y of [-0.5, -2, -3.9]) {
        const between = collision.getCollisionInfo(new Vector3(0, y, 0), 1);
        assert.deepEqual(between?.normal.toArray(), [0, 1, 0], `y=${y} is still the arena floor`);
        assert.equal(collision.checkCollisionFast(new Vector3(0, y, 0), 1), true);
    }

    assert.equal(collision.getCollisionInfo(new Vector3(0, 15, 0), 1), null, 'the arena itself is unchanged');
    assert.deepEqual(
        collision.getCollisionInfo(new Vector3(0, 0.5, 0), 1)?.normal.toArray(),
        [0, 1, 0],
        'the arena floor still answers for a point above it',
    );
});

test('a probe that reaches a room wall from outside is pushed back into the room', () => {
    const arena = { bounds: BOUNDS, obstacles: [], playableVolumes: [ROOM_VOLUME] };
    const collision = new ArenaCollision(arena);
    const out = new Vector3();

    // The collision phase probes ahead of the ship, so the probe point regularly sits behind the
    // wall rather than on it. How far behind a room still answers is its probe radius, exactly like
    // the arena's own walls: one unit behind the wall needs a radius above one, three units a radius
    // above three. Without the room the arena floor would answer all of these with 0,1,0.
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(11, -15, 0), 1.5, out), PLAYABLE_VOLUME_WALL);
    assert.deepEqual(out.toArray(), [-1, 0, 0], 'one unit behind the side wall');
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(13, -15, 0), 3.5, out), PLAYABLE_VOLUME_WALL);
    assert.deepEqual(out.toArray(), [-1, 0, 0], 'three units behind the side wall');
    assert.deepEqual(
        collision.getCollisionInfo(new Vector3(11, -15, 0), 1.5)?.normal.toArray(),
        [-1, 0, 0],
        'and the same through the arena, which is what the bounce reads',
    );

    // Out of reach of the room: solid rock that belongs to nobody, so the arena answers again.
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(14, -15, 0), 1.5), PLAYABLE_VOLUME_OUTSIDE);
    assert.deepEqual(collision.getCollisionInfo(new Vector3(14, -15, 0), 1.5)?.normal.toArray(), [0, 1, 0]);

    // Just above the room ceiling the sphere already sticks into the room. Only a ship that came
    // out of the room can be there - the rock below the arena floor keeps pushing upwards - so the
    // useful answer is the one that puts it back where it came from.
    assert.deepEqual(collision.getCollisionInfo(new Vector3(0, -4.5, 0), 1)?.normal.toArray(), [0, -1, 0]);
    assert.deepEqual(
        collision.getCollisionInfo(new Vector3(0, -4, 0), 1)?.normal.toArray(),
        [0, 1, 0],
        'a full radius above the ceiling the rock answers again',
    );

    // A corner reaches two walls at once. The deeper crossing wins, which keeps the answer stable
    // instead of flipping between two faces from frame to frame.
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(11, -4.5, 0), 1.5, out), PLAYABLE_VOLUME_WALL);
    assert.deepEqual(out.toArray(), [-1, 0, 0], 'one unit past the side wall beats half a unit past the ceiling');
});

test('the volume probe answers inside, wall and outside', () => {
    const out = new Vector3();
    assert.equal(probeArenaPlayableVolumes([], new Vector3(0, -15, 0), 1), PLAYABLE_VOLUME_OUTSIDE);
    assert.equal(probeArenaPlayableVolumes(undefined, new Vector3(0, -15, 0), 1), PLAYABLE_VOLUME_OUTSIDE);
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(0, -15, 0), 1), PLAYABLE_VOLUME_INSIDE);
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(0, -2, 0), 1), PLAYABLE_VOLUME_OUTSIDE);
    assert.equal(probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(9.5, -15, 0), 1, out), PLAYABLE_VOLUME_WALL);
    assert.deepEqual(out.toArray(), [-1, 0, 0]);
    assert.equal(
        probeArenaPlayableVolumes([ROOM_VOLUME], new Vector3(9.5, -15, 0), 0),
        PLAYABLE_VOLUME_INSIDE,
        'without a radius the wall contact is still a point inside the room',
    );
});

test('the arena reads its rooms from the map and scales them like its own bounds', async () => {
    const arena = createHeadlessArena();
    arena.runtimeMapKey = 'secret-room-probe';
    arena.runtimeMapDefinition = {
        size: [100, 40, 100],
        obstacles: [],
        portals: [],
        gates: [],
        secretRooms: [authoredRoom()],
    };
    const { scale } = await arena.build(arena.runtimeMapKey);
    assert.ok(scale > 1, 'the probe map is scaled, so the rooms have to be scaled as well');

    assert.deepEqual(arena.playableVolumes.map((volume) => ({ ...volume })), [{
        minX: -10 * scale, maxX: 10 * scale,
        minY: -25 * scale, maxY: -5 * scale,
        minZ: -10 * scale, maxZ: 10 * scale,
    }]);

    assert.equal(arena.checkCollisionFast(new Vector3(0, -15 * scale, 0), 1), false, 'the room is flyable');
    assert.equal(arena.checkCollisionFast(new Vector3(0, -2 * scale, 0), 1), true, 'the ground above it is not');

    // The next map has no rooms, so nothing of this one may survive the rebuild.
    arena.runtimeMapKey = 'plain-probe';
    arena.runtimeMapDefinition = { size: [100, 40, 100], obstacles: [], portals: [], gates: [] };
    await arena.build(arena.runtimeMapKey);
    assert.deepEqual(arena.playableVolumes, []);
    assert.equal(arena.checkCollisionFast(new Vector3(0, -15 * scale, 0), 1), true, 'the room is gone with its map');
});

test('broken, surplus and missing room data never reach the arena', () => {
    assert.deepEqual(resolveArenaPlayableVolumes(null, 3), []);
    assert.deepEqual(resolveArenaPlayableVolumes({}, 3), []);
    assert.deepEqual(resolveArenaPlayableVolumes({ secretRooms: 'nonsense' }, 3), []);
    assert.deepEqual(
        resolveArenaPlayableVolumes({ secretRooms: [{ id: 'broken' }, authoredRoom()] }, 1),
        [{ minX: -10, maxX: 10, minY: -25, maxY: -5, minZ: -10, maxZ: 10 }],
        'a room without usable bounds is dropped, the sound one stays',
    );

    const many = [0, 1, 2, 3, 4].map((index) => authoredRoom({ id: `cellar-${index}` }));
    assert.equal(resolveArenaPlayableVolumes({ secretRooms: many }, 1).length, 3, 'at most three rooms');
});

test('a growing map replaces only its main box and leaves the rooms standing', () => {
    const full = { minX: -50, maxX: 50, minY: 0, maxY: 60, minZ: -50, maxZ: 50 };
    const arena = { bounds: { ...full }, openFaces: [], obstacles: [], playableVolumes: [ROOM_VOLUME] };
    const collision = new ArenaCollision(arena);
    const controller = new ArenaExpansionController(arena);
    assert.equal(controller.build({ expansion: { stages: [{ size: [40, 20, 40] }, { atSeconds: 30, size: [100, 60, 100] }] } }, 1), true);

    assert.equal(arena.bounds.maxX, 20, 'the first stage shrank the main box');
    assert.equal(arena.playableVolumes.length, 1, 'the rooms are none of the expansion controller business');
    assert.equal(collision.checkCollisionFast(new Vector3(0, -15, 0), 1), false, 'the room stays open on stage one');
    assert.equal(collision.checkCollisionFast(new Vector3(30, 10, 0), 1), true, 'the stage wall still closes');

    controller.update(31);
    assert.equal(arena.bounds.maxX, 50);
    assert.equal(collision.checkCollisionFast(new Vector3(0, -15, 0), 1), false, 'and on the grown stage too');
});

test('a player inside a room is not treated as outside the arena', () => {
    // A room beside the open face: leaving through that face starts the exclusion zone, being in
    // the room must not.
    const sideRoom = Object.freeze({ minX: 60, maxX: 90, minY: 0, maxY: 20, minZ: -10, maxZ: 10 });
    const arena = {
        bounds: BOUNDS,
        obstacles: [],
        openFaces: ['maxX'],
        playableVolumes: [sideRoom],
    };
    const players = [{
        index: 0,
        alive: true,
        hitboxRadius: 1,
        spawnProtectionTimer: 0,
        position: new Vector3(75, 10, 0),
    }];
    const manager = { arena, players, audio: { play() {} } };
    const system = new ExclusionZoneSystem(manager, { projectileSystem: null });

    system.update(1);
    assert.equal(players[0].exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SAFE, 'the room is a safe place');

    players[0].position.set(75, 10, 30);
    system.update(1);
    assert.equal(
        players[0].exclusionZoneState.phase,
        EXCLUSION_ZONE_PHASES.GRACE,
        'the same distance outside the arena but next to the room still starts the countdown',
    );

    // Reaching the room ends the zone, countdown and salvos alike, and the clock starts from zero
    // on the next trip out - otherwise a visitor would be shot at the moment he arrives.
    players[0].position.set(75, 10, 0);
    system.update(1);
    assert.equal(players[0].exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SAFE);
    assert.equal(players[0].exclusionZoneState.elapsedSeconds, 0, 'the countdown is forgotten');

    players[0].position.set(75, 10, 30);
    system.update(6);
    assert.equal(players[0].exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SALVO, 'outside long enough to be shot at');
    players[0].position.set(75, 10, 0);
    system.update(1);
    assert.equal(players[0].exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SAFE, 'the room stops the salvos too');
    assert.equal(players[0].exclusionZoneState.elapsedSeconds, 0);
});
