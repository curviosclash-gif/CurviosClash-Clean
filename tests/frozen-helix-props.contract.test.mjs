import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { FROZEN_ICE_CRYSTALS } from '../src/core/config/maps/presets/frozen_helix.js';
import {
    assertDecorativeFamily, assertLoaderAddsNoColliders, assertPropsClearOfRoute, familyVariantIds,
} from './helpers/map-prop-family.mjs';

test('ice crystals ship ten decorative, opaque and budgeted variants', () => {
    assertDecorativeFamily('assets/maps/frozen_helix/props/ice-crystals', familyVariantIds('frozen-ice-crystal'));
});

test('frozen helix places the crystals on the ice floor, clear of pillars, tubes and the route', () => {
    const map = MAP_PRESET_CATALOG.frozen_helix;
    assert.equal(map.glbModels[0].url, 'assets/maps/frozen_helix/glb/01_world.glb', 'the world loads first');
    assert.deepEqual(map.glbModels.slice(1), [...FROZEN_ICE_CRYSTALS]);
    assert.equal(FROZEN_ICE_CRYSTALS.length, 12);
    assertPropsClearOfRoute(map, FROZEN_ICE_CRYSTALS, { floorY: 0, obstacles: map.obstacles });
});

test('the real loader adds the crystals without a single collider', async () => {
    await assertLoaderAddsNoColliders(FROZEN_ICE_CRYSTALS);
});
