import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Arenas and special maps used to leave the start to chance: without a playerSpawn every ship was
// placed at a random free spot (SpawnPlacementSystem.findSpawnPosition), and a map with fewer
// authored spawns than players sent the surplus bots to random spots too. Each map below now
// authors one player spawn and nine bot spawns, enough for a round of ten, spread apart.
// Whether those points are free and have room to fly is the job of map-anchor-guard.contract.test.mjs.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const PLAYERS = 10;
// Two ships that start closer than this are in each other's way before the protection runs out.
const MIN_SPAWN_SEPARATION = 40;

const START_POINT_MAPS = [
    'maze', 'complex', 'pyramid', 'vertical_maze', 'trench', 'foam_forest', 'crossfire', 'checkerboard',
    'the_pit', 'core_fusion', 'pillar_hall', 'spiral_tower', 'portal_madness', 'the_loop',
    'expert_gauntlet', 'mega_maze', 'mega_maze_xl',
];

const toWorld = (map, spawn) => {
    const scale = map.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    return [spawn.x * scale, spawn.y * scale, spawn.z * scale];
};

for (const key of START_POINT_MAPS) {
    test(`${key} authors a player spawn and bot spawns for ${PLAYERS} players`, () => {
        const map = MAP_PRESET_CATALOG[key];
        assert.ok(map, `${key} is a catalog map`);
        assert.ok(map.playerSpawn, `${key} has a playerSpawn`);
        assert.ok(Array.isArray(map.botSpawns) && map.botSpawns.length >= PLAYERS - 1,
            `${key} has ${map.botSpawns?.length ?? 0} botSpawns, ${PLAYERS - 1} needed`);

        const points = [map.playerSpawn, ...map.botSpawns].map((spawn) => toWorld(map, spawn));
        const half = map.size.map((value) => (value * MAP_SCALE) / 2);
        for (const [index, point] of points.entries()) {
            assert.ok(point.every(Number.isFinite), `spawn ${index} has numeric x/y/z`);
            assert.ok(Math.abs(point[0]) < half[0] && Math.abs(point[2]) < half[2] && point[1] > 0 && point[1] < half[1] * 2,
                `spawn ${index} (${point}) lies inside the arena`);
        }
        for (let a = 0; a < points.length; a += 1) {
            for (let b = a + 1; b < points.length; b += 1) {
                const apart = Math.hypot(...points[a].map((value, axis) => value - points[b][axis]));
                assert.ok(apart >= MIN_SPAWN_SEPARATION,
                    `spawns ${a} and ${b} start only ${Math.round(apart)} units apart`);
            }
        }
    });
}
