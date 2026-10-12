import { NOTRE_DAME_EVOLUTION_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as fireModule from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_AUDIO_PROFILE, NOTRE_DAME_FIRE_LOOK } from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { MAP_LIGHT_SOURCE_LIMIT } from '../src/shared/contracts/MapLightSourcesContract.js';
import { NOTRE_DAME_FIRE_HAZARDS } from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireHazards.js';

// notre_dame_fire / notre_dame_fire_arena have no map of their own any more (E6): they are hidden
// redirects to the Notre-Dame evolution, and the fire look lives in NOTRE_DAME_FIRE_LOOK.
const fire = NOTRE_DAME_EVOLUTION_MAPS.notre_dame_fire;
const fireArena = NOTRE_DAME_EVOLUTION_MAPS.notre_dame_fire_arena;
const restoration = NOTRE_DAME_MAPS.notre_dame;
const restorationArena = NOTRE_DAME_MAPS.notre_dame_arena;
const fireLights = NOTRE_DAME_FIRE_LOOK.lights;
const fireLightings = [NOTRE_DAME_FIRE_LOOK.lighting, NOTRE_DAME_FIRE_LOOK.arenaLighting];

test('the fire maps use their own deterministic emergency ambience profile', () => {
    assert.equal(NOTRE_DAME_FIRE_AUDIO_PROFILE.id, 'notre_dame_fire');
    assert.equal(fire.fireAudioProfile, NOTRE_DAME_FIRE_AUDIO_PROFILE);
    assert.equal(fireArena.fireAudioProfile, NOTRE_DAME_FIRE_AUDIO_PROFILE);
    assert.equal(NOTRE_DAME_FIRE_AUDIO_PROFILE.interiorBounds, restoration.audioProfile.interiorBounds);
    assert.equal(NOTRE_DAME_FIRE_AUDIO_PROFILE.constructionCenters, undefined);
    assert.ok(NOTRE_DAME_FIRE_AUDIO_PROFILE.collapse.intervalSeconds >= 20);
});

test('the retired fire keys stay registered as hidden redirects to the evolution', () => {
    for (const [key, target] of [['notre_dame_fire', 'notre_dame'], ['notre_dame_fire_arena', 'notre_dame_arena']]) {
        const redirect = NOTRE_DAME_EVOLUTION_MAPS[key];
        assert.equal(MAP_PRESET_CATALOG[key], redirect);
        assert.equal(MAP_PRESETS_BASE[key], redirect);
        assert.equal(redirect.hiddenFromMapPicker, true);
        assert.equal(redirect.destructibles, NOTRE_DAME_EVOLUTION_MAPS[target].destructibles);
        assert.equal(redirect.fireProgression, NOTRE_DAME_EVOLUTION_MAPS[target].fireProgression);
        assert.equal(redirect.glbModels.length, NOTRE_DAME_EVOLUTION_MAPS[target].glbModels.length);
    }
    assert.equal(fire.parcours.enabled, true);
    assert.equal(fireArena.parcours, undefined);
    // Without a collection the picker drops the map into the unsorted fallback bucket.
    assert.equal(resolveMapPickerCollection('notre_dame_fire').id, 'adventure');
    assert.equal(resolveMapPickerCollection('notre_dame_fire_arena').id, 'arena');
});

test('the retired fire presets keep no playable definition of their own', () => {
    assert.equal(fireModule.NOTRE_DAME_FIRE_MAPS, undefined);
    for (const dead of ['NotreDameFireRoute.js', 'NotreDameFireModels.js']) {
        assert.equal(existsSync(new URL('../src/core/config/maps/presets/notre_dame_fire/' + dead, import.meta.url)), false, dead);
    }
    assert.equal(MAP_PRESET_CATALOG.notre_dame_fire.parcours.routeId, 'notre_dame_evolution_v1');
    assert.equal(MAP_PRESET_CATALOG.notre_dame_fire_arena.name, MAP_PRESET_CATALOG.notre_dame_arena.name);
});

test('neither map keeps invisible construction frames', () => {
    for (const map of [restoration, fire, fireArena]) {
        assert.ok(map.obstacles.every((obstacle) => !String(obstacle.id || '').startsWith('nd-site-')));
        assert.ok(map.glbModels.every((model) => !/hoist|scaffold|gantry|hoarding|tower-crane/.test(model.id)));
    }
});

test('the fire light is held separately from the restoration map it was taken from', () => {
    // The intact map is in the late afternoon and its profile is expected to
    // move back towards daylight. This map must not follow it, so nothing here may be the same
    // object -- which is what would silently reintroduce the coupling.
    const [fireLighting, fireArenaLighting] = fireLightings;
    assert.notEqual(fireLighting, restoration.lighting);
    assert.notEqual(fireArenaLighting, restorationArena.lighting);
    assert.notEqual(fireLighting, fireArenaLighting);
    assert.notEqual(fireLights, restoration.lights);
    for (const source of fireLights) {
        assert.ok(
            !restoration.lights.some((other) => other.id === source.id),
            `${source.id} is the fire map's own light source, not a shared id`,
        );
    }
});

test('both fire profiles are lit as a night fire rather than as a dusk', () => {
    for (const lighting of fireLightings) {
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

test('the sun no longer lights a cathedral that has no roof', () => {
    // The profiles started as a copy of the restoration map's late afternoon, which that map can
    // carry because its roof keeps the key light out of the nave. This one has no roof: the same
    // key reached straight down into the building and lit it like a hall, and dimming the fire's
    // own point lights did nothing because that was never where the brightness came from.
    //
    // Asserted as an absolute rather than against the restoration map, which is free to move back
    // towards daylight without dragging this one along.
    for (const lighting of fireLightings) {
        assert.ok(lighting.key.intensity <= 0.5, 'the key is night, not afternoon');
        assert.ok(lighting.fill.intensity <= 0.2, 'the fill does not undo it');
        // Colour is the only ambient dial a map has, so a bright sky colour is the other way the
        // interior can be flooded from outside.
        assert.ok(lighting.hemisphere.skyColor < 0x333a44, 'the ambient sky stays dark');
    }
});

test('the fire maps share fair telegraphed hazards while the restoration stays static', () => {
    assert.equal(fire.mapHazards, NOTRE_DAME_FIRE_HAZARDS);
    assert.equal(fireArena.mapHazards, NOTRE_DAME_FIRE_HAZARDS);
    assert.equal(restoration.mapHazards, undefined);
    assert.equal(restorationArena.mapHazards, undefined);
    assert.ok(fire.mapHazards.length >= 3);
    assert.ok(fire.mapHazards.every((hazard) => hazard.telegraphSeconds >= 3));
    assert.ok(fire.mapHazards.every((hazard) => hazard.activeSeconds <= 1));
});

test('the interior lamps leave room for the fire that replaces them', () => {
    // Every extra point light costs shader work on every lit surface, so a map gets eight. The
    // breaches, the open roof and the debris cone all want one, and they replace these rather
    // than being added to them.
    assert.ok(fireLights.length <= MAP_LIGHT_SOURCE_LIMIT);
    assert.equal(new Set(fireLights.map((source) => source.id)).size, fireLights.length);
});
