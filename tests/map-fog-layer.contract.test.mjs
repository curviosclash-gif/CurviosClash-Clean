import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_FOG_LAYER_CONTRACT_VERSION,
    MAP_FOG_LAYER_RANGES,
    createMapFogLayerState,
    normalizeMapFogLayer,
    resolveMapFogLayerState,
} from '../src/shared/contracts/MapFogLayerContract.js';

// The forest's round arc: for the first 100 seconds the fog fills everything below y=52, so the
// ground is blind and the canopy is clear. Over the next 40 seconds the band rises, and from then
// on the fog sits above y=52 instead - the ground clears and the canopy goes blind.
const FOREST_LAYER = {
    stages: [
        { atSeconds: 0, ceiling: 52, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        { atSeconds: 100, ceiling: 52, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        { atSeconds: 140, ceiling: 240, ceilingFalloff: 0, floor: 52, floorFalloff: 0.05 },
    ],
};

test('a map without a fog layer resolves to nothing rather than to a default band', () => {
    assert.equal(normalizeMapFogLayer(undefined), null);
    assert.equal(normalizeMapFogLayer({}), null);
    assert.equal(normalizeMapFogLayer({ stages: [] }), null);
    // One stage is a constant fog, which the lighting profile already expresses.
    assert.equal(normalizeMapFogLayer({ stages: [{ atSeconds: 0, ceiling: 10 }] }), null);
    assert.ok(MAP_FOG_LAYER_CONTRACT_VERSION.startsWith('map-fog-layer.'));
});

test('stages are ordered by time and frozen', () => {
    const layer = normalizeMapFogLayer({
        stages: [
            { atSeconds: 140, ceiling: 240, ceilingFalloff: 0, floor: 52, floorFalloff: 0.05 },
            { atSeconds: 0, ceiling: 52, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        ],
    });
    assert.equal(layer.stages.length, 2);
    assert.equal(layer.stages[0].atSeconds, 0);
    assert.equal(layer.stages[1].atSeconds, 140);
    assert.ok(Object.isFrozen(layer.stages[0]));
    assert.throws(() => { layer.stages.push({}); });
});

test('out of range values are clamped instead of reaching the shader', () => {
    const layer = normalizeMapFogLayer({
        stages: [
            { atSeconds: -20, ceiling: 1, ceilingFalloff: 9, floor: 0, floorFalloff: -3 },
            { atSeconds: 99999, ceiling: 1e9, ceilingFalloff: 0.01, floor: -1e9, floorFalloff: 0.01 },
        ],
    });
    assert.equal(layer.stages[0].atSeconds, MAP_FOG_LAYER_RANGES.atSeconds.min);
    assert.equal(layer.stages[0].ceilingFalloff, MAP_FOG_LAYER_RANGES.falloff.max);
    assert.equal(layer.stages[0].floorFalloff, MAP_FOG_LAYER_RANGES.falloff.min);
    assert.equal(layer.stages[1].atSeconds, MAP_FOG_LAYER_RANGES.atSeconds.max);
    assert.equal(layer.stages[1].ceiling, MAP_FOG_LAYER_RANGES.height.max);
    assert.equal(layer.stages[1].floor, MAP_FOG_LAYER_RANGES.height.min);
});

test('the band holds, rises and holds again', () => {
    const layer = normalizeMapFogLayer(FOREST_LAYER);
    const state = createMapFogLayerState();

    // Before the rise: a lid at 52, no floor - everything below is fog, the canopy is clear.
    resolveMapFogLayerState(layer, 0, state);
    assert.equal(state.ceiling, 52);
    assert.equal(state.floorFalloff, 0);
    resolveMapFogLayerState(layer, 100, state);
    assert.equal(state.ceiling, 52);
    assert.equal(state.floorFalloff, 0);

    // Halfway through the rise both edges are half-established: a band.
    resolveMapFogLayerState(layer, 120, state);
    assert.equal(state.ceiling, 146);
    assert.equal(state.floor, 26);
    assert.ok(state.floorFalloff > 0 && state.floorFalloff < 0.05);
    assert.ok(state.ceilingFalloff > 0 && state.ceilingFalloff < 0.05);

    // After the rise: a floor at 52, no lid - the ground is clear and the canopy is fog.
    resolveMapFogLayerState(layer, 140, state);
    assert.equal(state.floor, 52);
    assert.equal(state.floorFalloff, 0.05);
    assert.equal(state.ceilingFalloff, 0);
});

test('the state is derived from match time, so it never drifts apart between clients', () => {
    const layer = normalizeMapFogLayer(FOREST_LAYER);
    const stepped = createMapFogLayerState();
    // One client ticks its way there in sixtieths of a second, another jumps straight to it.
    for (let frame = 0; frame <= 120 * 60; frame += 1) {
        resolveMapFogLayerState(layer, frame / 60, stepped);
    }
    const jumped = resolveMapFogLayerState(layer, 120);
    assert.deepEqual({ ...stepped }, { ...jumped });

    // A restart puts it back at the start rather than leaving it where the last round ended.
    resolveMapFogLayerState(layer, 0, stepped);
    assert.deepEqual({ ...stepped }, { ...resolveMapFogLayerState(layer, 0) });
});

test('times outside the authored range hold the first and last stage', () => {
    const layer = normalizeMapFogLayer(FOREST_LAYER);
    assert.deepEqual({ ...resolveMapFogLayerState(layer, -50) }, { ...resolveMapFogLayerState(layer, 0) });
    assert.deepEqual({ ...resolveMapFogLayerState(layer, 9000) }, { ...resolveMapFogLayerState(layer, 140) });
    // A missing layer must leave a caller's state untouched rather than zero the map's own fog.
    const untouched = resolveMapFogLayerState(null, 10, createMapFogLayerState());
    assert.equal(untouched, null);
});

test('two stages at the same second do not divide by zero', () => {
    const layer = normalizeMapFogLayer({
        stages: [
            { atSeconds: 30, ceiling: 10, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
            { atSeconds: 30, ceiling: 90, ceilingFalloff: 0, floor: 10, floorFalloff: 0.05 },
        ],
    });
    const state = resolveMapFogLayerState(layer, 30);
    assert.ok(Number.isFinite(state.ceiling));
    assert.equal(state.ceiling, 90, 'the later stage wins once its second is reached');
});
