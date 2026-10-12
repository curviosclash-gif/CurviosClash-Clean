import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Labyrinth and Komplex: their walls were 10 and 12.5 high in arenas 25 and 30 high, so a free band
// above every wall led from any start straight to any target and the maze was never the way to go.
// The arena keeps its height (and with it its item count, which follows the volume); the walls now
// reach up to the ceiling and leave only a slit that no ship fits through.
//
// How narrow: a ship is a sphere of its hitbox radius and needs 2 x radius between the wall top and
// the ceiling (ArenaCollision: y - radius < wall top, y + radius > maxY). The smallest radius the code
// allows is 0.2 (Player.js: Math.max(0.2, hitboxRadius); the smallest built-in vehicle has 0.8), so a
// slit below 0.4 world units stops every ship.
//
// Only real walls reach up. A wall is a long thin box (footprint aspect >= 3: the 10x2, 15x2, 20x2 and
// 30x2 slabs that divide the maze). Compact boxes (the centre column and the two side blocks of complex)
// are obstacles, not walls: a ship may fly over them, and they keep the heights they had before the
// walls were raised.

const MIN_SHIP_RADIUS = 0.2;
const MAX_SLIT_WORLD = 2 * MIN_SHIP_RADIUS;
const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const ARENA_HEIGHTS = { maze: 25, complex: 30 };
const WALL_MIN_ASPECT = 3;
// Compact blocks of complex with their original height (before 659de3d5), bottom edge unchanged.
const COMPLEX_BLOCKS = [
    { pos: [0, 5, 0], size: [6, 12, 6] },
    { pos: [-30, 3, 0], size: [5, 6, 5] },
    { pos: [30, 3, 0], size: [5, 6, 5] },
];

function footprintAspect(box) {
    const [w, , d] = box.size;
    return Math.max(w, d) / Math.min(w, d);
}
const isWall = (box) => footprintAspect(box) >= WALL_MIN_ASPECT;

for (const [key, height] of Object.entries(ARENA_HEIGHTS)) {
    test(`${key}: the arena keeps its height and the walls leave no slit a ship fits through`, () => {
        const map = MAP_PRESET_CATALOG[key];
        assert.equal(map.size[1], height, `${key} stays ${height} high; the walls come up, not the ceiling down`);
        const boxes = map.obstacles.filter((obstacle) => Array.isArray(obstacle.pos) && Array.isArray(obstacle.size));
        assert.ok(boxes.length > 0);
        const walls = boxes.filter(isWall);
        assert.ok(walls.length > 0);
        for (const box of walls) {
            const slit = (map.size[1] - (box.pos[1] + box.size[1] / 2)) * MAP_SCALE;
            assert.ok(slit >= 0 && slit < MAX_SLIT_WORLD,
                `box at ${box.pos} leaves a ${slit.toFixed(2)} unit slit under the ceiling, a ship needs under ${MAX_SLIT_WORLD} to be stopped`);
        }
    });

    test(`${key}: portals and starts keep clear of the raised walls`, () => {
        const map = MAP_PRESET_CATALOG[key];
        const boxes = map.obstacles.filter((obstacle) => Array.isArray(obstacle.pos) && Array.isArray(obstacle.size));
        const inside = (point, scale) => boxes.some((box) => point.every((value, axis) => (
            Math.abs(value - box.pos[axis] * scale) < (box.size[axis] * scale) / 2)));
        for (const portal of map.portals) {
            for (const end of [portal.a, portal.b]) {
                assert.equal(inside(end, 1), false, `portal end ${end} is not inside a wall`);
            }
        }
        // Spawns are authored in world units here (the map does not scale its anchors).
        for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
            assert.equal(inside([spawn.x, spawn.y, spawn.z], MAP_SCALE), false, `spawn ${JSON.stringify(spawn)} is not inside a wall`);
        }
    });
}

test('complex: the compact blocks keep their original height and only the walls reach the ceiling', () => {
    const boxes = MAP_PRESET_CATALOG.complex.obstacles.filter((obstacle) => Array.isArray(obstacle.pos) && Array.isArray(obstacle.size));
    const blocks = boxes.filter((box) => !isWall(box));
    assert.equal(blocks.length, COMPLEX_BLOCKS.length, 'complex has exactly the centre column and the two side blocks as compact boxes');
    for (const expected of COMPLEX_BLOCKS) {
        const block = blocks.find((box) => box.pos[0] === expected.pos[0] && box.pos[2] === expected.pos[2]);
        assert.ok(block, `block at x ${expected.pos[0]} z ${expected.pos[2]} exists`);
        assert.deepEqual(block.size, expected.size);
        assert.deepEqual(block.pos, expected.pos);
    }
});