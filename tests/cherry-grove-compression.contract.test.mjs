import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CHERRY_TREE_PATH, compressCherryGroveTree, decompressCherryGroveTree, readGlb, semanticGlbHash } from '../scripts/compress-cherry-grove-glb.mjs';

const source = await readFile(CHERRY_TREE_PATH);
// Fingerprints of the authored, uncompressed model before introducing the delivery codec.
const ORIGINAL_MODEL = '98882bbed6af0bd449b7dd85247245d418d1fbcda772fe6318544a8471bae1ec';
const ORIGINAL_PETAL_INDICES = 'b1e202ffa78c1e7e551da7db40dd2cf25b875ea6f43161920f4abb3be0607111';

test('all decoded geometry, materials, transforms, hierarchy and wind anchors match the original model', async () => {
    assert.equal(await semanticGlbHash(source), ORIGINAL_MODEL);
    assert.ok(source.length <= 5968736);
});

test('compressed and placeholder ranges conform to the required meshopt extension', () => {
    const { document } = readGlb(source);
    assert.ok(document.extensionsRequired.includes('EXT_meshopt_compression'));
    for (const view of document.bufferViews) {
        assert.ok((view.byteOffset || 0) + view.byteLength <= document.buffers[view.buffer].byteLength);
        const encoded = view.extensions?.EXT_meshopt_compression;
        if (!encoded) continue;
        assert.equal(encoded.mode, 'INDICES');
        assert.equal(encoded.filter || 'NONE', 'NONE');
        assert.equal(view.byteLength, encoded.count * encoded.byteStride);
        assert.equal(document.buffers[view.buffer].extensions.EXT_meshopt_compression.fallback, true);
        assert.notEqual(encoded.buffer, view.buffer);
        assert.ok(encoded.byteOffset + encoded.byteLength <= document.buffers[encoded.buffer].byteLength);
    }
});

test('the actual Three loader decodes the original petal index order and retains all leaf anchors', async () => {
    const data = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, '');
    const petals = loaded.scene.getObjectByName('Akebono_Petals_ConsolidatedMesh');
    const indices = petals.geometry.index.array;
    assert.equal(createHash('sha256').update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)).digest('hex'), ORIGINAL_PETAL_INDICES);
    let leaves = 0;
    loaded.scene.traverse(node => { if (node.userData.role === 'wind_leaf') leaves++; });
    assert.equal(leaves, 48);
});

test('packing is idempotent and the authoring-tool roundtrip restores the exact model', async () => {
    assert.deepEqual(await compressCherryGroveTree(source), source);
    const decoded = await decompressCherryGroveTree(source);
    assert.equal(readGlb(decoded).document.extensionsRequired?.includes('EXT_meshopt_compression') || false, false);
    assert.equal(await semanticGlbHash(decoded), ORIGINAL_MODEL);
});
