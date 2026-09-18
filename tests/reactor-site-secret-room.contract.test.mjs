import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { getRuntimeMapDefinition } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { REACTOR_SITE_DESTRUCTIBLES } from '../src/core/config/maps/presets/reactor_site/ReactorSiteDestructibles.js';
import { REACTOR_SITE_SECRET_ROOM_OBSTACLES } from '../src/core/config/maps/presets/reactor_site/ReactorSiteSecretRoom.js';
import { REACTOR_HALF_SIZE, METRE } from '../src/core/config/maps/presets/reactor_site/ReactorSiteStructure.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import {
    PLAYABLE_VOLUME_INSIDE,
    probeArenaPlayableVolumes,
    resolveArenaPlayableVolumes,
} from '../src/entities/arena/ArenaPlayableVolumes.js';

// The bunker under the reactor site. Everything the preset authors is in map units, exactly like
// `size`, `obstacles` and `gates` of the same file; the arena multiplies by the map scale while it
// builds. World metres are therefore always "map units x MAP_SCALE", and every check that talks
// about weapon reach says so, because a turret range is a distance in world metres.

const REACTOR_MAP_KEY = 'reactor_site';
const MAP = MAP_PRESET_CATALOG[REACTOR_MAP_KEY];
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

const EDGE_MARGIN = 8;

/**
 * How far each break throws concrete, measured from that segment's own anchor, in real metres -
 * the numbers ReactorSiteStructure.js derives the field width from, plus the containment.
 *
 * The containment does not topple. Its clip drops a ruin where the block stood and sends up a
 * mushroom cloud whose fireball, stem, cap and base surge are all authored decorative, so they
 * carry the `_nocol` marker and collide with nothing at all. What stays solid is the block's own
 * footprint, and the widest part of that footprint - the northern wing - ends 36 map units, that
 * is 60 m, from the centre.
 */
const FALL_REACH_METRES = Object.freeze({
    cooling_tower_w: 115.2,
    cooling_tower_e: 115.2,
    vent_stack: 88.4,
    turbine_hall: 88.4,
    reactor_dome: 60,
});

/** Distance of a point from a line segment, used for the beam-shaped fallback obstacles. */
function distanceToSegment(point, start, end) {
    const ax = end[0] - start[0];
    const ay = end[1] - start[1];
    const az = end[2] - start[2];
    const lengthSq = ax * ax + ay * ay + az * az;
    let t = 0;
    if (lengthSq > 0) {
        t = ((point[0] - start[0]) * ax + (point[1] - start[1]) * ay + (point[2] - start[2]) * az) / lengthSq;
        t = Math.max(0, Math.min(1, t));
    }
    const dx = point[0] - (start[0] + ax * t);
    const dy = point[1] - (start[1] + ay * t);
    const dz = point[2] - (start[2] + az * t);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Whether an authored obstacle reaches within `clearance` map units of a point. */
function obstacleReaches(obstacle, point, clearance) {
    const shape = String(obstacle?.shape || '').toLowerCase();
    if (shape === 'beam' || shape === 'tube') {
        const radius = Number(obstacle.radius) || 0;
        return distanceToSegment(point, obstacle.start, obstacle.end) <= radius + clearance;
    }
    if (!Array.isArray(obstacle?.pos) || !Array.isArray(obstacle?.size)) return false;
    for (let axis = 0; axis < 3; axis += 1) {
        const half = obstacle.size[axis] / 2 + clearance;
        if (Math.abs(point[axis] - obstacle.pos[axis]) > half) return false;
    }
    return true;
}

/** Overlap of two boxes on one axis; zero or less means they only touch or stand apart. */
function axisOverlap(aMin, aMax, bMin, bMax) {
    return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function boxOf(obstacle) {
    return {
        min: [0, 1, 2].map((axis) => obstacle.pos[axis] - obstacle.size[axis] / 2),
        max: [0, 1, 2].map((axis) => obstacle.pos[axis] + obstacle.size[axis] / 2),
    };
}

/** Horizontal distance of a point from a segment anchor, in map units. */
function groundDistance(point, anchor) {
    return Math.hypot(point[0] - anchor[0], point[2] - anchor[2]);
}

const ROOMS = normalizeSecretRooms(MAP.secretRooms);
const ROOM = ROOMS[0];

test('T-S38a: the reactor site carries exactly one secret room with the agreed timings', () => {
    assert.equal(ROOMS.length, 1, 'the preset should offer exactly one room');
    assert.equal(ROOM.id, 'bunker');
    assert.deepEqual([...ROOM.modes], ['HUNT', 'ARCADE']);
    assert.equal(ROOM.stayLimitSeconds, 20);
    assert.equal(ROOM.refillSeconds, 30);
    // Five structures share one destructible block with no id of its own, so the map cannot name
    // one of them: whichever breaks first opens the portal, four seconds later.
    assert.equal(ROOM.unlock.when, 'anyBreak');
    assert.equal(ROOM.unlock.delaySeconds, 4);
    assert.ok(ROOM.items.length >= 8 && ROOM.items.length <= 12, `items: ${ROOM.items.length}`);
    const untyped = ROOM.items.filter((item) => !item.type).length;
    assert.ok(untyped * 2 >= ROOM.items.length, `untyped item points: ${untyped}`);
});

test('T-S38b: the room hangs clear below the arena box', () => {
    const arena = { min: [-REACTOR_HALF_SIZE, 0, -REACTOR_HALF_SIZE], max: [REACTOR_HALF_SIZE, MAP.size[1], REACTOR_HALF_SIZE] };
    // A room that overlaps the arena opens a shaft through the floor, and one that only touches it
    // leaves the normal on the seam undecided. Two map units of rock is the authoring rule.
    assert.ok(ROOM.bounds.max[1] <= arena.min[1] - 2, `ceiling at ${ROOM.bounds.max[1]}`);
    const verticalOverlap = axisOverlap(ROOM.bounds.min[1], ROOM.bounds.max[1], arena.min[1], arena.max[1]);
    assert.ok(verticalOverlap <= -2, `vertical overlap ${verticalOverlap}`);
    // Clearly larger than a ship on every axis, or the room is a coffin.
    for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(ROOM.bounds.max[axis] - ROOM.bounds.min[axis] >= 10, `axis ${axis} is too thin`);
    }
});

test('T-S38c: the room boxes enclose the bounds without reaching into them', () => {
    assert.equal(REACTOR_SITE_SECRET_ROOM_OBSTACLES.length, 6, 'floor, ceiling and four walls');
    for (const obstacle of REACTOR_SITE_SECRET_ROOM_OBSTACLES) {
        // This map keeps its authored boxes as collision only beside the GLBs
        // (`glbAuthoredObstaclesCollisionOnly`), and with a scene collider it compiles only the
        // boxes marked `compileWithGlb`. The per-box `renderWithGlb` is what wins the visuals back,
        // and no GLB draws this room, so a wall needs both flags to be seen as well as felt.
        assert.equal(obstacle.compileWithGlb, true, 'room box has to survive the GLB filter');
        assert.equal(obstacle.renderWithGlb, true, 'room box has to stay drawn');
        const box = boxOf(obstacle);
        const overlaps = [0, 1, 2].map((axis) => axisOverlap(
            box.min[axis], box.max[axis], ROOM.bounds.min[axis], ROOM.bounds.max[axis],
        ));
        assert.ok(overlaps.some((value) => value <= 0), `box at ${obstacle.pos} reaches into the room`);
    }
    const faces = [[0, 'min'], [0, 'max'], [1, 'min'], [1, 'max'], [2, 'min'], [2, 'max']];
    for (const [axis, side] of faces) {
        const others = [0, 1, 2].filter((value) => value !== axis);
        const covered = REACTOR_SITE_SECRET_ROOM_OBSTACLES.some((obstacle) => {
            const box = boxOf(obstacle);
            const touches = side === 'min'
                ? Math.abs(box.max[axis] - ROOM.bounds.min[axis]) < 1e-6
                : Math.abs(box.min[axis] - ROOM.bounds.max[axis]) < 1e-6;
            if (!touches) return false;
            return others.every((other) => box.min[other] <= ROOM.bounds.min[other]
                && box.max[other] >= ROOM.bounds.max[other]);
        });
        assert.ok(covered, `face ${side} of axis ${axis} is open`);
    }
});

test('T-S38d: the entry portal stands clear of every structure and of everything it drops', () => {
    const pos = ROOM.entryPortal.pos;
    // The portal has a fixed place here, the same one whichever of the five structures breaks
    // first, so it has to stand outside all five wreck fields at once.
    for (const segment of REACTOR_SITE_DESTRUCTIBLES.segments) {
        const reach = FALL_REACH_METRES[segment.id] * METRE;
        assert.ok(Number.isFinite(reach), `segment ${segment.id} has no reach on record`);
        const distance = groundDistance(pos, segment.anchor);
        assert.ok(distance > reach, `${segment.id}: portal ${distance.toFixed(1)} vs reach ${reach.toFixed(1)}`);
    }
    assert.ok(Math.abs(pos[0]) <= REACTOR_HALF_SIZE - EDGE_MARGIN, 'portal too close to the x wall');
    assert.ok(Math.abs(pos[2]) <= REACTOR_HALF_SIZE - EDGE_MARGIN, 'portal too close to the z wall');
    // And the spot is empty before anything breaks, too: no authored box or beam reaches it.
    for (const obstacle of MAP.obstacles) {
        assert.ok(!obstacleReaches(obstacle, pos, 6), `obstacle at ${obstacle.pos || obstacle.start} blocks the portal`);
    }
});

test('T-S38e: the eject point is out of reach of the room guards and of every wreck', () => {
    const pos = ROOM.ejectPoint.pos;
    for (const segment of REACTOR_SITE_DESTRUCTIBLES.segments) {
        const reach = FALL_REACH_METRES[segment.id] * METRE;
        const distance = groundDistance(pos, segment.anchor);
        assert.ok(distance > reach, `${segment.id}: eject ${distance.toFixed(1)} vs reach ${reach.toFixed(1)}`);
    }
    assert.ok(Math.abs(pos[0]) <= REACTOR_HALF_SIZE - EDGE_MARGIN && Math.abs(pos[2]) <= REACTOR_HALF_SIZE - EDGE_MARGIN);
    for (const entry of MAP.staticTurrets) {
        const turret = normalizeStaticTurretDefinition(entry, 0, { preserveSpatialRange: true });
        // The runtime caps the authored range at 180 map units and then scales it to world metres.
        const reachWorld = Math.min(turret.range, 180) * MAP_SCALE;
        const distanceWorld = Math.hypot(
            (pos[0] - turret.pos[0]) * MAP_SCALE,
            (pos[1] - turret.pos[1]) * MAP_SCALE,
            (pos[2] - turret.pos[2]) * MAP_SCALE,
        );
        assert.ok(distanceWorld > reachWorld, `${turret.id}: ${distanceWorld.toFixed(0)} m vs ${reachWorld.toFixed(0)} m reach`);
    }
    // Facing the reactor: yaw turns the ship's forward (0, 0, -1) about the up axis.
    const yaw = (ROOM.ejectPoint.yawDeg * Math.PI) / 180;
    const forward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    const toReactor = [-pos[0], 0, -pos[2]];
    const length = Math.hypot(toReactor[0], toReactor[2]);
    const alignment = (forward[0] * toReactor[0] + forward[2] * toReactor[2]) / length;
    assert.ok(alignment > 0.99, `eject heading looks away from the reactor (${alignment})`);
});

test('T-S38f: every item point, the way back and every guard stand inside the room', () => {
    const inside = (point) => [0, 1, 2].every((axis) => point[axis] >= ROOM.bounds.min[axis]
        && point[axis] <= ROOM.bounds.max[axis]);
    assert.ok(inside(ROOM.roomPortal.pos), 'the way back is not in the room');
    for (const item of ROOM.items) assert.ok(inside(item.pos), `item at ${item.pos} is outside`);
    for (const entry of MAP.staticTurrets) assert.ok(inside(entry.pos), `turret ${entry.id} is outside`);
});

test('T-S38g: the guards normalize as destructible emplacements that come back after 45 s', () => {
    const turrets = MAP.staticTurrets.map((entry, index) => normalizeStaticTurretDefinition(entry, index, {
        preserveSpatialRange: true,
    }));
    assert.equal(turrets.length, 3);
    assert.equal(new Set(turrets.map((turret) => turret.id)).size, 3, 'guard ids stay unique');
    assert.deepEqual(turrets.map((turret) => turret.weapon), ['mg', 'mg', 'rocket']);
    assert.equal(turrets[2].rocketType, 'ROCKET_WEAK');
    for (const turret of turrets) {
        assert.equal(turret.destructible, true);
        assert.equal(turret.maxHp, 45);
        assert.equal(turret.respawnSeconds, 45);
        assert.deepEqual([...turret.allowedModes], ['HUNT', 'ARCADE']);
    }
});

test('T-S38h: the runtime map definition keeps the room and its guards', () => {
    const runtimeMap = getRuntimeMapDefinition(REACTOR_MAP_KEY, MAP_PRESETS);
    assert.ok(runtimeMap, 'the reactor site has to reach the runtime');
    assert.equal(normalizeSecretRooms(runtimeMap.secretRooms).length, 1);
    assert.equal(runtimeMap.staticTurrets.length, 3);
});

test('T-S38i: a visitor of the room is not standing in the exclusion zone', () => {
    // The map opens four side faces and the ceiling, so its floor is a closed face already - but
    // the exclusion zone asks `ArenaPlayableVolumes` first, and that is what has to answer "in a
    // room" for the buried box. The volumes are world metres, so the room travels by the map scale.
    const volumes = resolveArenaPlayableVolumes(MAP, MAP_SCALE);
    assert.equal(volumes.length, 1, 'the arena should know exactly one extra volume');
    const centre = {
        x: ((ROOM.bounds.min[0] + ROOM.bounds.max[0]) / 2) * MAP_SCALE,
        y: ((ROOM.bounds.min[1] + ROOM.bounds.max[1]) / 2) * MAP_SCALE,
        z: ((ROOM.bounds.min[2] + ROOM.bounds.max[2]) / 2) * MAP_SCALE,
    };
    assert.equal(probeArenaPlayableVolumes(volumes, centre), PLAYABLE_VOLUME_INSIDE);
    // The rock between the arena floor and the room ceiling stays rock, or the room would be a
    // shaft rather than a secret.
    const inRock = { x: centre.x, y: (ROOM.bounds.max[1] + 1) * MAP_SCALE, z: centre.z };
    assert.notEqual(probeArenaPlayableVolumes(volumes, inRock), PLAYABLE_VOLUME_INSIDE);
});
