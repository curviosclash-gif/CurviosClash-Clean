import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_AUDIO_PROFILE, NOTRE_DAME_FIRE_MAPS } from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import {
    NOTRE_DAME_FIRE_MODELS,
    NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS,
    NOTRE_DAME_FIRE_REPLACED_MODEL_IDS,
} from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireModels.js';
import {
    NOTRE_DAME_FIRE_CHECKPOINTS,
    NOTRE_DAME_FIRE_FINISH,
} from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireRoute.js';
import { NOTRE_DAME_SITE_FRAME_MODEL_ID_BY_FRAME_ID } from '../src/core/config/maps/presets/notre_dame/NotreDameSiteFrames.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { MAP_LIGHT_SOURCE_LIMIT } from '../src/shared/contracts/MapLightSourcesContract.js';
import { NOTRE_DAME_FIRE_HAZARDS } from '../src/core/config/maps/presets/notre_dame_fire/NotreDameFireHazards.js';

const fire = NOTRE_DAME_FIRE_MAPS.notre_dame_fire;
const fireArena = NOTRE_DAME_FIRE_MAPS.notre_dame_fire_arena;
const restoration = NOTRE_DAME_MAPS.notre_dame;
const restorationArena = NOTRE_DAME_MAPS.notre_dame_arena;

test('the fire maps use their own deterministic emergency ambience profile', () => {
    assert.equal(NOTRE_DAME_FIRE_AUDIO_PROFILE.id, 'notre_dame_fire');
    assert.equal(fire.audioProfile, NOTRE_DAME_FIRE_AUDIO_PROFILE);
    assert.equal(fireArena.audioProfile, NOTRE_DAME_FIRE_AUDIO_PROFILE);
    assert.equal(fire.audioProfile.interiorBounds, restoration.audioProfile.interiorBounds);
    assert.equal(fire.audioProfile.constructionCenters, restoration.audioProfile.constructionCenters);
    assert.ok(fire.audioProfile.collapse.intervalSeconds >= 20);
});

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

const bracesRemovedMachine = (obstacle) => {
    const modelId = NOTRE_DAME_SITE_FRAME_MODEL_ID_BY_FRAME_ID.get(obstacle?.id);
    return !!modelId && NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS.has(modelId);
};

test('the fire maps fly the same cathedral instead of loading a second copy', () => {
    // Identity, not equality. The geometry is what this map costs; a copy would double the load
    // and let the two buildings drift apart. The obstacle list is the one exception: it is the
    // intact list minus the boxes that brace machines this map does not draw, and every box it
    // keeps is still the very same object.
    const carried = restoration.obstacles.filter((obstacle) => !bracesRemovedMachine(obstacle));
    assert.ok(carried.length < restoration.obstacles.length, 'the site frames are what gets dropped');
    for (const map of [fire, fireArena]) {
        assert.equal(map.glbModels, fire.glbModels);
        assert.equal(map.obstacles, fire.obstacles);
        assert.deepEqual(map.obstacles, carried);
        for (let index = 0; index < carried.length; index += 1) {
            assert.equal(map.obstacles[index], carried[index], 'a kept box is the object the intact map holds');
        }
        assert.equal(map.portals, restoration.portals);
        assert.deepEqual(map.size, restoration.size);
        assert.equal(map.glbColliderMode, 'scene');
        assert.equal(map.glbAuthoredObstaclesCollisionOnly, true);
    }
});

test('no invisible box braces a site machine the fire maps do not draw', () => {
    // glbColliderMode 'scene' plus glbAuthoredObstaclesCollisionOnly means these boxes compile as
    // collision even when the GLBs load, and their visuals are discarded -- so a frame left behind
    // for a removed machine is a wall in mid-air. The hoarding stands on the river approach the
    // route flies in on, and the stone hoist's beam hangs beside an arena bot spawn.
    for (const map of [fire, fireArena]) {
        for (const obstacle of map.obstacles) {
            const modelId = NOTRE_DAME_SITE_FRAME_MODEL_ID_BY_FRAME_ID.get(obstacle?.id);
            assert.ok(
                !modelId || !NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS.has(modelId),
                `${obstacle?.id} braces ${modelId}, which is absent on the night of the fire`,
            );
        }
    }
    for (const frameId of ['nd-site-hoarding-head', 'nd-site-stone-hoist-beam', 'nd-site-scaffold-deck-0']) {
        assert.ok(restoration.obstacles.some((obstacle) => obstacle.id === frameId), `${frameId} braces the site`);
        assert.ok(!fire.obstacles.some((obstacle) => obstacle.id === frameId), `${frameId} is gone with its machine`);
    }
});

test('the fire keeps surviving fabric but removes the later restoration site', () => {
    const burnt = fire.glbModels.filter((model) => model.url.includes('notre_dame_fire'));
    const carried = fire.glbModels.filter((model) => !model.url.includes('notre_dame_fire'));
    const carriedTrees = carried.filter((model) => model.id.startsWith('notre-dame-tree-'));

    // Four surviving fabric parts, four damaged parts and the shared 32-tree island. Fire is
    // particle-only, and the living ground remains identical in both cathedral states.
    assert.equal(fire.glbModels.length, 40);
    assert.equal(burnt.length, 4);
    assert.equal(carried.length, 36);
    assert.equal(carriedTrees.length, 32);
    assert.equal(fire.glbModels, NOTRE_DAME_FIRE_MODELS);
    assert.ok(
        fire.glbModels.every((model) => (
            !model.url.includes('30_fire_')
            && !model.url.includes('31_fire_')
            && !model.url.includes('32_ember_')
            && model.animationClock === undefined
        )),
        'the fire contains no cone or ember GLB effect',
    );
    // The whole point of filtering rather than re-listing: an unburnt part is the same object the
    // intact map holds, so it cannot pick up a different scale, position or url over time.
    for (const model of carried) {
        assert.ok(
            restoration.glbModels.includes(model),
            `${model.id} is carried over from the intact map, not re-declared`,
        );
    }
    for (const id of NOTRE_DAME_FIRE_REPLACED_MODEL_IDS) {
        assert.ok(
            restoration.glbModels.some((model) => model.id === id),
            `${id} exists on the intact map`,
        );
        assert.ok(
            !fire.glbModels.some((model) => model.id === id),
            `${id} is replaced rather than left standing beside its burnt version`,
        );
    }
    for (const id of NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS) {
        assert.ok(restoration.glbModels.some((model) => model.id === id), `${id} belongs to the restoration site`);
        assert.ok(!fire.glbModels.some((model) => model.id === id), `${id} is absent on the night of the fire`);
    }
});

test('every fire-map model points at a file and keeps the right placement contract', () => {
    const METRE = 1.4;
    for (const model of fire.glbModels) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
        if (model.id.startsWith('notre-dame-tree-')) {
            assert.equal(model.targetSize, 14.28, `${model.id} keeps the tree envelope`);
            assert.equal(model.collision, false, `${model.id} stays decorative in the fire map`);
        } else {
            // targetSize would normalise each cathedral file to a size of its own and tear the
            // building apart; the architectural pieces retain their one shared scale factor.
            assert.equal(model.scale, METRE, `${model.id} shares the one scale factor`);
            assert.equal(model.targetSize, undefined, `${model.id} must not be size-normalised`);
        }
    }
    assert.equal(new Set(fire.glbModels.map((model) => model.id)).size, fire.glbModels.length);
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

test('the sun no longer lights a cathedral that has no roof', () => {
    // The profiles started as a copy of the restoration map's late afternoon, which that map can
    // carry because its roof keeps the key light out of the nave. This one has no roof: the same
    // key reached straight down into the building and lit it like a hall, and dimming the fire's
    // own point lights did nothing because that was never where the brightness came from.
    //
    // Asserted as an absolute rather than against the restoration map, which is free to move back
    // towards daylight without dragging this one along.
    for (const lighting of [fire.lighting, fireArena.lighting]) {
        assert.ok(lighting.key.intensity <= 0.5, 'the key is night, not afternoon');
        assert.ok(lighting.fill.intensity <= 0.2, 'the fill does not undo it');
        // Colour is the only ambient dial a map has, so a bright sky colour is the other way the
        // interior can be flooded from outside.
        assert.ok(lighting.hemisphere.skyColor < 0x333a44, 'the ambient sky stays dark');
    }
});

test('the fire route is ranked on its own identity', () => {
    // A shared id would rank runs through two different buildings against each other, and ghosts
    // recorded here would replay against a building that is still standing.
    assert.equal(fire.parcours.routeId, 'notre_dame_fire_v1');
    assert.notEqual(fire.parcours.routeId, restoration.parcours.routeId);
    assert.equal(fire.parcours.checkpoints, NOTRE_DAME_FIRE_CHECKPOINTS);
    assert.equal(fire.parcours.finish, NOTRE_DAME_FIRE_FINISH);
    assert.notEqual(fire.parcours.checkpoints, restoration.parcours.checkpoints);
    assert.notEqual(fire.parcours.finish, restoration.parcours.finish);
    assert.equal(fire.parcours.finish.id, 'FIRE_EVACUATION');
});

test('the fire arena spreads movement over the roof, transept, apse and buttresses', () => {
    const spawns = fireArena.botSpawns;
    assert.ok(spawns.some((entry) => entry.y >= 60), 'one spawn starts at the open roof');
    assert.ok(spawns.some((entry) => Math.abs(entry.z) >= 50), 'transept spawns approach from both sides');
    assert.ok(spawns.some((entry) => entry.x >= 80), 'the apse has its own start vector');
    assert.ok(fireArena.items.some((entry) => entry.id === 'ndf_heavy_buttress'));
    assert.ok(fireArena.gates.some((entry) => entry.id === 'ndf_roof_dive'));
    assert.notEqual(fireArena.gates, restorationArena.gates);
    assert.notEqual(fireArena.items, restorationArena.items);
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
    assert.ok(fire.lights.length <= MAP_LIGHT_SOURCE_LIMIT);
    assert.equal(new Set(fire.lights.map((source) => source.id)).size, fire.lights.length);
});
