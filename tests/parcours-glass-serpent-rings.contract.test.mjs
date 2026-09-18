// P5 (playtest 17.09.2026), decision 18.09.2026: on glass_serpent five box obstacles sat exactly on
// ring centres (CP01, CP04, CP07_BALCONY, CP08, CP09), so a ship could only pass above or below the
// slab. The balconies stay, but below the ring: the centre and the middle half of every ring are free.

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Roughly one ship width in authored units once the map scale is applied.
const SHIP_MARGIN = 1;

export function ringBlockers(mapDef) {
    const rings = [...mapDef.parcours.checkpoints, mapDef.parcours.finish].filter(Boolean);
    const boxes = mapDef.obstacles.filter((obstacle) => obstacle.shape !== 'tube' && !obstacle.tunnel && obstacle.size);
    const blocked = [];
    for (const ring of rings) {
        for (const dy of [0, 0.5, -0.5]) {
            const point = [ring.pos[0], ring.pos[1] + dy * ring.radius, ring.pos[2]];
            const hit = boxes.find((box) => point.every((value, axis) => (
                Math.abs(value - box.pos[axis]) <= box.size[axis] / 2 + SHIP_MARGIN
            )));
            if (hit) { blocked.push(`${ring.id}@${dy}`); break; }
        }
    }
    return blocked;
}

test('glass_serpent: no ring centre sits inside a slab or block', () => {
    const mapDef = MAP_PRESET_CATALOG.glass_serpent;
    assert.ok(mapDef?.parcours?.enabled);
    assert.deepEqual(ringBlockers(mapDef), []);
});
