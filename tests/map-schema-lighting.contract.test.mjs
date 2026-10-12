// A map's own lighting must survive the editor map format: saved, parsed, converted for the
// match. The stored form keeps only what the author stated, so a map without, say, a rim light
// still takes the rim light of the active graphics style, exactly like a built-in map does.

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { parseMapJSON, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import {
    DEFAULT_MAP_LIGHTING,
    normalizeAuthoredMapLighting,
    resolveMapLighting,
} from '../src/shared/contracts/MapLightingContract.js';

// The classic style base differs from the default in every section, so a field the author left
// out must come from it, not from the default.
const CLASSIC_BASE = {
    key: { direction: [30, 50, 30], color: 0xffffff, intensity: 0.8 },
    fill: { direction: [-20, 30, -10], color: 0x4466aa, intensity: 0.3 },
    rim: { direction: [-35, 18, -45], color: 0x39d9ff, intensity: 0.62 },
    hemisphere: { skyColor: 0x223344, groundColor: 0x223344 },
    fog: { color: 0x050510, near: 50, far: 200 },
    skyDome: { zenithColor: 0x02050f, horizonColor: 0x17355a, nadirColor: 0x070914 },
    starsVisible: false,
    exposureOffset: 0,
};

const presetLightings = Object.entries(MAP_PRESET_CATALOG)
    .filter(([, preset]) => preset?.lighting && typeof preset.lighting === 'object')
    .map(([key, preset]) => [key, preset.lighting]);

test('every built-in lighting resolves the same after the stored form, under both style bases', () => {
    assert.ok(presetLightings.length >= 10, `only ${presetLightings.length} lit maps`);
    for (const [key, lighting] of presetLightings) {
        const stored = JSON.parse(JSON.stringify(normalizeAuthoredMapLighting(lighting)));
        for (const base of [DEFAULT_MAP_LIGHTING, CLASSIC_BASE]) {
            assert.deepEqual(resolveMapLighting(stored, base), resolveMapLighting(lighting, base), key);
        }
    }
});

test('the stored form keeps only stated fields and clamps them like the match does', () => {
    const stored = normalizeAuthoredMapLighting({
        key: { intensity: 99 },
        fog: { far: 5000, color: '#ff0000' },
        starsVisible: false,
        unknown: { deep: 'x' },
    });
    assert.deepEqual(stored, {
        key: { intensity: 4 },
        fog: { far: 1000, color: 0xff0000 },
        starsVisible: false,
    });
});

test('missing or broken lighting is no lighting at all', () => {
    for (const value of [undefined, null, [], 'abc', 7, {}, { fog: 'x' }, { unknown: 1 }]) {
        assert.equal(normalizeAuthoredMapLighting(value), undefined, JSON.stringify(value));
    }
});

test('an editor map carries its lighting through parse and into the match map', () => {
    const lighting = MAP_PRESET_CATALOG.toybox_titan.lighting;
    const parsed = parseMapJSON(JSON.stringify({
        arenaSize: { width: 4200, height: 1400, depth: 4200 },
        lighting,
    }));
    assert.deepEqual(parsed.map.lighting, normalizeAuthoredMapLighting(lighting));
    const runtime = toArenaMapDefinition(parsed.map, { mapScale: 35 }).map;
    assert.deepEqual(resolveMapLighting(runtime.lighting), resolveMapLighting(lighting));
});

test('an editor map without lighting stays without, so old files load unchanged', () => {
    const parsed = parseMapJSON(JSON.stringify({ arenaSize: { width: 2800, height: 950, depth: 2400 } }));
    assert.equal('lighting' in parsed.map, false);
    assert.equal('lighting' in toArenaMapDefinition(parsed.map, { mapScale: 35 }).map, false);
});
