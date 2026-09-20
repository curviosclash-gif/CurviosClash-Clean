import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { EIFFEL_TOWER_HISTORIC_MODELS } from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerHistoricProps.js';
import { VERDANT_APERTURE_MAP } from '../src/core/config/maps/presets/verdant_aperture.js';

const ASSET_ROOT = path.resolve('assets/models/ancient_tree');
const COLORED_MATERIALS = new Set([
    'AncientBark', 'LeafForest', 'LeafSage', 'LeafSunlit', 'LeafDry',
]);
const MATERIAL_NAMES = [
    'AncientBark', 'BarkCrevice', 'BarkRaisedFiber', 'LeafDry',
    'LeafForest', 'LeafSage', 'LeafSunlit', 'ShelfFungus',
];

function assetSet(index = null) {
    if (index === null) {
        return {
            hero: path.join(ASSET_ROOT, 'ancient_tree.glb'),
            lod1: path.join(ASSET_ROOT, 'ancient_tree_lod1.glb'),
            lod2: path.join(ASSET_ROOT, 'ancient_tree_lod2.glb'),
            collision: path.join(ASSET_ROOT, 'ancient_tree_collision.glb'),
        };
    }
    const number = String(index).padStart(2, '0');
    const root = path.join(ASSET_ROOT, 'variants', `variant_${number}`);
    return {
        hero: path.join(root, `ancient_tree_${number}.glb`),
        lod1: path.join(root, `ancient_tree_${number}_lod1.glb`),
        lod2: path.join(root, `ancient_tree_${number}_lod2.glb`),
        collision: path.join(root, `ancient_tree_${number}_collision.glb`),
    };
}

const ASSET_SETS = [assetSet(), ...Array.from({ length: 10 }, (_, index) => assetSet(index + 1))];
const VISIBLE_FILES = ASSET_SETS.flatMap(({ hero, lod1, lod2 }) => [hero, lod1, lod2]);

function parseGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
    return { bytes, document };
}

function triangleCount(document) {
    return (document.meshes || []).reduce((total, mesh) => total + mesh.primitives.reduce(
        (sum, primitive) => sum + Number(document.accessors?.[primitive.indices]?.count || 0) / 3,
        0,
    ), 0);
}

function hasEffectiveColorSource(document, primitive) {
    const material = document.materials?.[primitive.material];
    const pbr = material?.pbrMetallicRoughness;
    const factor = pbr?.baseColorFactor;
    const hasNonWhiteFactor = Array.isArray(factor)
        && factor.slice(0, 3).some((value) => Number(value) < 0.999);
    return hasNonWhiteFactor || Boolean(pbr?.baseColorTexture)
        || Number.isInteger(primitive.attributes?.COLOR_0);
}

test('every Ancient Tree runtime material has an effective glTF color source', () => {
    assert.equal(VISIBLE_FILES.length, 33);
    for (const filePath of VISIBLE_FILES) {
        const { document } = parseGlb(filePath);
        const seenColoredMaterials = new Set();
        for (const mesh of document.meshes || []) {
            for (const primitive of mesh.primitives || []) {
                const material = document.materials?.[primitive.material];
                assert.ok(material, `${filePath} has a material for every visible primitive`);
                assert.ok(hasEffectiveColorSource(document, primitive),
                    `${filePath}: ${material.name} would load as untextured white`);
                if (COLORED_MATERIALS.has(material.name)) seenColoredMaterials.add(material.name);
            }
        }
        assert.deepEqual([...seenColoredMaterials].sort(), [...COLORED_MATERIALS].sort(),
            `${filePath} keeps the complete bark and leaf palette`);
    }
});

test('canonical and variant exports preserve hero, LOD, material and collision contracts', () => {
    for (const files of ASSET_SETS) {
        const hero = parseGlb(files.hero).document;
        const lod1 = parseGlb(files.lod1).document;
        const lod2 = parseGlb(files.lod2).document;
        const collision = parseGlb(files.collision).document;
        const heroTriangles = triangleCount(hero);
        const lod1Triangles = triangleCount(lod1);
        const lod2Triangles = triangleCount(lod2);

        for (const [label, document] of [['hero', hero], ['LOD1', lod1], ['LOD2', lod2]]) {
            assert.equal(document.meshes?.length, 6, `${files[label.toLowerCase()] || files.hero}: six meshes`);
            assert.deepEqual((document.materials || []).map((entry) => entry.name).sort(), MATERIAL_NAMES,
                `${label} keeps the approved material assignment`);
        }
        assert.equal(hero.animations?.length, 2, `${files.hero} keeps both wind morph animations`);
        assert.equal(lod1.animations?.length ?? 0, 0, `${files.lod1} stays static`);
        assert.equal(lod2.animations?.length ?? 0, 0, `${files.lod2} stays static`);
        assert.ok(heroTriangles >= 100_000 && heroTriangles <= 155_000, `${files.hero} hero triangle budget`);
        assert.ok(lod1Triangles < heroTriangles * 0.65, `${files.lod1} reduces hero geometry`);
        assert.ok(lod2Triangles < lod1Triangles * 0.5, `${files.lod2} reduces LOD1 geometry`);
        assert.ok(statSync(files.hero).size > statSync(files.lod1).size, `${files.hero} is larger than LOD1`);
        assert.ok(statSync(files.lod1).size > statSync(files.lod2).size, `${files.lod1} is larger than LOD2`);
        assert.ok(statSync(files.hero).size < 16_000_000, `${files.hero} stays inside the asset size budget`);

        assert.equal(collision.meshes?.length, 7, `${files.collision} keeps seven coarse volumes`);
        assert.equal(triangleCount(collision), 196, `${files.collision} keeps the collision triangle budget`);
        assert.equal(collision.materials?.length ?? 0, 0, `${files.collision} contains no render materials`);
        assert.equal(collision.animations?.length ?? 0, 0, `${files.collision} stays static`);
    }
});

async function loadRuntimeGlb(filePath) {
    const bytes = readFileSync(filePath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new GLTFLoader().parseAsync(buffer, '');
}

function loadedPalette(gltf) {
    const palette = new Map();
    gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
            if (!COLORED_MATERIALS.has(material?.name)) continue;
            const color = node.geometry.getAttribute('color');
            const white = material.color?.r >= 0.999
                && material.color?.g >= 0.999 && material.color?.b >= 0.999;
            assert.ok(material.map || !white || color,
                `${material.name} must not load as untextured #ffffff`);
            assert.ok(color, `${material.name} keeps its exported COLOR_0 attribute`);
            const mean = [0, 0, 0];
            for (let index = 0; index < color.count; index += 1) {
                mean[0] += color.getX(index);
                mean[1] += color.getY(index);
                mean[2] += color.getZ(index);
            }
            palette.set(material.name, mean.map((value) => value / color.count));
        }
    });
    return palette;
}

test('real GLTFLoader retains colors for an Eiffel LOD2 and the Verdant Aperture LOD1 tree', async () => {
    const eiffelTree = EIFFEL_TOWER_HISTORIC_MODELS.find((entry) => entry.id.startsWith('eiffel-tree-'));
    const verdantTree = VERDANT_APERTURE_MAP.verdant_aperture.glbModels
        .find((entry) => entry.url.includes('/ancient_tree/'));
    assert.match(eiffelTree.url, /_lod2\.glb$/);
    assert.match(verdantTree.url, /_lod1\.glb$/);

    for (const model of [eiffelTree, verdantTree]) {
        const palette = loadedPalette(await loadRuntimeGlb(path.resolve(model.url)));
        assert.deepEqual([...palette.keys()].sort(), [...COLORED_MATERIALS].sort(),
            `${model.url} loads all five colored materials`);
        const leaves = ['LeafForest', 'LeafSage', 'LeafSunlit', 'LeafDry'];
        for (let left = 0; left < leaves.length; left += 1) {
            for (let right = left + 1; right < leaves.length; right += 1) {
                const distance = Math.hypot(...palette.get(leaves[left]).map(
                    (value, channel) => value - palette.get(leaves[right])[channel],
                ));
                assert.ok(distance > 0.025,
                    `${model.url}: ${leaves[left]} and ${leaves[right]} stay visibly distinct`);
            }
        }
    }
});
