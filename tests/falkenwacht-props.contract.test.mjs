import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { FALKENWACHT_MAPS } from '../src/core/config/maps/presets/burg_falkenwacht/index.js';
import { FALKENWACHT_PROP_MODELS } from '../src/core/config/maps/presets/burg_falkenwacht/FalkenwachtProps.js';

const ROOT = path.resolve('assets/maps/burg_falkenwacht/props');
const FAMILIES = ['woodpile', 'stone-well', 'weapon-rack', 'wall-shield', 'wall-ivy'];

function variantPath(family, index, filename) {
    const stem = `falkenwacht-${family}-v${String(index).padStart(2, '0')}`;
    return path.join(ROOT, `falkenwacht-${family}`, stem, filename);
}

function parseGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    const jsonType = bytes.toString('ascii', 16, 20);
    assert.equal(jsonType, 'JSON', `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

function triangleCount(gltf) {
    return (gltf.meshes || []).reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => {
        assert.equal(primitive.mode ?? 4, 4, 'prop primitives use triangle topology');
        return meshTotal + Number(gltf.accessors?.[primitive.indices]?.count || 0) / 3;
    }, 0), 0);
}

test('Falkenwacht keeps ten editable, collision-free variants for every prop family', () => {
    const fingerprints = new Set();
    let sourceCount = 0;
    let runtimeCount = 0;

    for (const family of FAMILIES) {
        for (let index = 1; index <= 10; index += 1) {
            const source = variantPath(family, index, 'source.blend');
            const runtime = variantPath(family, index, 'runtime.glb');
            assert.equal(existsSync(source), true, `${family} v${index} keeps its Blender source`);
            assert.equal(existsSync(runtime), true, `${family} v${index} keeps its GLB`);
            assert.ok(statSync(source).size > 20_000, `${source} is a non-empty editable scene`);
            assert.ok(statSync(runtime).size > 10_000, `${runtime} is a non-empty runtime asset`);

            const gltf = parseGlb(runtime);
            const meshNodes = (gltf.nodes || []).filter((node) => Number.isInteger(node.mesh));
            assert.equal(meshNodes.length, 1, `${runtime} exports one batched mesh node`);
            assert.ok(meshNodes.every((node) => /_nocol$/i.test(node.name || '')),
                `${runtime} cannot contribute scene collision`);
            assert.equal((gltf.animations || []).length, 0, `${runtime} stays static`);
            const fingerprint = JSON.stringify({
                family,
                triangles: triangleCount(gltf),
                materials: (gltf.materials || []).map((material) => material.name),
                bounds: (gltf.accessors || []).filter((entry) => entry.type === 'VEC3')
                    .map((entry) => [entry.min, entry.max]),
            });
            assert.equal(fingerprints.has(fingerprint), false, `${family} v${index} has distinct geometry`);
            fingerprints.add(fingerprint);
            sourceCount += 1;
            runtimeCount += 1;
        }
    }

    assert.equal(sourceCount, 50);
    assert.equal(runtimeCount, 50);
});

test('both Falkenwacht modes share the curated prop selection within its runtime budget', () => {
    assert.equal(FALKENWACHT_PROP_MODELS.length, 16);
    assert.equal(new Set(FALKENWACHT_PROP_MODELS.map((entry) => entry.id)).size, 16);

    const selectedByFamily = new Map(FAMILIES.map((family) => [family, 0]));
    let selectedBytes = 0;
    let selectedTriangles = 0;
    for (const model of FALKENWACHT_PROP_MODELS) {
        const filePath = path.resolve(model.url);
        assert.equal(existsSync(filePath), true, `${model.id} resolves to a packaged asset`);
        assert.ok(model.targetSize > 0);
        selectedBytes += statSync(filePath).size;
        selectedTriangles += triangleCount(parseGlb(filePath));
        const family = FAMILIES.find((candidate) => model.id.startsWith(`falkenwacht-${candidate}-`));
        assert.ok(family, `${model.id} belongs to a contracted family`);
        selectedByFamily.set(family, selectedByFamily.get(family) + 1);
    }
    assert.ok([...selectedByFamily.values()].every((count) => count >= 3),
        'the placed selection represents every family');
    assert.ok(selectedBytes <= 4 * 1024 * 1024, `placed GLBs stay under 4 MiB (got ${selectedBytes})`);
    assert.ok(selectedTriangles <= 120_000, `placed props stay under 120k triangles (got ${selectedTriangles})`);

    for (const key of ['burg_falkenwacht', 'burg_falkenwacht_arena']) {
        const models = FALKENWACHT_MAPS[key].glbModels;
        assert.deepEqual(models.slice(12, 28).map((entry) => entry.id),
            FALKENWACHT_PROP_MODELS.map((entry) => entry.id));
        assert.equal(FALKENWACHT_MAPS[key].glbColliderMode, 'scene');
    }
});
