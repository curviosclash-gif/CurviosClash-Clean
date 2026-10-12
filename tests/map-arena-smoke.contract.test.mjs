import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { MAP_PRESETS_EXPERT } from '../src/core/config/maps/MapPresetsExpert.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Smoke test for four maps no other contract looked at: the picker lists them, the preset has a
// real size, every box and portal lies inside the arena, the Blender world file exists, and the
// authored starts are there. Free space around those starts is map-anchor-guard.contract.test.mjs.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const SMOKE_MAPS = {
    the_pit: { list: MAP_PRESETS_BASE, minBoxes: 1, minPortals: 2 },
    spiral_tower: { list: MAP_PRESETS_BASE, minBoxes: 4, minPortals: 1 },
    the_loop: { list: MAP_PRESETS_BASE, minBoxes: 5, minPortals: 0 },
    mega_maze_xl: { list: MAP_PRESETS_EXPERT, minBoxes: 40, minPortals: 6 },
};

for (const [key, expectation] of Object.entries(SMOKE_MAPS)) {
    test(`${key}: loads with its size, boxes, portals, world file and starts inside the arena`, () => {
        const map = MAP_PRESET_CATALOG[key];
        assert.ok(map, `${key} is a catalog map`);
        assert.equal(expectation.list[key], map, `${key} is offered by its preset list`);
        assert.ok(typeof map.name === 'string' && map.name.length > 0, 'a name for the picker');
        assert.ok(map.size.length === 3 && map.size.every((value) => Number.isFinite(value) && value > 0), 'a real size');

        const [width, height, depth] = map.size;
        const boxes = map.obstacles.filter((obstacle) => Array.isArray(obstacle.pos) && Array.isArray(obstacle.size));
        assert.ok(boxes.length >= expectation.minBoxes, `${boxes.length} boxes, at least ${expectation.minBoxes}`);
        for (const box of boxes) {
            assert.ok(Math.abs(box.pos[0]) + box.size[0] / 2 <= width / 2 + 1e-6
                && Math.abs(box.pos[2]) + box.size[2] / 2 <= depth / 2 + 1e-6
                && box.pos[1] - box.size[1] / 2 >= -1e-6 && box.pos[1] + box.size[1] / 2 <= height + 1e-6,
                `box at ${box.pos} (${box.size}) lies inside the arena`);
        }

        assert.ok(map.portals.length >= expectation.minPortals, `${map.portals.length} portals`);
        for (const portal of map.portals) {
            for (const end of [portal.a, portal.b]) {
                assert.ok(Math.abs(end[0]) < width / 2 && end[1] > 0 && end[1] < height && Math.abs(end[2]) < depth / 2,
                    `portal end ${end} lies inside the arena`);
            }
        }

        for (const model of map.glbModels || []) {
            assert.ok(existsSync(model.url), `${model.url} exists`);
        }
        const world = [width, height, depth].map((value) => value * MAP_SCALE);
        for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
            assert.ok(Math.abs(spawn.x) < world[0] / 2 && spawn.y > 0 && spawn.y < world[1] && Math.abs(spawn.z) < world[2] / 2,
                `start ${JSON.stringify(spawn)} lies inside the built arena`);
        }
    });
}
