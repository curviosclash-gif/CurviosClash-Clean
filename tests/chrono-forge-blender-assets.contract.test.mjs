import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CHRONO_FORGE_NEXUS_MAP } from '../src/core/config/maps/presets/chrono_forge_nexus.js';

const ASSET_ROOT = path.resolve('assets/maps/chrono_forge');
const EXPECTED_SETPIECES = Object.freeze({
    '01_hangar_crane': 12,
    '02_machine_core': 8,
    '03_crystal_shards': 6,
    '04_chronometer': 16,
    '05_temple_gates': 10,
    '06_airship': 14,
    '07_drone_swarm': 9,
    '08_time_core': 7,
});

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

test('Chrono-Forge Blender sources and GLBs expose one correctly timed loop each', () => {
    for (const [name, expectedDuration] of Object.entries(EXPECTED_SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps an editable Blender source`);
        assert.ok(statSync(glbPath).size > 10_000, `${name} exports a non-empty GLB`);

        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1, `${name} has exactly one loader-compatible clip`);
        assert.ok(document.animations[0].channels.length > 0, `${name} clip animates scene nodes`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expectedDuration) <= (1 / 30),
            `${name} keeps its authored loop duration`,
        );

        const collidableMeshNodes = (document.nodes || []).filter((node) => (
            node.mesh !== undefined && !String(node.name || '').toLowerCase().endsWith('_nocol')
        ));
        assert.deepEqual(collidableMeshNodes, [], `${name} marks every animated mesh as _nocol`);
    }
});

test('Chrono-Forge map places every animated setpiece without GLB collision', () => {
    const map = CHRONO_FORGE_NEXUS_MAP.chrono_forge_nexus;
    const placedFiles = new Set(map.glbModels.map((model) => path.basename(model.url, '.glb')));

    assert.equal(map.glbColliderMode, 'fallbackOnly');
    for (const name of Object.keys(EXPECTED_SETPIECES)) {
        assert.ok(placedFiles.has(name), `${name} is placed in the map`);
    }
});
