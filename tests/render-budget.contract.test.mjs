import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { getMapPickerMeta } from '../src/shared/maps/MapPickerMeta.js';
import { HEAVY_DIAGNOSTIC_CLUSTERS } from '../scripts/playwright-test-clusters.mjs';
import { summarizeRecords } from '../scripts/summarize-render-budget.mjs';
import { buildRenderBudget, checkRenderBudget } from '../scripts/render-budget-ops.mjs';
import { listRenderBudgetMapKeys, readRenderBudget } from './helpers/render-budget-maps.mjs';

test('every pickable map has a complete render budget and no stale entry remains', () => {
    const budget = readRenderBudget();
    assert.equal(budget.targetFps, 30);
    assert.match(budget.measuredOn, /UHD Graphics 630/, 'budgets are calibrated on the target PC');
    assert.deepEqual(Object.keys(budget.maps).sort(), listRenderBudgetMapKeys().sort());
    for (const [key, entry] of Object.entries(budget.maps)) {
        assert.equal(entry.transparent, undefined, `${key}: transparent meshes are too noisy to budget`);
        for (const field of ['maxCalls', 'maxTriangles', 'pointLights', 'shadowCasters', 'referenceFps']) {
            assert.ok(Number.isFinite(entry[field]) && entry[field] >= 0, `${key}.${field}`);
        }
        assert.equal(entry.belowTargetFps, entry.referenceFps < budget.targetFps, `${key}.belowTargetFps`);
    }
});

function probe({ spawnCalls = 10, calls = 100, triangles = 50_000, point = 1 } = {}) {
    return {
        frames: [{ id: 'spawn', calls: spawnCalls, triangles: 1 }, { id: 'north', calls, triangles }],
        lights: { point },
        meshes: { shadowCasters: 10, transparent: 20 },
    };
}

test('the budget check ignores the rolled spawn station and allows only the stated tolerance', () => {
    const entry = { maxCalls: 100, maxTriangles: 50_000, pointLights: 1, shadowCasters: 10 };
    assert.deepEqual(checkRenderBudget(probe({ spawnCalls: 999 }), entry), { exceeded: [], lowerable: [] });
    assert.deepEqual(checkRenderBudget(probe({ calls: 115 }), entry).exceeded, []);
    assert.deepEqual(checkRenderBudget(probe({ calls: 116 }), entry).exceeded.map((item) => item.key), ['maxCalls']);
    assert.deepEqual(checkRenderBudget(probe({ point: 2 }), entry).exceeded.map((item) => item.key), ['pointLights']);
    assert.deepEqual(checkRenderBudget(probe({ calls: 50 }), entry).lowerable.map((item) => item.key), ['maxCalls']);
});

test('a budget built from several runs keeps the highest counts and the lowest frame rate', () => {
    const record = (calls, fps) => ({ mapKey: 'standard', counts: probe({ calls }), play: { fps } });
    const budget = buildRenderBudget([record(100, 40), record(104, 28.04)], { targetFps: 30, measuredOn: 'x', measuredAt: 'y' });
    assert.equal(budget.maps.standard.maxCalls, 104);
    assert.equal(budget.maps.standard.referenceFps, 28);
    assert.equal(budget.maps.standard.belowTargetFps, true);
});

test('the render budget covers exactly the maps a player can pick', () => {
    const keys = listRenderBudgetMapKeys();
    assert.ok(keys.includes('standard'));
    assert.ok(keys.includes('burg_falkenwacht_arena'));
    assert.ok(!keys.includes('custom'), 'the editor slot holds player-built content');
    for (const key of Object.keys(MAP_PRESET_CATALOG)) {
        const meta = getMapPickerMeta(key);
        const pickable = meta?.tier !== 'dev' && meta?.collection !== 'custom' && !MAP_PRESET_CATALOG[key].hiddenFromMapPicker;
        assert.equal(keys.includes(key), pickable, key);
    }
});

test('the probe runs in its own on-demand cluster', () => {
    const cluster = HEAVY_DIAGNOSTIC_CLUSTERS.find((entry) => entry.id === 'render-budget');
    assert.deepEqual(cluster?.specs, ['tests/map-render-budget.desktop.spec.js']);
});

function record(mapKey, calls, fps) {
    return {
        mapKey,
        counts: {
            frames: [{ id: 'spawn', calls, triangles: 100 }], maxCalls: calls, maxTriangles: 100,
            lights: { point: 2, spot: 0, directional: 1, hemisphere: 1, ambient: 0, rectArea: 0, shadowCasting: 1 },
            meshes: { total: 9, shadowCasters: 4, transparent: 1, transmissive: 0, instanced: 0 },
            textures: 3, geometries: 5, programs: 4,
        },
        play: fps === undefined ? undefined : { fps, p95: 30, gpuMsP50: 12 },
    };
}

test('the summary flags counts that do not repeat and takes the median frame rate', () => {
    const rows = summarizeRecords([
        record('standard', 40, 38), record('standard', 40, 42), record('standard', 40, 40),
        record('maze', 50), record('maze', 51),
    ]);
    const standard = rows.find((row) => row.mapKey === 'standard');
    const maze = rows.find((row) => row.mapKey === 'maze');
    assert.equal(standard.repeatable, true);
    assert.equal(standard.fps, 40);
    assert.equal(standard.pointLights, 2);
    assert.equal(maze.repeatable, false);
    assert.equal(maze.fps, null);
});
