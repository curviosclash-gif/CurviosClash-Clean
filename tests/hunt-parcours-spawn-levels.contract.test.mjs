import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// HUNT takes up to ten players, and the spawn system hands out the authored start points first
// (the player spawn, then one per bot). A parcours map with only three bot spawns on one level
// sends the rest of a ten player round to random fallback cells; these maps offer spawns on
// several levels instead. The first entries stay at the start line for parcours rounds.
const MAPS = ['frozen_helix', 'neon_circuit', 'magma_maze', 'sky_islands', 'vulkan_odyssey'];
const MAX_PLAYERS = 10;

for (const key of MAPS) {
    test(`${key} offers a start point for every one of ten players, spread over several levels`, () => {
        const map = MAP_PRESET_CATALOG[key];
        const spawns = [map.playerSpawn, ...map.botSpawns];
        assert.ok(spawns.length >= MAX_PLAYERS, `${spawns.length} start points`);
        const levels = new Set(spawns.map((spawn) => Math.round(spawn.y / 8)));
        assert.ok(levels.size >= 3, `start points use ${levels.size} levels`);
        const keys = spawns.map((spawn) => [spawn.x, spawn.y, spawn.z].join(','));
        assert.equal(new Set(keys).size, keys.length, 'no two players share a start point');
        for (let a = 0; a < spawns.length; a += 1) {
            for (let b = a + 1; b < spawns.length; b += 1) {
                const gap = Math.hypot(spawns[a].x - spawns[b].x, spawns[a].y - spawns[b].y, spawns[a].z - spawns[b].z);
                assert.ok(gap >= 4, `start points ${a} and ${b} are ${gap.toFixed(1)} apart`);
            }
        }
    });
}