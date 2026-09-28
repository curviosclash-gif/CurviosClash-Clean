import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    DESKTOP_E2E_CLUSTERS,
    DESKTOP_FLOWS_MAP_BOUND_SPECS,
} from '../scripts/playwright-test-clusters.mjs';
import { collectPresetIndex } from '../.claude/skills/verify-scope/scripts/select-verification.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_FLOWS = DESKTOP_E2E_CLUSTERS.find((cluster) => cluster.id === 'desktop-flows').specs;

// A bound spec is skipped when another map changes. A binding that forgets a map the spec
// loads would silently drop that check, so every binding is held against the spec source.

test('map bindings: every bound spec is part of desktop-flows and names existing presets', () => {
    const entries = Object.entries(DESKTOP_FLOWS_MAP_BOUND_SPECS);
    assert.ok(entries.length >= 20, `expected a real binding table, saw ${entries.length}`);
    const { presetNames } = collectPresetIndex(REPO_ROOT);
    for (const [spec, presets] of entries) {
        assert.ok(DESKTOP_FLOWS.includes(spec), `${spec} is not in desktop-flows`);
        assert.ok(presets.length > 0, `${spec} binds no preset`);
        for (const preset of presets) {
            assert.ok(presetNames.has(preset), `${spec}: preset ${preset} does not exist under src/core/config/maps/presets`);
        }
    }
});

test('map bindings: the catalog is loaded and every map key has a preset owner', () => {
    const { catalogLoaded, keyToPresets } = collectPresetIndex(REPO_ROOT);
    assert.equal(catalogLoaded, true, 'without the catalog every map change falls back to the whole cluster');
    assert.ok(keyToPresets.size >= 60, `expected the full catalog, saw ${keyToPresets.size} keys`);
    assert.deepEqual(keyToPresets.get('standard'), ['standard']);
    assert.ok(keyToPresets.get('eiffel_tower_arena').includes('eiffel_tower'));
});

test('map bindings: a bound spec names every preset whose map keys it uses', () => {
    const { keyToPresets } = collectPresetIndex(REPO_ROOT);
    for (const [spec, presets] of Object.entries(DESKTOP_FLOWS_MAP_BOUND_SPECS)) {
        const source = fs.readFileSync(path.join(REPO_ROOT, spec), 'utf8');
        // Quoted keys ('notre_dame') and object keys of per-map tables (`crystal_ruins: [`).
        for (const match of source.matchAll(/['"`]([a-z][a-z0-9_]{3,})['"`]|^\s*([a-z][a-z0-9_]{3,}):\s*[[{]/gm)) {
            const key = match[1] || match[2];
            for (const owner of keyToPresets.get(key) || []) {
                assert.ok(presets.includes(owner), `${spec} uses map key ${key} from preset ${owner} but binds only ${presets.join(', ')}`);
            }
        }
    }
});

test('map bindings: a bound spec names every asset pack it reads directly', () => {
    const { packToPresets } = collectPresetIndex(REPO_ROOT);
    for (const [spec, presets] of Object.entries(DESKTOP_FLOWS_MAP_BOUND_SPECS)) {
        const source = fs.readFileSync(path.join(REPO_ROOT, spec), 'utf8');
        for (const match of source.matchAll(/assets\/maps\/([a-z0-9_]+)\//g)) {
            const owners = packToPresets.get(match[1]) || [];
            assert.ok(owners.some((owner) => presets.includes(owner)), `${spec} reads assets/maps/${match[1]} but binds none of its presets (${owners.join(', ') || 'none'})`);
        }
    }
});
