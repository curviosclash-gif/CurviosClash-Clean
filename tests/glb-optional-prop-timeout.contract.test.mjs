// A decorative GLB (role optionalProp) that never finishes loading must not hold the whole map:
// it gets a time limit and is dropped like any failed prop. Required worlds keep waiting.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';

const WORLD_URL = 'assets/maps/timeout_probe/glb/world.glb';
const PROP_URL = 'assets/maps/timeout_probe/glb/prop.glb';

function createGltf() {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    return { gltf: { scene, animations: [] }, geometry };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('a decorative GLB that never loads is dropped after its time limit; a slow world still loads', { timeout: 5000 }, async () => {
    const world = createGltf();
    const loader = {
        loadAsync(url) {
            if (url === PROP_URL) return new Promise(() => {});
            return wait(60).then(() => world.gltf);
        },
    };
    const result = await loadGLBMapCollection([
        { id: 'world', url: WORLD_URL, role: 'primaryWorld' },
        { id: 'prop', url: PROP_URL, role: 'optionalProp' },
    ], { loader, optionalPropTimeoutMs: 20 });

    assert.ok(result.scene.getObjectByName('glb-slot-world'), 'the slower world is still placed');
    assert.equal(result.scene.getObjectByName('glb-slot-prop'), undefined);
    assert.ok(result.warnings.some((warning) => /prop/.test(warning) && /time limit/i.test(warning)), result.warnings.join(' | '));
});

test('a decorative GLB that arrives after its time limit is disposed, not leaked', { timeout: 5000 }, async () => {
    const world = createGltf();
    const late = createGltf();
    let disposed = false;
    late.geometry.addEventListener('dispose', () => { disposed = true; });
    const loader = {
        loadAsync(url) {
            return url === PROP_URL ? wait(60).then(() => late.gltf) : Promise.resolve(world.gltf);
        },
    };
    await loadGLBMapCollection([
        { id: 'world', url: WORLD_URL, role: 'primaryWorld' },
        { id: 'prop', url: PROP_URL, role: 'optionalProp' },
    ], { loader, optionalPropTimeoutMs: 20 });
    await wait(120);
    assert.equal(disposed, true);
});

// Slots of one static file share a single decode; later slots get scene clones with the same
// geometry and materials. A slot that runs out of time must not free what its siblings still draw.
test('a late decorative GLB keeps geometry that a sibling slot of the same file still draws', { timeout: 5000 }, async () => {
    const world = createGltf();
    const late = createGltf();
    let disposeEvents = 0;
    late.geometry.addEventListener('dispose', () => { disposeEvents += 1; });
    const loader = {
        loadAsync(url) {
            return url === PROP_URL ? wait(45).then(() => late.gltf) : Promise.resolve(world.gltf);
        },
    };
    // One loader lane: slot A starts first and runs out of time at 30 ms, slot B starts after it
    // and still sees the shared file arrive inside its own limit.
    const result = await loadGLBMapCollection([
        { id: 'propA', url: PROP_URL, role: 'optionalProp', collision: false },
        { id: 'propB', url: PROP_URL, role: 'optionalProp', collision: false },
        { id: 'world', url: WORLD_URL, role: 'primaryWorld' },
    ], { loader, optionalPropTimeoutMs: 30, concurrency: 1 });
    await wait(120);

    assert.equal(result.scene.getObjectByName('glb-slot-propA'), undefined, result.warnings.join(' | '));
    const placed = result.scene.getObjectByName('glb-slot-propB');
    assert.ok(placed, `slot B is placed: ${result.warnings.join(' | ')}`);
    let placedGeometry = null;
    placed.traverse((node) => { if (node.isMesh) placedGeometry = node.geometry; });
    assert.equal(placedGeometry, late.geometry, 'the probe really shares geometry between the slots');
    assert.equal(disposeEvents, 0);
});

// A slot that asks for the shared file in the same tick the file arrives (here: its lane just
// finished another model fed by the same arrival) must count as a holder before the late slot
// releases, or it clones a scene whose geometry was already freed.
test('a slot joining a shared decode in its arrival tick keeps the geometry alive', { timeout: 15000 }, async () => {
    const OTHER_URL = 'assets/maps/timeout_probe/glb/other.glb';
    for (let extraTicks = 0; extraTicks <= 6; extraTicks += 1) {
        const other = createGltf();
        const world = createGltf();
        const disposedGeometries = new Set();
        let decodes = 0;
        // Like GLTFLoader, every decode of the file yields its own objects.
        const decodeProp = () => {
            decodes += 1;
            const prop = createGltf();
            prop.geometry.addEventListener('dispose', () => { disposedGeometries.add(prop.geometry); });
            return prop.gltf;
        };
        const arrival = wait(60);
        const afterTicks = (ticks) => {
            let chained = arrival;
            for (let i = 0; i < ticks; i += 1) chained = chained.then((value) => value);
            return chained;
        };
        // The other model lands one microtask before the shared file: the window the race needs.
        const loader = {
            loadAsync(url) {
                if (url === PROP_URL) return afterTicks(extraTicks + 1).then(decodeProp);
                if (url === OTHER_URL) return afterTicks(extraTicks).then(() => other.gltf);
                return wait(100).then(() => world.gltf);
            },
        };
        const result = await loadGLBMapCollection([
            { id: 'propA', url: PROP_URL, role: 'optionalProp', collision: false },
            { id: 'other', url: OTHER_URL },
            { id: 'world', url: WORLD_URL, role: 'primaryWorld' },
            { id: 'propC', url: PROP_URL, role: 'optionalProp', collision: false },
        ], { loader, optionalPropTimeoutMs: 20, concurrency: 2 });
        await wait(30);

        const placed = result.scene.getObjectByName('glb-slot-propC');
        assert.ok(placed, `extraTicks=${extraTicks}: slot C is placed: ${result.warnings.join(' | ')}`);
        let placedGeometry = null;
        placed.traverse((node) => { if (node.isMesh) placedGeometry = node.geometry; });
        assert.ok(placedGeometry, `extraTicks=${extraTicks}: slot C has a mesh`);
        assert.equal(disposedGeometries.has(placedGeometry), false, `extraTicks=${extraTicks}: slot C draws geometry that was freed`);
        // Without a shared decode the race window is gone and this probe would prove nothing.
        assert.equal(decodes, 1, `extraTicks=${extraTicks}: slot C joined the shared decode`);
    }
});

test('a shared decorative GLB is still disposed once every slot of it ran out of time', { timeout: 5000 }, async () => {
    const world = createGltf();
    const late = createGltf();
    let disposeEvents = 0;
    late.geometry.addEventListener('dispose', () => { disposeEvents += 1; });
    const loader = {
        loadAsync(url) {
            return url === PROP_URL ? wait(60).then(() => late.gltf) : Promise.resolve(world.gltf);
        },
    };
    await loadGLBMapCollection([
        { id: 'propA', url: PROP_URL, role: 'optionalProp', collision: false },
        { id: 'propB', url: PROP_URL, role: 'optionalProp', collision: false },
        { id: 'world', url: WORLD_URL, role: 'primaryWorld' },
    ], { loader, optionalPropTimeoutMs: 20, concurrency: 3 });
    await wait(120);
    assert.equal(disposeEvents, 1);
});
