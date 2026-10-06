import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { ARCADE_SECTOR_CATALOG } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { SECTOR_MAP_POOLS } from '../src/state/arcade/ArcadeMapProgression.js';

const SHORT_PARCOURS = ['frozen_helix', 'neon_circuit', 'magma_maze', 'sky_islands'];

test('the short parcours maps are part of the Arcade parcours sector pool', () => {
    const catalogPool = ARCADE_SECTOR_CATALOG.find((entry) => entry.id === 'sector_parcours').mapPool;
    for (const key of SHORT_PARCOURS) {
        assert.equal(MAP_PRESET_CATALOG[key]?.parcours?.enabled, true, `${key} is a parcours map`);
        assert.ok(catalogPool.includes(key), `${key} is in the encounter catalog pool`);
        assert.ok(SECTOR_MAP_POOLS.sector_parcours.includes(key), `${key} is in the progression pool`);
    }
});

test('both parcours sector pools name the same maps and only real parcours maps', () => {
    const catalogPool = ARCADE_SECTOR_CATALOG.find((entry) => entry.id === 'sector_parcours').mapPool;
    assert.deepEqual([...catalogPool].sort(), [...SECTOR_MAP_POOLS.sector_parcours].sort());
    for (const key of catalogPool) assert.equal(MAP_PRESET_CATALOG[key]?.parcours?.enabled, true, `${key} is a parcours map`);
});