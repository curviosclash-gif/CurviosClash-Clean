import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { Arena } from '../src/entities/Arena.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { MapFogLayerDriver } from '../src/core/renderer/MapFogLayerDriver.js';

const FOREST_LAYER = {
    stages: [
        { atSeconds: 0, ceiling: 52, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        { atSeconds: 100, ceiling: 52, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        { atSeconds: 140, ceiling: 240, ceilingFalloff: 0, floor: 52, floorFalloff: 0.05 },
    ],
};

function createDriver({ scale = 1 } = {}) {
    const applied = [];
    const driver = new MapFogLayerDriver({ apply: (edges) => applied.push({ ...edges }) });
    driver.setScale(scale);
    return { driver, applied };
}

test('a map without a travelling layer never writes fog edges', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(null);
    driver.update(0);
    driver.update(90);
    assert.equal(applied.length, 0, 'the static lighting profile stays the only writer');
});

test('the edges follow match time', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(FOREST_LAYER);

    driver.update(0);
    assert.deepEqual(applied.at(-1), { height: 52, heightFalloff: 0.05, floor: 0, floorFalloff: 0 });

    driver.update(140);
    const late = applied.at(-1);
    assert.equal(late.heightFalloff, 0, 'the lid is gone');
    assert.equal(late.floor, 52);
    assert.equal(late.floorFalloff, 0.05, 'and the fog now sits above the floor');
});

// Heights are authored in map units and the world is built at a scale; the falloff is a
// reciprocal length and therefore scales the other way, exactly as the static fog height does.
test('heights scale with the world and falloffs scale inversely', () => {
    const { driver, applied } = createDriver({ scale: 3 });
    driver.setLayer(FOREST_LAYER);
    driver.update(0);
    assert.deepEqual(applied.at(-1), { height: 156, heightFalloff: 0.05 / 3, floor: 0, floorFalloff: 0 });
});

test('an unchanged frame writes nothing', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(FOREST_LAYER);
    driver.update(10);
    const afterFirst = applied.length;
    driver.update(10);
    driver.update(10.0000001);
    assert.equal(applied.length, afterFirst, 'the same second does not re-upload uniforms');
    driver.update(120);
    assert.ok(applied.length > afterFirst, 'but a moving band does');
});

test('leaving the map clears the edges exactly once', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(FOREST_LAYER);
    driver.update(140);
    driver.setLayer(null);
    assert.deepEqual(applied.at(-1), { height: 0, heightFalloff: 0, floor: 0, floorFalloff: 0 });
    const afterClear = applied.length;
    driver.setLayer(null);
    driver.update(200);
    assert.equal(applied.length, afterClear, 'and stays quiet afterwards');
});

test('a restart puts the fog back where the round starts', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(FOREST_LAYER);
    driver.update(140);
    driver.update(0);
    assert.deepEqual(applied.at(-1), { height: 52, heightFalloff: 0.05, floor: 0, floorFalloff: 0 });
});

test('a scale change while a round runs reaches the shader on the next frame', () => {
    const { driver, applied } = createDriver();
    driver.setLayer(FOREST_LAYER);
    driver.update(0);
    driver.setScale(2);
    driver.update(0);
    assert.equal(applied.at(-1).height, 104);
});

// The wiring itself: a map states the layer, the arena hands it to the renderer on build, and the
// same map clock that drives the fire, the hazards and the arena size drives the fog too.
test('the map clock drives the fog layer of the map being played', async () => {
    const calls = [];
    const arena = new Arena({
        addToScene() {}, removeFromScene() {},
        setMapLighting(profile, scale) { calls.push(['lighting', scale]); },
        setMapFogLayer(layer) { calls.push(['layer', layer]); },
        updateMapFogLayer(seconds) { calls.push(['clock', seconds]); },
        setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; },
        getMaxAnisotropy() { return 1; },
    });
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.runtimeMapKey = 'fog-layer-probe';
    arena.runtimeMapDefinition = {
        size: [100, 40, 100], obstacles: [], portals: [], gates: [],
        fogLayer: FOREST_LAYER,
    };
    await arena.build(arena.runtimeMapKey);

    const handed = calls.find(([kind]) => kind === 'layer');
    assert.ok(handed, 'the layer reaches the renderer on build');
    assert.deepEqual(handed[1], FOREST_LAYER);
    // After the lighting, because the lighting rig writes the static height terms the layer takes over.
    assert.ok(calls.findIndex(([k]) => k === 'layer') > calls.findIndex(([k]) => k === 'lighting'));

    arena.setGlbAnimationElapsedSeconds(120);
    const ticks = calls.filter(([kind]) => kind === 'clock').map(([, seconds]) => seconds);
    assert.ok(ticks.length > 0, 'the map clock ticks the fog');
    assert.ok(ticks.at(-1) > 0);

    // A map without a layer still reaches the renderer, or the previous map's fog would survive it.
    calls.length = 0;
    arena.runtimeMapKey = 'plain-probe';
    arena.runtimeMapDefinition = { size: [100, 40, 100], obstacles: [], portals: [], gates: [] };
    await arena.build(arena.runtimeMapKey);
    const cleared = calls.find(([kind]) => kind === 'layer');
    assert.ok(cleared, 'the renderer is told about the map without a layer as well');
    assert.equal(cleared[1], undefined);
});
