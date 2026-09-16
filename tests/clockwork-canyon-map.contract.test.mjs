import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CLOCKWORK_CANYON_MAPS } from '../src/core/config/maps/presets/clockwork_canyon/index.js';

const map = CLOCKWORK_CANYON_MAPS.clockwork_canyon;

const BOUNDS = { minX: -75, maxX: 75, minY: 0, maxY: 70, minZ: -75, maxZ: 75 };
const CLEARANCE = 5;

function boxAABB(box) {
    const [cx, cy, cz] = box.pos;
    const [sx, sy, sz] = box.size;
    return {
        min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
        max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
    };
}

function isTube(obstacle) {
    return obstacle.shape === 'tube';
}

function distancePointToAABB(point, aabb) {
    let sum = 0;
    for (let axis = 0; axis < 3; axis += 1) {
        const d = Math.max(aabb.min[axis] - point[axis], 0, point[axis] - aabb.max[axis]);
        sum += d * d;
    }
    return Math.sqrt(sum);
}

function pointInAABB(point, aabb, epsilon = 1e-6) {
    return point.every((value, axis) => value >= aabb.min[axis] - epsilon && value <= aabb.max[axis] + epsilon);
}

function distancePointToSegment(point, start, end) {
    const ab = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const ap = [point[0] - start[0], point[1] - start[1], point[2] - start[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq));
    const closest = [start[0] + ab[0] * t, start[1] + ab[1] * t, start[2] + ab[2] * t];
    return Math.sqrt(
        (point[0] - closest[0]) ** 2 + (point[1] - closest[1]) ** 2 + (point[2] - closest[2]) ** 2,
    );
}

function readRepoFile(relativePath) {
    return readFileSync(path.resolve(relativePath), 'utf8');
}

test('Clockwork Canyon preset exists with the authored gameplay inventory', () => {
    assert.ok(map, 'clockwork_canyon preset is exported');
    assert.equal(typeof map.name, 'string');
    assert.ok(map.name.length > 0, 'preset has a name');
    assert.deepEqual(map.size, [150, 70, 150]);
    assert.ok(map.obstacles.length >= 40, `expected at least 40 obstacles, got ${map.obstacles.length}`);
    assert.equal(map.portals.length, 4);
    assert.equal(map.gates.length, 6);
    assert.equal(map.botSpawns.length, 6);
    assert.equal(map.items.length, 9);
});

test('every box obstacle and tube stays within the arena bounds', () => {
    for (const obstacle of map.obstacles) {
        if (isTube(obstacle)) {
            for (const point of [obstacle.start, obstacle.end]) {
                assert.ok(point[0] - obstacle.radius >= BOUNDS.minX && point[0] + obstacle.radius <= BOUNDS.maxX,
                    `tube endpoint ${point} clears x bounds`);
                assert.ok(point[1] - obstacle.radius >= BOUNDS.minY && point[1] + obstacle.radius <= BOUNDS.maxY,
                    `tube endpoint ${point} clears y bounds`);
                assert.ok(point[2] - obstacle.radius >= BOUNDS.minZ && point[2] + obstacle.radius <= BOUNDS.maxZ,
                    `tube endpoint ${point} clears z bounds`);
            }
        } else {
            const aabb = boxAABB(obstacle);
            assert.ok(aabb.min[0] >= BOUNDS.minX && aabb.max[0] <= BOUNDS.maxX,
                `box at ${obstacle.pos} clears x bounds`);
            assert.ok(aabb.min[1] >= BOUNDS.minY && aabb.max[1] <= BOUNDS.maxY,
                `box at ${obstacle.pos} clears y bounds`);
            assert.ok(aabb.min[2] >= BOUNDS.minZ && aabb.max[2] <= BOUNDS.maxZ,
                `box at ${obstacle.pos} clears z bounds`);
        }
    }
});

test('spawns and portal endpoints keep clear of every obstacle', () => {
    const boxes = map.obstacles.filter((obstacle) => !isTube(obstacle));
    const tubes = map.obstacles.filter(isTube);

    const points = [
        ['playerSpawn', [map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z]],
        ...map.botSpawns.map((spawn, index) => [`botSpawn[${index}]`, [spawn.x, spawn.y, spawn.z]]),
        ...map.portals.flatMap((portal, index) => [
            [`portal[${index}].a`, portal.a],
            [`portal[${index}].b`, portal.b],
        ]),
    ];

    for (const [label, point] of points) {
        for (const box of boxes) {
            const distance = distancePointToAABB(point, boxAABB(box));
            assert.ok(distance >= CLEARANCE, `${label} is ${distance.toFixed(2)} from box at ${box.pos}, needs >= ${CLEARANCE}`);
        }
        for (const tube of tubes) {
            const distance = distancePointToSegment(point, tube.start, tube.end);
            const required = tube.radius + CLEARANCE;
            assert.ok(distance >= required, `${label} is ${distance.toFixed(2)} from tube, needs >= ${required}`);
        }
    }
});

test('gates keep clear of every obstacle, ignoring boxes with a tunnel', () => {
    const boxes = map.obstacles.filter((obstacle) => !isTube(obstacle) && !obstacle.tunnel);
    const tubes = map.obstacles.filter(isTube);

    for (const gate of map.gates) {
        const point = gate.pos;
        for (const box of boxes) {
            const distance = distancePointToAABB(point, boxAABB(box));
            assert.ok(distance >= CLEARANCE, `gate ${gate.id ?? gate.type} is ${distance.toFixed(2)} from box at ${box.pos}, needs >= ${CLEARANCE}`);
        }
        for (const tube of tubes) {
            const distance = distancePointToSegment(point, tube.start, tube.end);
            const required = tube.radius + CLEARANCE;
            assert.ok(distance >= required, `gate ${gate.id ?? gate.type} is ${distance.toFixed(2)} from tube, needs >= ${required}`);
        }
    }
});

test('items have unique ids and never sit inside a box obstacle', () => {
    const boxes = map.obstacles.filter((obstacle) => !isTube(obstacle));

    const ids = map.items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, 'every item id is unique');

    for (const item of map.items) {
        const point = [item.x, item.y, item.z];
        for (const box of boxes) {
            assert.ok(!pointInAABB(point, boxAABB(box)), `item ${item.id} must not sit inside box at ${box.pos}`);
        }
    }
});

test('Clockwork Canyon is registered in the map catalog, base key list and menu collection', () => {
    const catalogSource = readRepoFile('src/core/config/maps/MapPresetCatalog.js');
    assert.match(catalogSource, /presets\/clockwork_canyon\/index\.js/, 'catalog imports the clockwork_canyon preset module');
    assert.match(catalogSource, /clockwork_canyon/, 'catalog source mentions clockwork_canyon');

    const baseSource = readRepoFile('src/core/config/maps/MapPresetsBase.js');
    assert.match(baseSource, /clockwork_canyon/, 'BASE_MAP_KEYS lists clockwork_canyon');

    const menuSource = readRepoFile('src/ui/menu/MenuMapCollectionCatalog.js');
    assert.match(menuSource, /clockwork_canyon/, 'menu map collection lists clockwork_canyon');
});
