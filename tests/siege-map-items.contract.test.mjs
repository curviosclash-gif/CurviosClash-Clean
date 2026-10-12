import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// The four siege/castle maps were authored with the item list of a much smaller arena: two anchors
// on a 180 x 180 bridge, seven on the Eiffel siege that all hang within 22 units of the tower axis
// while the field is 310 wide. Item anchors are the only authored pickup places (the rest is the
// random fill), so a thin list leaves most of the field empty. The floor below is the density of
// the large fight maps in the catalog (notre_dame 12 items on 460 x 320 = 0.82 per 10 000 square
// map units); the small maps next to these sit at 1.5 to 2.7.

const MIN_ITEMS_PER_10K_SQUARE_UNITS = 0.8;
const MAPS = ['eiffel_tower_siege', 'storm_bridge_siege', 'storm_dam_siege', 'burg_falkenwacht_arena'];

const anchorOf = (item) => {
    const pos = Array.isArray(item.pos) ? item.pos : [];
    return [item.x ?? pos[0], item.y ?? pos[1], item.z ?? pos[2]];
};

for (const key of MAPS) {
    test(`${key} has enough authored item anchors for its field`, () => {
        const map = MAP_PRESET_CATALOG[key];
        const density = map.items.length / ((map.size[0] * map.size[2]) / 10000);
        assert.ok(density >= MIN_ITEMS_PER_10K_SQUARE_UNITS,
            `${map.items.length} items on ${map.size[0]} x ${map.size[2]} = ${density.toFixed(2)} per 10k, needs ${MIN_ITEMS_PER_10K_SQUARE_UNITS}`);
    });
}

test('the Eiffel siege keeps part of its items out in the 310 field, not only around the tower', () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    const half = map.size[0] / 2;
    const outer = map.items.map(anchorOf).filter(([x, , z]) => Math.hypot(x, z) >= 60);
    assert.ok(outer.length >= 4, `only ${outer.length} items lie 60 or more units from the tower axis`);
    for (const [x, , z] of outer) {
        assert.ok(Math.abs(x) <= half - 10 && Math.abs(z) <= half - 10, `item (${x}, ${z}) keeps 10 units from the field edge`);
    }
    const quadrants = new Set(outer.map(([x, , z]) => `${Math.sign(x)}:${Math.sign(z)}`));
    assert.ok(quadrants.size >= 3, `outer items cover ${quadrants.size} of 4 quadrants`);
});

test('bridge and dam items reach both halves of the field', () => {
    for (const key of ['storm_bridge_siege', 'storm_dam_siege']) {
        const points = MAP_PRESET_CATALOG[key].items.map(anchorOf);
        assert.ok(points.some(([x]) => x < -20) && points.some(([x]) => x > 20), `${key} has items on both x sides`);
        assert.ok(points.some(([, , z]) => z < -20) && points.some(([, , z]) => z > 20), `${key} has items on both z sides`);
    }
});
