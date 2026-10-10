import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAGMA_BASALT_OUTCROPS } from '../src/core/config/maps/presets/magma_maze.js';
import {
    assertDecorativeFamily, assertLoaderAddsNoColliders, assertPropsClearOfRoute, familyVariantIds,
} from './helpers/map-prop-family.mjs';

test('basalt outcrops ship ten decorative, budgeted variants with tone-mapping-safe lava', () => {
    assertDecorativeFamily('assets/maps/magma_maze/props/basalt-outcrops', familyVariantIds('magma-basalt-outcrop'));
});

test('magma maze places the outcrops on the lava, clear of walls and every route anchor', () => {
    const map = MAP_PRESET_CATALOG.magma_maze;
    assert.equal(map.glbModels[0].url, 'assets/maps/magma_maze/glb/01_world.glb', 'the world loads first');
    assert.deepEqual(map.glbModels.slice(1), [...MAGMA_BASALT_OUTCROPS]);
    assert.equal(MAGMA_BASALT_OUTCROPS.length, 12);
    const lava = map.obstacles.find((obstacle) => obstacle.kind === 'foam' && obstacle.size[0] > 100);
    assertPropsClearOfRoute(map, MAGMA_BASALT_OUTCROPS, {
        floorY: lava.pos[1] + lava.size[1] / 2,
        obstacles: map.obstacles.filter((obstacle) => obstacle !== lava),
    });
});

test('the real loader adds the outcrops without a single collider', async () => {
    await assertLoaderAddsNoColliders(MAGMA_BASALT_OUTCROPS);
});
