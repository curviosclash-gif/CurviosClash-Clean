import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_SCHEMA_COLLECTION_LIMITS,
    MAX_MAP_JSON_BYTES,
    createMapDocument,
    parseMapJSON,
} from '../src/entities/MapSchema.js';
import {
    MAX_EMBEDDED_GLB_URL_CHARS,
    normalizeAllowedGLBUrl,
} from '../src/entities/mapSchema/MapSchemaGlbOps.js';

test('map parsing rejects oversized JSON before parsing and excessive object counts', () => {
    const oversized = `{"padding":"${'x'.repeat(MAX_MAP_JSON_BYTES)}"}`;
    assert.throws(() => parseMapJSON(oversized), /exceeds/);
    assert.throws(() => createMapDocument({
        hardBlocks: Array.from(
            { length: MAP_SCHEMA_COLLECTION_LIMITS.hardBlocks + 1 },
            () => ({ x: 0, y: 0, z: 0 }),
        ),
    }), /hardBlocks/);
});

test('map GLB sources allow local model assets and bounded built-ins only', () => {
    const validPath = 'assets/models/downloaded_cc0/pm-abm/Altar01_Art.glb';
    assert.equal(normalizeAllowedGLBUrl(validPath), validPath);
    assert.equal(normalizeAllowedGLBUrl('https://attacker.example/model.glb'), '');
    assert.equal(normalizeAllowedGLBUrl('assets/models/../../secret.glb'), '');
    assert.equal(
        normalizeAllowedGLBUrl(`data:model/gltf-binary;base64,${'A'.repeat(MAX_EMBEDDED_GLB_URL_CHARS)}`),
        '',
    );

    const map = createMapDocument({
        glbModel: 'https://attacker.example/model.glb',
        glbModels: [
            { url: validPath },
            { url: 'data:text/html;base64,SGVsbG8=' },
        ],
    });
    assert.equal('glbModel' in map, false);
    assert.deepEqual(map.glbModels.map((entry) => entry.url), [validPath]);
});
