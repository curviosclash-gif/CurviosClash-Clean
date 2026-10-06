import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { NEON_SIGNAL_PYLONS } from '../src/core/config/maps/presets/neon_circuit.js';
import {
    assertDecorativeFamily, assertLoaderAddsNoColliders, assertPropsClearOfRoute, familyVariantIds,
} from './helpers/map-prop-family.mjs';

test('signal pylons ship ten decorative variants whose glow survives tone mapping', () => {
    assertDecorativeFamily('assets/maps/neon_circuit/props/signal-pylons', familyVariantIds('neon-signal-pylon'));
});

test('neon circuit places the pylons in the infield and on the verges, clear of the route', () => {
    const map = MAP_PRESET_CATALOG.neon_circuit;
    assert.equal(map.glbModels[0].url, 'assets/maps/neon_circuit/glb/01_world.glb', 'the world loads first');
    assert.deepEqual(map.glbModels.slice(1), [...NEON_SIGNAL_PYLONS]);
    assert.equal(NEON_SIGNAL_PYLONS.length, 12);
    assertPropsClearOfRoute(map, NEON_SIGNAL_PYLONS, { floorY: 0, obstacles: map.obstacles });
});

test('the real loader adds the pylons without a single collider', async () => {
    await assertLoaderAddsNoColliders(NEON_SIGNAL_PYLONS);
});
