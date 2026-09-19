import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve('assets/maps/crystal_ruins/props');
const FAMILIES = Object.freeze({
    'broken-arches': { objectId: 'broken-arch', colliding: new Set([1, 4, 8]) },
    'damaged-columns': { objectId: 'damaged-column', colliding: new Set([3, 5, 7, 10]) },
    'rubble-clusters': { objectId: 'rubble-cluster', colliding: new Set() },
    'crystal-growths': { objectId: 'crystal-growth', colliding: new Set() },
});

function readGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function triangles(document) {
    let count = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessor = primitive.indices ?? primitive.attributes?.POSITION;
            count += (Number(document.accessors?.[accessor]?.count) || 0) / 3;
        }
    }
    return count;
}

function geometrySignature(document) {
    return JSON.stringify({
        meshes: (document.meshes || []).map((mesh) => (mesh.primitives || []).map((primitive) => {
            const position = document.accessors?.[primitive.attributes?.POSITION];
            const indices = document.accessors?.[primitive.indices];
            return { count: indices?.count || position?.count || 0, min: position?.min, max: position?.max };
        })),
        transforms: (document.nodes || []).filter((node) => node.mesh !== undefined).map((node) => ({
            translation: node.translation || [0, 0, 0],
            rotation: node.rotation || [0, 0, 0, 1],
            scale: node.scale || [1, 1, 1],
        })),
    });
}

test('Crystal Ruins ships exactly forty editable and geometrically distinct variants', () => {
    let totalVariants = 0;
    let totalRuntimeBytes = 0;

    for (const [family, expected] of Object.entries(FAMILIES)) {
        const familyRoot = path.join(ROOT, family);
        const variantNames = readdirSync(familyRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        const wanted = Array.from({ length: 10 }, (_, index) => (
            `crystal-ruins-${expected.objectId}-v${String(index + 1).padStart(2, '0')}`
        ));
        assert.deepEqual(variantNames, wanted, `${family} keeps stable v01-v10 IDs`);
        totalVariants += variantNames.length;
        const signatures = new Set();

        for (const variantName of variantNames) {
            const variantRoot = path.join(familyRoot, variantName);
            const blend = readFileSync(path.join(variantRoot, 'source.blend'));
            assert.equal(blend.toString('ascii', 0, 7), 'BLENDER', `${variantName} keeps an editable source`);
            assert.ok(blend.length > 100_000, `${variantName} source is non-empty`);

            const glbPath = path.join(variantRoot, 'runtime.glb');
            const glbBytes = statSync(glbPath).size;
            assert.ok(glbBytes > 20_000 && glbBytes <= 1_000_000, `${variantName} has a budgeted runtime GLB`);
            totalRuntimeBytes += glbBytes;
            const document = readGlb(glbPath);
            signatures.add(geometrySignature(document));
            assert.ok(triangles(document) >= 500 && triangles(document) <= 12_000, `${variantName} stays inside its triangle budget`);
            assert.ok((document.materials?.length || 0) >= 2 && document.materials.length <= 6, `${variantName} uses the shared compact palette`);
            assert.equal(document.animations?.length || 0, 0, `${variantName} is static`);
            assert.equal(document.cameras?.length || 0, 0, `${variantName} exports no camera`);
            assert.equal(document.extensionsUsed?.includes('KHR_lights_punctual') || false, false, `${variantName} exports no realtime light`);
            assert.equal(document.images?.length || 0, 0, `${variantName} embeds no textures`);
            assert.equal(document.textures?.length || 0, 0, `${variantName} embeds no texture resources`);
            for (const material of document.materials || []) {
                const strength = material.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 1;
                assert.ok(strength <= 1.2, `${variantName} keeps crystal emission restrained`);
            }
        }
        assert.equal(signatures.size, 10, `${family} has ten geometric variants, not material swaps`);
    }

    assert.equal(totalVariants, 40);
    assert.ok(totalRuntimeBytes <= 5 * 1024 * 1024, `the complete runtime library stays below 5 MiB (${totalRuntimeBytes} bytes)`);
});

test('Crystal Ruins GLBs expose only the intended coarse collision meshes', () => {
    for (const [family, expected] of Object.entries(FAMILIES)) {
        for (let variant = 1; variant <= 10; variant += 1) {
            const stem = `crystal-ruins-${expected.objectId}-v${String(variant).padStart(2, '0')}`;
            const document = readGlb(path.join(ROOT, family, stem, 'runtime.glb'));
            const meshNames = (document.nodes || [])
                .filter((node) => node.mesh !== undefined)
                .map((node) => String(node.name || ''));
            assert.ok(meshNames.length > 0, `${stem} contains runtime meshes`);
            const colliding = meshNames.filter((name) => !/_nocol$/i.test(name));
            if (expected.colliding.has(variant)) {
                assert.ok(colliding.length > 0, `${stem} carries a coarse visible obstacle body`);
                assert.ok(colliding.every((name) => !/_crystal_|_fracture_|_deposit_/i.test(name)), `${stem} never collides on fine detail`);
            } else {
                assert.equal(colliding.length, 0, `${stem} is consistently decorative`);
            }
        }
    }
});
