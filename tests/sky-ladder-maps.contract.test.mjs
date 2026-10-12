import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { SKY_LADDER_MAP_KEYS } from '../src/core/config/maps/presets/sky_ladder/index.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { findBlockedLegs } from './helpers/parcours-race-line.mjs';

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function insideBounds(pos, size, margin = 0) {
    const [sx, sy, sz] = size;
    return Math.abs(pos[0]) <= sx / 2 - margin
        && pos[1] >= margin
        && pos[1] <= sy - margin
        && Math.abs(pos[2]) <= sz / 2 - margin;
}

// Axis-aligned boxes only; rotated boxes are left to the ring clearance guard.
// A tunnel box is solid everywhere except its bore around the tunnel axis.
function insideHardBox(pos, obstacles) {
    const axes = { x: 0, y: 1, z: 2 };
    return obstacles.some((obstacle) => {
        if (!Array.isArray(obstacle?.pos) || !Array.isArray(obstacle?.size)) return false;
        if (obstacle.kind === 'foam' || obstacle.rotateY) return false;
        const inside = obstacle.pos.every((center, axis) => Math.abs(pos[axis] - center) <= obstacle.size[axis] / 2);
        if (!inside || !obstacle.tunnel) return inside;
        const along = axes[obstacle.tunnel.axis] ?? 0;
        const offAxis = [0, 1, 2].filter((axis) => axis !== along)
            .map((axis) => pos[axis] - obstacle.pos[axis]);
        return Math.hypot(...offAxis) > obstacle.tunnel.radius;
    });
}

test('sky ladder registers four parcours stages in climbing order', () => {
    assert.deepEqual([...SKY_LADDER_MAP_KEYS], [
        'sky_ladder_abyss',
        'sky_ladder_foundry',
        'sky_ladder_storm',
        'sky_ladder_star',
    ]);
    SKY_LADDER_MAP_KEYS.forEach((mapKey, index) => {
        const map = CONFIG.MAPS[mapKey];
        assert.ok(map, `${mapKey} is a runtime map`);
        assert.equal(map.parcours?.enabled, true, `${mapKey} is a parcours`);
        assert.equal(map.scaleAuthoredAnchors, true, `${mapKey} scales authored anchors`);
        assert.match(map.name, new RegExp(`^Himmelsleiter ${['I', 'II', 'III', 'IV'][index]}:`), `${mapKey} names its stage`);
        assert.equal(map.glbModels, undefined, `${mapKey} stays procedural`);
    });
});

test('every sky ladder stage is a full course with a branch and a portal shortcut', () => {
    for (const mapKey of SKY_LADDER_MAP_KEYS) {
        const map = CONFIG.MAPS[mapKey];
        const route = buildRouteFromParcours(map.parcours);
        assert.ok(route.checkpoints.length >= 12, `${mapKey} has at least 12 checkpoints`);
        assert.ok(map.parcours.checkpoints.some((checkpoint) => (checkpoint.nextIds || []).length > 1), `${mapKey} branches`);
        assert.ok((map.portals || []).length >= 1, `${mapKey} owns an internal portal pair`);
        for (const portal of map.portals) {
            assert.ok(insideBounds(portal.a, map.size, 2) && insideBounds(portal.b, map.size, 2), `${mapKey} portal ends stay inside the arena`);
        }
    }
});

test('every sky ladder racing line flies straight through open air, hard walls and foam alike', () => {
    const scale = CONFIG.ARENA.MAP_SCALE;
    const blockedByMap = Object.fromEntries(SKY_LADDER_MAP_KEYS.map((mapKey) => [
        mapKey,
        findBlockedLegs(CONFIG.MAPS[mapKey], scale).map(({ leg, at }) => `${leg} at [${at.join(', ')}]`),
    ]));
    assert.deepEqual(blockedByMap, Object.fromEntries(SKY_LADDER_MAP_KEYS.map((mapKey) => [mapKey, []])));
});

test('every sky ladder exit portal waits near the finish in open air', () => {
    for (const mapKey of SKY_LADDER_MAP_KEYS) {
        const map = CONFIG.MAPS[mapKey];
        const exit = map.fivePortalsExit?.pos;
        assert.ok(Array.isArray(exit), `${mapKey} has an exit portal`);
        const gap = distance(exit, map.parcours.finish.pos);
        assert.ok(gap >= 10 && gap <= 30, `${mapKey} exit portal sits ${gap.toFixed(1)} from the finish`);
        assert.ok(insideBounds(exit, map.size, 4), `${mapKey} exit portal stays inside the arena`);
        assert.equal(insideHardBox(exit, map.obstacles || []), false, `${mapKey} exit portal is not buried in a wall`);
    }
});

test('sky ladder abyss spaces its last rings: no gap from CP10 to the finish under 16 units', () => {
    const map = CONFIG.MAPS.sky_ladder_abyss;
    const rings = [...map.parcours.checkpoints, map.parcours.finish];
    const from = rings.findIndex((ring) => ring.id === 'CP10');
    assert.ok(from > 0, 'CP10 exists');
    for (let index = from + 1; index < rings.length; index += 1) {
        const gap = distance(rings[index - 1].pos, rings[index].pos);
        assert.ok(gap >= 16, `${rings[index - 1].id} -> ${rings[index].id} is only ${gap.toFixed(1)} apart`);
    }
});
