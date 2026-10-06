import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// The Labyrinth and Komplex walls (and their Blender skin) are 10 and 12.5 high, but the arena was
// 25 and 30 high: a free band above every wall led straight from any start to any target, so the
// maze was never the way to go. The walls are skin-matched (the Blender world is only a visual skin
// over the authored boxes), so they stay; the ceiling comes down to the wall tops instead.

const wallTop = (obstacle) => obstacle.pos[1] + obstacle.size[1] / 2;

for (const key of ['maze', 'complex']) {
    test(`${key}: no free flight band above the walls`, () => {
        const map = MAP_PRESET_CATALOG[key];
        const boxes = map.obstacles.filter((obstacle) => Array.isArray(obstacle.pos) && Array.isArray(obstacle.size));
        const tallest = Math.max(...boxes.map(wallTop));
        assert.ok(map.size[1] <= tallest,
            `${key} is ${map.size[1]} high but its tallest wall ends at ${tallest}: ships fly over the maze`);
    });

    test(`${key}: portals and starts stay below the ceiling`, () => {
        const map = MAP_PRESET_CATALOG[key];
        for (const portal of map.portals) {
            for (const end of [portal.a, portal.b]) {
                assert.ok(end[1] > 0 && end[1] <= map.size[1] - 3, `portal end ${end} sits inside the lowered ceiling`);
            }
        }
        // Spawns are authored in world units here (the map does not scale its anchors).
        const ceiling = map.size[1] * 3;
        for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
            assert.ok(spawn.y > 0 && spawn.y <= ceiling - 9, `spawn ${JSON.stringify(spawn)} has room below the ceiling`);
        }
    });
}
