import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_MAPS } from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { MAP_LIGHT_SOURCE_LIMIT } from '../src/shared/contracts/MapLightSourcesContract.js';

const fire = NOTRE_DAME_FIRE_MAPS.notre_dame_fire;
const fireArena = NOTRE_DAME_FIRE_MAPS.notre_dame_fire_arena;
const restoration = NOTRE_DAME_MAPS.notre_dame;
const restorationArena = NOTRE_DAME_MAPS.notre_dame_arena;

test('both fire maps are registered everywhere a map has to appear', () => {
    assert.equal(MAP_PRESET_CATALOG.notre_dame_fire, fire);
    assert.equal(MAP_PRESETS_BASE.notre_dame_fire, fire);
    assert.equal(fire.name, 'Notre-Dame Brand');
    assert.equal(fire.parcours.enabled, true);
    // Without a collection the picker drops the map into the unsorted fallback bucket.
    assert.equal(resolveMapPickerCollection('notre_dame_fire').id, 'adventure');

    assert.equal(MAP_PRESET_CATALOG.notre_dame_fire_arena, fireArena);
    assert.equal(MAP_PRESETS_BASE.notre_dame_fire_arena, fireArena);
    assert.equal(fireArena.name, 'Notre-Dame Brand Arena');
    assert.equal(fireArena.parcours, undefined);
    assert.equal(resolveMapPickerCollection('notre_dame_fire_arena').id, 'arena');
});

test('the fire maps fly the same cathedral instead of loading a second copy', () => {
    // Identity, not equality. The geometry is what this map costs; a copy would double the load
    // and let the two buildings drift apart while the fire pieces are still being swapped in.
    for (const map of [fire, fireArena]) {
        assert.equal(map.glbModels, restoration.glbModels);
        assert.equal(map.obstacles, restoration.obstacles);
        assert.equal(map.portals, restoration.portals);
        assert.deepEqual(map.size, restoration.size);
        assert.equal(map.glbColliderMode, 'scene');
        assert.equal(map.glbAuthoredObstaclesCollisionOnly, true);
    }
});

test('the fire light is held separately from the restoration map it was taken from', () => {
    // The restoration map is a building site in the late afternoon and its profile is expected to
    // move back towards daylight. This map must not follow it, so nothing here may be the same
    // object -- which is what would silently reintroduce the coupling.
    assert.notEqual(fire.lighting, restoration.lighting);
    assert.notEqual(fireArena.lighting, restorationArena.lighting);
    assert.notEqual(fire.lighting, fireArena.lighting);
    assert.notEqual(fire.lights, restoration.lights);
    assert.equal(fire.lights, fireArena.lights);
    for (const source of fire.lights) {
        assert.ok(
            !restoration.lights.some((other) => other.id === source.id),
            `${source.id} is the fire map's own light source, not a shared id`,
        );
    }
});

test('both fire profiles are lit as a night fire rather than as a dusk', () => {
    for (const lighting of [fire.lighting, fireArena.lighting]) {
        // Red fog rather than grey: the smoke is lit from below by the fire, not by the sky.
        const fogRed = (lighting.fog.color >> 16) & 0xff;
        const fogBlue = lighting.fog.color & 0xff;
        assert.ok(fogRed > fogBlue * 2, 'the fog layer carries the fire, not a blue dusk');
        // An ember horizon under a near-black zenith.
        assert.ok(
            ((lighting.skyDome.horizonColor >> 16) & 0xff) > (lighting.skyDome.horizonColor & 0xff),
            'the horizon glows warm',
        );
        assert.ok(lighting.skyDome.zenithColor < 0x0a0f20, 'the zenith stays night');
        // Stars over a smoke column read as a mistake.
        assert.equal(lighting.starsVisible, false);
    }
});

test('the fire route is ranked on its own identity', () => {
    // The stages are still the restoration map's, but they stop being the same course the moment
    // the vault opens. A shared id would rank runs through two different buildings against each
    // other, and ghosts recorded here would replay against a building that is still standing.
    assert.equal(fire.parcours.routeId, 'notre_dame_fire_v1');
    assert.notEqual(fire.parcours.routeId, restoration.parcours.routeId);
});

test('the interior lamps leave room for the fire that replaces them', () => {
    // Every extra point light costs shader work on every lit surface, so a map gets eight. The
    // breaches, the open roof and the debris cone all want one, and they replace these rather
    // than being added to them.
    assert.ok(fire.lights.length <= MAP_LIGHT_SOURCE_LIMIT);
    assert.equal(new Set(fire.lights.map((source) => source.id)).size, fire.lights.length);
});
