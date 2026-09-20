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

// The band, measured in the running game rather than guessed: above the upper bound a
// screenshot had 94 percent of the lit pixels at a saturation below 0.25, which is the
// Notre-Dame flame failure - bright, and colourless. See
// tests/mushroom-proof.desktop.spec.js, which measures it against a map's own lighting.
const EMISSION_MIN = 0.55;
const EMISSION_MAX = 1.0;

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
        // Brightness is colour times strength, because glTF can split it either way: an emission
        // brighter than its colour travels in KHR_materials_emissive_strength, and anything at
        // or below one has to live in the colour. Measuring the product is the only reading that
        // does not depend on which side of one the value happens to fall.
        const emissive = material.emissive;
        const brightness = Math.max(emissive.r, emissive.g, emissive.b) * strength;
        assert.ok(brightness >= EMISSION_MIN - 1e-3 && brightness <= EMISSION_MAX + 1e-3,
            `${entry.name} emits at ${brightness.toFixed(3)}, inside [${EMISSION_MIN}, ${EMISSION_MAX}]`);
        assert.ok(Math.abs(brightness - entry.glow_strength) < 2e-3,
            `${entry.name} keeps its authored brightness, manifest ${entry.glow_strength}, file ${brightness.toFixed(4)}`);
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

test('the glow is not confined to horizontal surfaces', async () => {
    // What this test can prove, and what it cannot.
    //
    // It can prove that the glowing surface is not flat-on-its-back, which catches a glow placed
    // only on the underside of a cap or the top of a bracket - a light aimed at the floor.
    //
    // It cannot prove the glow is *visible*. The trumpet mushrooms once carried their entire
    // glow on the inner wall of their funnel and rendered as black silhouettes in the game;
    // measured on the files, that version scored 15 to 21 percent outward-facing area against
    // 9 to 12 percent for a cap that visibly glowed. Every geometric measure of the file ranks
    // the broken shape above the working one, because the file does not know about occlusion.
    // Visibility is therefore measured where occlusion exists, in
    // tests/mushroom-proof.desktop.spec.js, which renders each clump with and without its
    // emission and compares the two frames.
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
        let angled = 0;
        let area = 0;
        for (let index = 0; index < position.count; index += 3) {
            a.fromBufferAttribute(position, index);
            b.fromBufferAttribute(position, index + 1);
            c.fromBufferAttribute(position, index + 2);
            normal.copy(c).sub(b).cross(a.clone().sub(b));
            const size = normal.length() / 2;
            if (size <= 1e-9) continue;
            area += size;
            // glTF is Y-up: a face is off-horizontal when its normal is not mostly vertical.
            if (Math.abs(normal.normalize().y) < 0.9) angled += size;
        }
        assert.ok(area > 0, `${entry.name} has a glowing surface with area`);
        const share = angled / area;
        assert.ok(share > 0.15,
            `${entry.name}: ${(share * 100).toFixed(0)}% of the glow is off-horizontal`);
    }
});

test('bracket mushrooms grow into negative Z', async () => {
    // Which way a wall bracket faces cannot be derived from the generator by reading it: the
    // half disc is authored in Blender's +Y half space, and the glTF export turns Blender's +Y
    // into the game's -Z. A map that gets this backwards places brackets inside the wall they
    // decorate, which no other assertion notices and every screenshot shows.
    //
    // Maps turn a bracket to face a wall by yaw: 0 points it at -Z, Math.PI at +Z,
    // -Math.PI/2 at +X and Math.PI/2 at -X.
    for (const entry of manifest.mushrooms.filter((row) => row.form === 'shelf')) {
        const gltf = await loadMushroom(entry.name);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        assert.ok(box.max.z <= 0.01, `${entry.name} does not reach past its flat back`);
        assert.ok(box.min.z < -0.2, `${entry.name} grows away from its back, got ${box.min.z}`);
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
