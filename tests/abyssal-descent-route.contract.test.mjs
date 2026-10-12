import assert from 'node:assert/strict';
import test from 'node:test';

import { ABYSSAL_DESCENT_MAP } from '../src/core/config/maps/presets/abyssal_descent.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

const map = ABYSSAL_DESCENT_MAP.abyssal_descent;
const { checkpoints, finish } = map.parcours;
// The main line only: the mirrored split ring is an alias of its twin.
const line = [...checkpoints.filter((entry) => !entry.aliasOf), finish];
const sideOf = ([x, , z]) => (Math.abs(x) >= Math.abs(z) ? (x > 0 ? 'east' : 'west') : (z > 0 ? 'south' : 'north'));

test('Abyssal Descent keeps a valid ordered route', () => {
    const route = buildRouteFromParcours(map.parcours);
    assert.ok(route);
    assert.equal(route.routeId, 'abyssal_descent_v1');
});

test('Abyssal Descent weaves between the shaft sides instead of dropping down one axis', () => {
    const lateral = line.filter((entry) => Math.hypot(entry.pos[0], entry.pos[2]) >= 20);
    assert.ok(lateral.length >= 4, `${lateral.length} rings lie 20+ units off the shaft axis`);
    const sides = new Set(lateral.map((entry) => sideOf(entry.pos)));
    assert.ok(sides.size >= 3, `rings use ${[...sides].join(', ')}`);
});

test('Abyssal Descent is clearly longer than its straight drop', () => {
    let length = 0;
    for (let index = 1; index < line.length; index += 1) {
        length += Math.hypot(...line[index].pos.map((value, axis) => value - line[index - 1].pos[axis]));
    }
    const drop = line[0].pos[1] - finish.pos[1];
    assert.ok(length >= drop * 1.25, `route ${Math.round(length)} vs drop ${drop}`);
});

test('Abyssal Descent rings stay inside the shaft between its corner pillars', () => {
    const [width, , depth] = map.size;
    for (const entry of line) {
        assert.ok(Math.abs(entry.pos[0]) + entry.radius <= width / 2 - 3, `${entry.id} x`);
        assert.ok(Math.abs(entry.pos[2]) + entry.radius <= depth / 2 - 3, `${entry.id} z`);
    }
});