import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { getRuntimeMapDefinition } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { EIFFEL_TOWER_SIEGE_DESTRUCTIBLES } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeDestructibles.js';
import { EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeSecretRoom.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';

// The hidden vault under the Champ-de-Mars. Everything here is authored in map units, exactly like
// `size`, `obstacles` and `portals` of the same preset; the arena multiplies by the map scale while
// it builds. World metres are therefore always "map units x MAP_SCALE", and the checks that talk
// about weapon reach say so explicitly, because a turret range is a world metre distance.

const SIEGE_MAP_KEY = 'eiffel_tower_siege';
const MAP = MAP_PRESET_CATALOG[SIEGE_MAP_KEY];
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

// How far the wreck of a toppled tower reaches from the tower axis, in map units: 218.2 m at the
// authored 0.6 units per metre, the same number the preset test of the collapse derives from the
// baked clips.
const WRECK_REACH = 218.2 * 0.6;

// Half the field. A portal has to keep this much clear of the four side walls.
const HALF_SIZE = MAP.size[0] / 2;
const EDGE_MARGIN = 8;

/** Heading of a point around the tower axis, the `atan2(x, z)` convention the collapses use. */
function heading(x, z) {
    return Math.atan2(x, z);
}

/** Smallest angle between two headings, in degrees. */
function headingGapDeg(a, b) {
    const raw = Math.abs(a - b) % (Math.PI * 2);
    const gap = raw > Math.PI ? Math.PI * 2 - raw : raw;
    return (gap * 180) / Math.PI;
}

/** Distance of a point from a line segment, used for the tapered beam obstacles. */
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

const ROOMS = normalizeSecretRooms(MAP.secretRooms);
const ROOM = ROOMS[0];

test('T-S37a: the siege map carries exactly one secret room with the agreed timings', () => {
    assert.equal(ROOMS.length, 1, 'the preset should offer exactly one room');
    assert.equal(ROOM.id, 'vault');
    assert.deepEqual([...ROOM.modes], ['HUNT', 'ARCADE']);
    assert.equal(ROOM.stayLimitSeconds, 20);
    assert.equal(ROOM.refillSeconds, 30);
    assert.equal(ROOM.unlock.when, 'anyBreak');
    assert.equal(ROOM.unlock.delaySeconds, 4);
    // Eight to twelve points, and at least half of them without a type, so the room keeps drawing
    // from the mode's own weighted choice instead of handing out the same four pickups every time.
    assert.ok(ROOM.items.length >= 8 && ROOM.items.length <= 12, `items: ${ROOM.items.length}`);
    const untyped = ROOM.items.filter((item) => !item.type).length;
    assert.ok(untyped * 2 >= ROOM.items.length, `untyped item points: ${untyped}`);
});

test('T-S37b: the room hangs clear below the arena box', () => {
    const arena = { min: [-HALF_SIZE, 0, -HALF_SIZE], max: [HALF_SIZE, MAP.size[1], HALF_SIZE] };
    // A room that overlaps the arena opens a shaft through the floor, and one that only touches it
    // leaves the normal on the seam undecided. Two map units of rock is the authoring rule.
    assert.ok(ROOM.bounds.max[1] <= arena.min[1] - 2, `ceiling at ${ROOM.bounds.max[1]}`);
    for (let axis = 0; axis < 3; axis += 1) {
        const overlap = axisOverlap(ROOM.bounds.min[axis], ROOM.bounds.max[axis], arena.min[axis], arena.max[axis]);
        if (axis === 1) assert.ok(overlap <= -2, `axis ${axis} overlap ${overlap}`);
    }
    // Clearly larger than a ship on every axis, or the room is a coffin.
    for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(ROOM.bounds.max[axis] - ROOM.bounds.min[axis] >= 10, `axis ${axis} is too thin`);
    }
});

test('T-S37c: the room boxes enclose the bounds without reaching into them', () => {
    assert.equal(EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES.length, 6, 'floor, ceiling and four walls');
    for (const obstacle of EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES) {
        // Both flags: with the GLBs loaded the arena compiles only `compileWithGlb` boxes, and of
        // those it draws only the `renderWithGlb` ones. A wall needs to be seen as well as felt.
        assert.equal(obstacle.compileWithGlb, true, 'room box has to survive the GLB filter');
        assert.equal(obstacle.renderWithGlb, true, 'room box has to stay drawn');
        const box = boxOf(obstacle);
        const overlaps = [0, 1, 2].map((axis) => axisOverlap(
            box.min[axis], box.max[axis], ROOM.bounds.min[axis], ROOM.bounds.max[axis],
        ));
        assert.ok(overlaps.some((value) => value <= 0), `box at ${obstacle.pos} reaches into the room`);
    }
    // Every face of the room is backed by a box that covers the whole face.
    const faces = [[0, 'min'], [0, 'max'], [1, 'min'], [1, 'max'], [2, 'min'], [2, 'max']];
    for (const [axis, side] of faces) {
        const others = [0, 1, 2].filter((value) => value !== axis);
        const covered = EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES.some((obstacle) => {
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

test('T-S37d: the entry portal stands clear of the tower, its wreck and every fall sector', () => {
    const pos = ROOM.entryPortal.pos;
    const radius = Math.hypot(pos[0], pos[2]);
    // Nothing of a collapse settles further out than this, so no fall can ever bury the portal.
    assert.ok(radius > WRECK_REACH, `portal radius ${radius} vs wreck reach ${WRECK_REACH}`);
    assert.ok(Math.abs(pos[0]) <= HALF_SIZE - EDGE_MARGIN, 'portal too close to the x wall');
    assert.ok(Math.abs(pos[2]) <= HALF_SIZE - EDGE_MARGIN, 'portal too close to the z wall');
    // A leg brings the tower down towards its own corner. Standing a quarter turn off those four
    // headings keeps the portal out of the sector a fall sweeps, not merely beyond its reach.
    const portalHeading = heading(pos[0], pos[2]);
    for (const segment of EIFFEL_TOWER_SIEGE_DESTRUCTIBLES.segments) {
        if (!segment.kind.startsWith('leg')) continue;
        const fall = heading(segment.anchor[0], segment.anchor[2]);
        assert.ok(headingGapDeg(portalHeading, fall) >= 30, `segment ${segment.id} falls towards the portal`);
    }
    // And the spot is empty before anything breaks, too: no authored box or beam reaches it.
    for (const obstacle of MAP.obstacles) {
        assert.ok(!obstacleReaches(obstacle, pos, 6), `obstacle at ${obstacle.pos || obstacle.start} blocks the portal`);
    }
});

test('T-S37e: the eject point is out of reach of the room guards and of the wreck', () => {
    const pos = ROOM.ejectPoint.pos;
    assert.ok(Math.hypot(pos[0], pos[2]) > WRECK_REACH, 'eject point stands in the wreck field');
    assert.ok(Math.abs(pos[0]) <= HALF_SIZE - EDGE_MARGIN && Math.abs(pos[2]) <= HALF_SIZE - EDGE_MARGIN);
    for (const entry of MAP.staticTurrets) {
        const turret = normalizeStaticTurretDefinition(entry, 0, { preserveSpatialRange: true });
        // The runtime caps the authored range at 180 map units and then scales it to world metres.
        const reachWorld = Math.min(turret.range, 180) * MAP_SCALE;
        const distanceWorld = Math.hypot(
            (pos[0] - turret.pos[0]) * MAP_SCALE,
            (pos[1] - turret.pos[1]) * MAP_SCALE,
            (pos[2] - turret.pos[2]) * MAP_SCALE,
        );
        assert.ok(distanceWorld > reachWorld, `${turret.id}: ${distanceWorld} m vs ${reachWorld} m reach`);
    }
    // Facing the tower: yaw turns the ship's forward (0, 0, -1) about the up axis.
    const yaw = (ROOM.ejectPoint.yawDeg * Math.PI) / 180;
    const forward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    const toTower = [-pos[0], 0, -pos[2]];
    const length = Math.hypot(toTower[0], toTower[2]);
    const alignment = (forward[0] * toTower[0] + forward[2] * toTower[2]) / length;
    assert.ok(alignment > 0.99, `eject heading looks away from the tower (${alignment})`);
});

test('T-S37f: every item point, the way back and every guard stand inside the room', () => {
    const inside = (point) => [0, 1, 2].every((axis) => point[axis] >= ROOM.bounds.min[axis]
        && point[axis] <= ROOM.bounds.max[axis]);
    assert.ok(inside(ROOM.roomPortal.pos), 'the way back is not in the room');
    for (const item of ROOM.items) assert.ok(inside(item.pos), `item at ${item.pos} is outside`);
    for (const entry of MAP.staticTurrets) assert.ok(inside(entry.pos), `turret ${entry.id} is outside`);
});

test('T-S37g: the guards normalize as destructible emplacements that come back after 45 s', () => {
    const turrets = MAP.staticTurrets.map((entry, index) => normalizeStaticTurretDefinition(entry, index, {
        preserveSpatialRange: true,
    }));
    assert.equal(turrets.length, 3);
    assert.deepEqual(turrets.map((turret) => turret.weapon), ['mg', 'mg', 'rocket']);
    assert.equal(turrets[2].rocketType, 'ROCKET_WEAK');
    for (const turret of turrets) {
        assert.equal(turret.destructible, true);
        assert.equal(turret.maxHp, 45);
        assert.equal(turret.respawnSeconds, 45);
        assert.deepEqual([...turret.allowedModes], ['HUNT', 'ARCADE']);
    }
});

test('T-S37h: the runtime map definition keeps the room and its guards', () => {
    const runtimeMap = getRuntimeMapDefinition(SIEGE_MAP_KEY, MAP_PRESETS);
    assert.ok(runtimeMap, 'the siege map has to reach the runtime');
    assert.equal(normalizeSecretRooms(runtimeMap.secretRooms).length, 1);
    assert.equal(runtimeMap.staticTurrets.length, 3);
});
