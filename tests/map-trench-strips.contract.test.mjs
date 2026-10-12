import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Der Graben: the two side walls (x +-25, 4 thick, the whole length and height) stood 3 units short
// of the arena wall, which left a sealed strip on each side - about 10 % of the arena volume that
// no ship can enter and no item or spawn can use. The arena is now exactly as wide as its walls.

test('trench: no sealed strip between the side walls and the arena wall', () => {
    const map = MAP_PRESET_CATALOG.trench;
    const [width, height, length] = map.size;
    const sideWalls = map.obstacles.filter((box) => box.size[1] >= height && box.size[2] >= length);
    assert.equal(sideWalls.length, 2, 'the two full-length, full-height side walls');
    for (const wall of sideWalls) {
        const outerFace = Math.abs(wall.pos[0]) + wall.size[0] / 2;
        assert.ok(outerFace >= width / 2,
            `the wall at x ${wall.pos[0]} ends ${width / 2 - outerFace} units inside the arena wall: a sealed strip`);
    }
});

test('trench: the corridor between the walls is the whole playable width', () => {
    const map = MAP_PRESET_CATALOG.trench;
    const inner = Math.min(...map.obstacles.filter((box) => box.size[2] >= map.size[2]).map((wall) => Math.abs(wall.pos[0]) - wall.size[0] / 2));
    // Start points are authored in world units; every one lies between the walls.
    for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
        assert.ok(Math.abs(spawn.x) < inner * 3, `spawn ${JSON.stringify(spawn)} lies inside the corridor`);
    }
});
