import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DandelionSeedRenderBatch } from '../src/entities/arena/DandelionSeedRenderBatch.js';

function makeBatchFixture(count = 40) {
    const scene = new THREE.Group();
    const acheneMaterial = new THREE.MeshBasicMaterial({ color: 0x5b3520 });
    const pappusMaterial = new THREE.MeshBasicMaterial({ color: 0xf5f1dc });
    const seeds = [];
    for (let index = 1; index <= count; index += 1) {
        const node = new THREE.Group();
        node.position.set(index * 0.25, 0, 0);
        node.add(
            new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), acheneMaterial),
            new THREE.Mesh(new THREE.TetrahedronGeometry(0.35), pappusMaterial),
        );
        scene.add(node);
        seeds.push({ index, node, height: 1.8 + (index % 4) * 0.02 });
    }
    scene.updateWorldMatrix(true, true);
    return { scene, seeds };
}

test('large shootable crowns batch a bounded number of geometry variants', () => {
    const { scene, seeds } = makeBatchFixture();
    const batch = DandelionSeedRenderBatch.create(scene, seeds);

    assert.ok(batch);
    assert.deepEqual(batch.getMetrics(), {
        enabled: true,
        batches: 8,
        instances: 40,
        estimatedDrawCalls: 8,
    });
    assert.ok(seeds.every((seed) => seed.node.visible === false));
    assert.ok(batch.root.children.every((mesh) => mesh.isInstancedMesh && mesh.frustumCulled === false));
});

test('render instances follow logical seed transforms and can be hidden without allocation churn', () => {
    const { scene, seeds } = makeBatchFixture();
    const batch = DandelionSeedRenderBatch.create(scene, seeds);
    const seed = seeds[0];
    const entry = batch._entriesBySeed.get(seed)[0];
    const before = new THREE.Matrix4();
    const moved = new THREE.Matrix4();
    const hidden = new THREE.Matrix4();
    entry.mesh.getMatrixAt(entry.instanceId, before);
    const matrixBuffer = entry.mesh.instanceMatrix.array;

    seed.node.position.y += 7;
    batch.beginUpdate();
    batch.updateSeed(seed, true);
    batch.commit();
    entry.mesh.getMatrixAt(entry.instanceId, moved);
    assert.notDeepEqual(moved.elements, before.elements);
    assert.equal(entry.mesh.instanceMatrix.array, matrixBuffer);

    batch.beginUpdate();
    batch.updateSeed(seed, false);
    batch.commit();
    entry.mesh.getMatrixAt(entry.instanceId, hidden);
    assert.equal(hidden.determinant(), 0);
    assert.equal(entry.mesh.instanceMatrix.array, matrixBuffer);
});

test('small crowns retain their original mesh path', () => {
    const { scene, seeds } = makeBatchFixture(3);
    assert.equal(DandelionSeedRenderBatch.create(scene, seeds), null);
    assert.ok(seeds.every((seed) => seed.node.visible === true));
});
