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
