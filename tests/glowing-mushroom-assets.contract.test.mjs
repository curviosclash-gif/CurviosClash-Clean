import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The contract between scripts/generate_glowing_mushroom_assets.py and every map that places
// these models. Three of the assertions below exist because the generator got them wrong first
// and the mistake was only visible in a render:
//
//  - emission strength has to stay under two, or the scene tone mapping turns the glow white and
//    the mushroom loses the colour that made it read as glowing at all;
//  - every mesh has to keep its `_nocol` marker, or GLBMapLoader builds colliders from organic
//    shapes nobody expects to die on;
//  - the glow has to reach a surface that faces sideways. A cap that only glows underneath is a
//    dark lump with freckles from every angle a player actually flies at.
//
// The last one cannot be checked from a render here, so it is checked as geometry: the glowing
// material has to cover a span of the model's full width, not just its footprint.
const ASSET_ROOT = path.resolve('assets/models/glowing_mushroom');
const MANIFEST_PATH = path.join(ASSET_ROOT, 'manifest.json');

const FORMS = ['cap', 'trumpet', 'coral', 'shelf'];
const VARIANTS = 3;
const HUES = ['teal', 'violet', 'amber'];

// Budgets. These are placed by the dozen on maps that already pay for their own geometry, so the
// ceiling is what keeps a decorated cellar cheaper than the cellar.
const MAX_TRIANGLES = 2_600;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 1.2 * 1024 * 1024;
const MAX_MESHES = 2;

// The band from the Notre-Dame fire lesson: below this the emission loses against a lit map,
// above it the tone map saturates the colour to white.
const EMISSION_MIN = 1.1;
const EMISSION_MAX = 1.8;

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

async function loadMushroom(name) {
    const bytes = await readFile(path.join(ASSET_ROOT, `${name}.glb`));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new GLTFLoader().parseAsync(buffer, '');
}

function meshes(root) {
    const found = [];
    root.traverse((node) => { if (node.isMesh) found.push(node); });
    return found;
}

function triangleCount(mesh) {
    const geometry = mesh.geometry;
    return (geometry.index?.count ?? geometry.attributes.position.count) / 3;
}

test('the manifest describes four silhouettes in three variants each', () => {
    assert.equal(manifest.mushrooms.length, FORMS.length * VARIANTS);
    for (const form of FORMS) {
        const entries = manifest.mushrooms.filter((entry) => entry.form === form);
        assert.equal(entries.length, VARIANTS, `${form} has ${VARIANTS} variants`);
        // Every silhouette carries all three hues, so a map can pick a colour without being
        // forced into one shape to get it.
        assert.deepEqual([...entries.map((entry) => entry.hue)].sort(), [...HUES].sort(),
            `${form} covers every hue`);
    }
});

test('the variants of a silhouette actually differ', () => {
    // Stratified sampling is only worth its complexity if it produces a visible spread. A family
    // whose variants sit within a few percent of each other is one model placed three times.
    for (const form of FORMS) {
        const heights = manifest.mushrooms
            .filter((entry) => entry.form === form)
            .map((entry) => entry.height);
        const spread = (Math.max(...heights) - Math.min(...heights)) / Math.max(...heights);
        assert.ok(spread > 0.15,
            `${form} variants span more than 15% in height, got ${(spread * 100).toFixed(1)}%`);
    }
});

test('every mesh stays decorative and within budget', async () => {
    let total = 0;
    for (const entry of manifest.mushrooms) {
        const gltf = await loadMushroom(entry.name);
        const found = meshes(gltf.scene);
        assert.ok(found.length > 0, `${entry.name} has geometry`);
        assert.ok(found.length <= MAX_MESHES,
            `${entry.name} draws in at most ${MAX_MESHES} calls, got ${found.length}`);
        for (const mesh of found) {
            // GLBMapLoader keys collision off this marker; see its `_nocol` check.
            assert.ok(mesh.name.toLowerCase().includes('_nocol'),
                `${entry.name}: mesh ${mesh.name} is marked decorative`);
        }
        const triangles = found.reduce((sum, mesh) => sum + triangleCount(mesh), 0);
        assert.ok(triangles <= MAX_TRIANGLES,
            `${entry.name} stays under ${MAX_TRIANGLES} triangles, got ${triangles}`);
        assert.equal(triangles, entry.triangles, `${entry.name} matches its manifest count`);
        assert.equal(gltf.animations.length, 0, `${entry.name} is static decoration`);

        const bytes = statSync(path.join(ASSET_ROOT, `${entry.name}.glb`)).size;
        assert.ok(bytes <= MAX_FILE_BYTES, `${entry.name} stays under ${MAX_FILE_BYTES} bytes`);
        total += bytes;
    }
    assert.ok(total <= MAX_TOTAL_BYTES,
        `the family stays under ${MAX_TOTAL_BYTES} bytes, got ${total}`);
});

test('the glow survives the tone map', async () => {
    for (const entry of manifest.mushrooms) {
        const gltf = await loadMushroom(entry.name);
        const emitting = [];
        for (const mesh of meshes(gltf.scene)) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) {
                const strength = material.emissiveIntensity ?? 0;
                const emissive = material.emissive ?? new THREE.Color(0, 0, 0);
                if (emissive.getHex() === 0x000000 || strength <= 0) continue;
                emitting.push({ material, strength, mesh });
            }
        }
        assert.equal(emitting.length, 1, `${entry.name} has exactly one glowing material`);
        const [{ material, strength }] = emitting;
        assert.ok(strength >= EMISSION_MIN && strength <= EMISSION_MAX,
            `${entry.name} emits at ${strength}, inside [${EMISSION_MIN}, ${EMISSION_MAX}]`);
        // Compared with a tolerance, not exactly: glTF stores the strength as a 32-bit float.
        // The value has to survive the export unscaled, which it only does while every hue peaks
        // at 1.0 - the exporter folds any lower peak into the strength instead.
        assert.ok(Math.abs(strength - entry.glow_strength) < 1e-4,
            `${entry.name} keeps its authored strength, manifest ${entry.glow_strength}, file ${strength}`);
        // Near-black base colour. A bright base also receives the map's own light, and the tone
        // map then washes out the emission on top of it.
        const base = material.color;
        assert.ok(Math.max(base.r, base.g, base.b) < 0.12,
            `${entry.name} keeps a near-black base colour, got ${base.getHexString()}`);
        // The emission has to be a colour, not white: saturation is what carries the impression
        // of brightness once bloom is off, which it is by default.
        const hsl = material.emissive.getHSL({ h: 0, s: 0, l: 0 });
        assert.ok(hsl.s > 0.55, `${entry.name} emits a saturated hue, got saturation ${hsl.s}`);
    }
});

test('the glow faces sideways, not only down', async () => {
    // Measured on the face normals, not on the bounding box. The box of an underside-only glow
    // is exactly as wide as the box of a rim band, so a box check passes the very mistake this
    // guards against: a cap that lights the ground under itself and reads as a dark lump from
    // every angle a player flies at. A surface counts as sideways when its normal is more than
    // about 25 degrees off vertical.
    for (const entry of manifest.mushrooms) {
        const gltf = await loadMushroom(entry.name);
        const glowing = meshes(gltf.scene).filter((mesh) => {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            return materials.some((material) => (material.emissiveIntensity ?? 0) > 0
                && material.emissive.getHex() !== 0x000000);
        });
        assert.equal(glowing.length, 1, `${entry.name} keeps its glow in one mesh`);
        const geometry = glowing[0].geometry.toNonIndexed();
        const position = geometry.attributes.position;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const normal = new THREE.Vector3();
        let sideways = 0;
        let area = 0;
        for (let index = 0; index < position.count; index += 3) {
            a.fromBufferAttribute(position, index);
            b.fromBufferAttribute(position, index + 1);
            c.fromBufferAttribute(position, index + 2);
            normal.copy(c).sub(b).cross(a.clone().sub(b));
            const size = normal.length() / 2;
            if (size <= 1e-9) continue;
            area += size;
            // glTF is Y-up: a face whose normal has a large horizontal share points outward.
            if (Math.abs(normal.normalize().y) < 0.9) sideways += size;
        }
        assert.ok(area > 0, `${entry.name} has a glowing surface with area`);
        const share = sideways / area;
        assert.ok(share > 0.15,
            `${entry.name}: ${(share * 100).toFixed(0)}% of the glow faces sideways`);
    }
});

test('each model stands on its own origin plane', async () => {
    for (const entry of manifest.mushrooms) {
        const gltf = await loadMushroom(entry.name);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        // GLBMapLoader offsets a placed model by its own bounding box minimum, so a model that
        // dips below its origin is placed correctly but reports a height it does not have.
        assert.ok(box.min.y >= -0.01,
            `${entry.name} does not reach below its ground plane, got ${box.min.y}`);
        assert.ok(Math.abs((box.max.y - box.min.y) - entry.height) < 0.01,
            `${entry.name} matches the height in its manifest`);
    }
});
