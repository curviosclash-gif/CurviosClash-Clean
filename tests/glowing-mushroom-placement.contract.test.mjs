import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
    MUSHROOM_FACING,
    MUSHROOM_FORMS,
    MUSHROOM_HUES,
    MUSHROOM_VARIANTS,
    mushroom,
    mushroomPatch,
    mushroomWallRow,
} from '../src/core/config/maps/presets/glowing_mushrooms.js';

const ASSET_ROOT = path.resolve('assets/models/glowing_mushroom');
const manifest = JSON.parse(await readFile(path.join(ASSET_ROOT, 'manifest.json'), 'utf8'));

test('the hue table matches the generated assets', () => {
    // The placement helper carries its own copy of the form/variant/hue mapping so maps do not
    // have to read the manifest at runtime. That copy is only useful while it is true.
    for (const entry of manifest.mushrooms) {
        assert.equal(MUSHROOM_VARIANTS[entry.form][entry.variant], entry.hue,
            `${entry.name} is ${entry.hue}`);
    }
    assert.deepEqual([...MUSHROOM_FORMS].sort(),
        [...new Set(manifest.mushrooms.map((entry) => entry.form))].sort());
    assert.deepEqual([...MUSHROOM_HUES].sort(),
        [...new Set(manifest.mushrooms.map((entry) => entry.hue))].sort());
});

test('every placeable URL points at a file that exists', () => {
    for (const form of MUSHROOM_FORMS) {
        for (const variant of Object.keys(MUSHROOM_VARIANTS[form])) {
            const placed = mushroom(`probe-${form}-${variant}`, form, Number(variant), [0, 0, 0], 10);
            assert.ok(existsSync(path.resolve(placed.url)), `${placed.url} exists`);
        }
    }
});

test('a placed mushroom is decoration with a render distance', () => {
    const placed = mushroom('probe', 'cap', 1, [4, 5, 6], 12, { rotationY: 0.5 });
    assert.equal(placed.collision, false, 'nothing collides with decoration');
    assert.ok(placed.maxRenderDistance > 0, 'decoration stops being drawn at some distance');
    assert.deepEqual([...placed.position], [4, 5, 6]);
    assert.equal(placed.rotation[1], 0.5);
    assert.equal(placed.targetSize, 12);
});

test('unknown forms and variants are refused at authoring time', () => {
    // A map preset is data, so a typo in it has no stack trace at runtime - the model simply
    // never appears. Failing while the preset module loads turns that into a visible error.
    assert.throws(() => mushroom('probe', 'toadstool', 1, [0, 0, 0], 10), /unknown mushroom form/);
    assert.throws(() => mushroom('probe', 'cap', 7, [0, 0, 0], 10), /unknown cap variant/);
    assert.throws(() => mushroomPatch({
        id: 'probe', centre: [0, 0, 0], radius: 10, count: 3, size: [4, 6],
        forms: ['shelf'], hues: ['chartreuse'],
    }), /no mushroom variant matches/);
});

test('a patch is deterministic, unique and inside its own radius', () => {
    const spec = {
        id: 'probe-patch', centre: [100, 8, -40], radius: 20, count: 12, size: [5, 9], seed: 42,
    };
    const first = mushroomPatch(spec);
    const second = mushroomPatch(spec);
    assert.deepEqual(first, second, 'two builds of the same patch agree');

    assert.equal(new Set(first.map((entry) => entry.id)).size, first.length, 'ids are unique');
    for (const placed of first) {
        const dx = placed.position[0] - spec.centre[0];
        const dz = placed.position[2] - spec.centre[2];
        assert.ok(Math.hypot(dx, dz) <= spec.radius + 1e-9, `${placed.id} stays inside the radius`);
        assert.equal(placed.position[1], spec.centre[1], `${placed.id} stands on the given ground`);
        assert.ok(placed.targetSize >= 5 && placed.targetSize <= 9, `${placed.id} respects its size range`);
    }
    // A patch that draws one variant twelve times is one model placed twelve times.
    assert.ok(new Set(first.map((entry) => entry.url)).size >= 4, 'a patch mixes its variants');
});

test('a patch honours a requested colour scheme', () => {
    const patch = mushroomPatch({
        id: 'probe-teal', centre: [0, 0, 0], radius: 10, count: 8, size: [4, 6],
        hues: ['teal'], seed: 7,
    });
    const tealFiles = manifest.mushrooms
        .filter((entry) => entry.hue === 'teal')
        .map((entry) => `assets/models/glowing_mushroom/${entry.name}.glb`);
    for (const placed of patch) {
        assert.ok(tealFiles.includes(placed.url), `${placed.id} is teal`);
    }
});

test('each facing turns a bracket away from its own wall', async () => {
    // The four yaw values are checked against the file, not against the arithmetic that produced
    // them. A bracket rotated by its facing has to end up growing towards the middle of the
    // room; if a value is wrong, the model reaches into the wall and nothing else notices.
    const bytes = await readFile(path.join(ASSET_ROOT, 'shelf_v01.glb'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    // Which way the room lies from each wall.
    const expected = {
        fromMinZ: new THREE.Vector3(0, 0, 1),
        fromMaxZ: new THREE.Vector3(0, 0, -1),
        fromMinX: new THREE.Vector3(1, 0, 0),
        fromMaxX: new THREE.Vector3(-1, 0, 0),
    };
    for (const [wall, yaw] of Object.entries(MUSHROOM_FACING)) {
        const model = gltf.scene.clone(true);
        model.rotation.set(0, yaw, 0);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const reach = box.getCenter(new THREE.Vector3());
        reach.y = 0;
        assert.ok(reach.length() > 0.05, `${wall} leaves the bracket off centre`);
        assert.ok(reach.normalize().dot(expected[wall]) > 0.9,
            `${wall} points the bracket into the room, got ${reach.toArray().map((v) => v.toFixed(2))}`);
    }
});

test('a wall row runs from start to end and faces the room', () => {
    const row = mushroomWallRow({
        id: 'probe-row', start: [-10, 2, 30], end: [10, 9, 30], count: 5, size: [3, 5],
        facing: Math.PI, seed: 3,
    });
    assert.equal(row.length, 5);
    assert.deepEqual([...row[0].position], [-10, 2, 30]);
    assert.deepEqual([...row[4].position], [10, 9, 30]);
    for (const placed of row) {
        assert.ok(placed.url.includes('shelf_'), 'a wall row is made of brackets');
        // Facing is jittered so a row does not read as a printed pattern, but never by enough
        // to turn a bracket back into the wall it grows out of.
        assert.ok(Math.abs(placed.rotation[1] - Math.PI) < 0.3, `${placed.id} still faces the room`);
    }
});
