import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { parseMapAssetArgs, resolveMapAssetJobs } from '../scripts/map-asset-jobs.mjs';

test('map asset selection rejects ambiguous and unsafe requests before generation', () => {
    for (const args of [[], ['--all', '--map', 'standard'], ['--all', '--part', 'roof'], ['--bogus']]) {
        assert.throws(() => parseMapAssetArgs(args));
    }
    for (const key of ['custom', '../outside', 'missing']) {
        assert.throws(() => resolveMapAssetJobs({ mapKeys: [key] }));
    }
    assert.throws(() => resolveMapAssetJobs({ mapKeys: ['chrono_forge_nexus'], part: '../outside' }));
    assert.throws(() => resolveMapAssetJobs({ mapKeys: ['burg_falkenwacht'], part: '01_terrain' }),
        /placement and collision together/);
});

test('all includes each built-in map and deduplicates shared Blender packs', () => {
    const plan = resolveMapAssetJobs({ all: true });
    assert.equal(plan.selectedMaps.length, 59);
    assert.equal(plan.selectedMaps.includes('custom'), false);
    assert.equal(plan.jobs.length, 11);
    assert.equal(new Set(plan.jobs.map((job) => job.pack)).size, 11);
    for (const job of plan.jobs) assert.equal(job.parts.length, new Set(job.parts).size);
    assert.ok(plan.nativeMaps.includes('maze'), 'unconverted geometry is reported explicitly');
    assert.equal(plan.nativeMaps.includes('standard'), false);
});

test('a part export lists every dependent variant without touching other parts', () => {
    const plan = resolveMapAssetJobs({ mapKeys: ['chrono_forge_nexus'], part: '05_temple_gates' });
    assert.equal(plan.jobs.length, 1);
    assert.deepEqual(plan.jobs[0].parts, ['05_temple_gates']);
    assert.ok(plan.jobs[0].affectedMaps.includes('chrono_forge_nexus'));
    const shared = resolveMapAssetJobs({ mapKeys: ['notre_dame'], part: '01_west_facade' });
    assert.ok(shared.jobs[0].affectedMaps.includes('notre_dame_fire'));
    assert.ok(shared.jobs[0].affectedMaps.includes('notre_dame_arena'));
});

test('asset paths in every job belong to the selected map references', () => {
    for (const [key, map] of Object.entries(MAP_PRESET_CATALOG)) {
        if (key === 'custom') continue;
        const plan = resolveMapAssetJobs({ mapKeys: [key] });
        for (const job of plan.jobs) {
            for (const part of job.parts) {
                assert.ok(map.glbModels.some((model) => model.url === `assets/maps/${job.pack}/glb/${part}.glb`));
            }
        }
    }
});

test('the actual dry-run command needs no Blender executable and writes no assets', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-map-assets.mjs', '--all', '--dry-run',
        '--blender', 'this-executable-must-not-run'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.selectedMaps.length, 59);
    assert.equal(plan.jobs.length, 11);
});

test('mixed generation rejects missing coverage before invoking Blender for any map', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-map-assets.mjs', '--map', 'standard',
        '--map', 'maze', '--blender', 'this-executable-must-not-run'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No Blender generator registered for: maze\. No assets were written/);
    assert.doesNotMatch(result.stderr, /Blender failed/);
});
