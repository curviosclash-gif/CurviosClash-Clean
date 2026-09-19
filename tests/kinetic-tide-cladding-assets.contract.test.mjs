import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';


const ROOT = path.resolve('assets/maps/kinetic_tide/props');
const FAMILIES = Object.freeze([
    'kinetic-tide-machine-frame',
    'kinetic-tide-bearing-flange',
    'kinetic-tide-warning-beacon',
    'kinetic-tide-maintenance-panel',
]);

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with JSON`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function triangleCount(document) {
    return (document.meshes || []).flatMap((mesh) => mesh.primitives || []).reduce((sum, primitive) => {
        const accessor = document.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
        return sum + Math.floor((Number(accessor?.count) || 0) / 3);
    }, 0);
}

function bounds(document) {
    const positionAccessors = (document.meshes || []).flatMap((mesh) => mesh.primitives || [])
        .map((primitive) => document.accessors?.[primitive.attributes?.POSITION])
        .filter((accessor) => Array.isArray(accessor?.min) && Array.isArray(accessor?.max));
    const minimum = [0, 1, 2].map((axis) => Math.min(...positionAccessors.map((entry) => entry.min[axis])));
    const maximum = [0, 1, 2].map((axis) => Math.max(...positionAccessors.map((entry) => entry.max[axis])));
    return maximum.map((value, axis) => value - minimum[axis]);
}

test('Kinetic Tide keeps exactly forty editable, static cladding variants', () => {
    let total = 0;

    for (const family of FAMILIES) {
        const familyRoot = path.join(ROOT, family);
        const variants = readdirSync(familyRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        assert.deepEqual(
            variants,
            Array.from({ length: 10 }, (_, index) => `${family}-v${String(index + 1).padStart(2, '0')}`),
            `${family} keeps its stable ten-variant library`,
        );
        total += variants.length;

        const geometrySignatures = new Set();
        for (const variant of variants) {
            const sourcePath = path.join(familyRoot, variant, 'source.blend');
            const runtimePath = path.join(familyRoot, variant, 'runtime.glb');
            assert.ok(statSync(sourcePath).size > 100_000, `${variant} has an editable source`);
            assert.ok(statSync(runtimePath).size > 10_000, `${variant} has a runtime export`);

            const document = readGlbJson(runtimePath);
            const meshNodes = (document.nodes || []).filter((node) => node.mesh !== undefined);
            assert.ok(meshNodes.length > 0 && meshNodes.length <= 6,
                `${variant} batches geometry into at most one mesh per material`);
            assert.equal(document.meshes?.length, meshNodes.length);
            assert.ok(meshNodes.every((node) => node.name.includes('_nocol')),
                `${variant} marks every exported mesh as decorative`);
            assert.ok(meshNodes.every((node) => node.extras?.variant_id === variant));
            assert.ok(meshNodes.every((node) => node.extras?.collision_role === 'decorative-nocol'));
            assert.equal(document.animations?.length || 0, 0, `${variant} has no animation`);
            assert.equal(document.cameras?.length || 0, 0, `${variant} has no camera`);
            assert.equal(document.extensions?.KHR_lights_punctual?.lights?.length || 0, 0,
                `${variant} has no realtime light`);
            assert.equal(document.skins?.length || 0, 0, `${variant} has no skin`);
            assert.ok((document.materials?.length || 0) <= 6, `${variant} keeps material count small`);
            assert.ok((document.materials || []).every((material) => (
                material.pbrMetallicRoughness
                && Number.isFinite(material.pbrMetallicRoughness.metallicFactor)
                && Number.isFinite(material.pbrMetallicRoughness.roughnessFactor)
            )), `${variant} exports explicit metallic-roughness PBR`);

            const triangles = triangleCount(document);
            const size = bounds(document);
            assert.ok(triangles > 0 && triangles <= 8000, `${variant} has ${triangles} triangles`);
            assert.ok(size.every((value) => Number.isFinite(value) && value > 0),
                `${variant} has finite positive dimensions`);
            geometrySignatures.add(`${triangles}:${size.map((value) => value.toFixed(3)).join(',')}`);

            if (family === 'kinetic-tide-warning-beacon') {
                assert.ok((document.materials || []).some((material) => (
                    material.emissiveFactor?.some((component) => component > 0)
                )), `${variant} keeps an emissive signal material`);
            }
        }
        assert.equal(geometrySignatures.size, 10,
            `${family} variants differ in geometry or silhouette, not merely colour`);
    }

    assert.equal(total, 40, 'the reusable cladding library contains exactly forty variants');
});
