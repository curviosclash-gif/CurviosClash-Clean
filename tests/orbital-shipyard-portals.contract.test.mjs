import assert from 'node:assert/strict';
import test from 'node:test';

import { ORBITAL_SHIPYARD_MAPS } from '../src/core/config/maps/presets/orbital_shipyard/index.js';

const map = ORBITAL_SHIPYARD_MAPS.orbital_shipyard;
const gates = [...map.parcours.checkpoints, map.parcours.finish];
const near = (point, limit) => gates.some((gate) => Math.hypot(...gate.pos.map((value, axis) => value - point[axis])) <= limit);

test('Orbital Shipyard authors its own portals along the flown lanes instead of leaving them to the generator', () => {
    assert.equal(map.preferAuthoredPortals, true);
    assert.ok(Array.isArray(map.portals) && map.portals.length >= 2, 'at least two authored portal pairs');
    const [width, height, depth] = map.size;
    for (const [index, portal] of map.portals.entries()) {
        for (const end of [portal.a, portal.b]) {
            assert.equal(end.length, 3, `portal ${index} end is a point`);
            assert.ok(Math.abs(end[0]) < width / 2 && Math.abs(end[2]) < depth / 2 && end[1] > 0 && end[1] < height, `portal ${index} lies in the arena`);
            assert.ok(near(end, 14), `portal ${index} mouth lies on a flown lane (within 14 units of a gate)`);
        }
        assert.ok(Math.hypot(...portal.a.map((value, axis) => value - portal.b[axis])) >= 20, `portal ${index} ends are apart`);
    }
});