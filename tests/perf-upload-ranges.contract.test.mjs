import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { CherryLeafController } from '../src/entities/arena/CherryLeafController.js';

// Exercise production uploads through Three's actual WebGLAttributes implementation.
function gpuHarness() {
    let bound;
    const calls = [];
    const allocations = [];
    const gl = {
        ARRAY_BUFFER: 0x8892, FLOAT: 0x1406,
        createBuffer: () => ({ data: null }),
        bindBuffer(_target, buffer) { bound = buffer; },
        bufferData(_target, source) {
            allocations.push(source.byteLength);
            bound.data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
        },
        bufferSubData(_target, offset, source, sourceOffset = 0, count = source.length) {
            const bytes = new Uint8Array(source.buffer, source.byteOffset + sourceOffset * source.BYTES_PER_ELEMENT, count * source.BYTES_PER_ELEMENT);
            bound.data.set(bytes, offset); calls.push(bytes.length);
        },
        deleteBuffer() {},
    };
    const attributes = WebGLAttributes(gl);
    return {
        calls, allocations,
        upload(attribute) {
            attributes.update(attribute, gl.ARRAY_BUFFER);
            const actual = attributes.get(attribute).buffer.data;
            const expected = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
            assert.ok(actual.every((byte, index) => byte === expected[index]), 'uploaded bytes must equal the complete CPU attribute');
        },
    };
}

function particleFixture() {
    const p = new ParticleSystem({ addToScene() {}, removeFromScene() {} });
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 1000; i++) p.mesh.setMatrixAt(i, matrix);
    p.mesh.setColorAt(0, new THREE.Color(1, .5, .1));
    return p;
}

function setParticle(p, i, life) {
    p.positions.set([i * .2, 3, 5], i * 3);
    p.velocities.set([.1, .2, .3], i * 3);
    p.colors.set([1, .5, .1], i * 3);
    p.lifetimes[i] = life; p.maxLifetimes[i] = Math.max(1, life);
    p.gravities[i] = -.5; p.scales[i] = .4;
}

for (const count of [1, 100, 500, 1000]) {
    test(`particle ${count}/1000: active prefix preserves all live GPU matrices and colors`, () => {
        const p = particleFixture(), gpu = gpuHarness();
        p.count = count;
        for (let i = 0; i < count; i++) setParticle(p, i, 10);
        p.update(1 / 60);
        gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
        // Color and matrix values move every update; compare active GPU ranges below.
        p.update(1 / 60);
        const start = gpu.calls.length;
        // Only prefix equality is meaningful after compaction; this case has no dead slots.
        gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
        assert.equal(gpu.calls.slice(start).reduce((a, b) => a + b, 0), count * 76);
        assert.deepEqual(p.mesh.instanceMatrix.updateRanges, []);
        assert.deepEqual(p.mesh.instanceColor.updateRanges, []);
        p.dispose();
    });
}

test('particle prefix handles compaction, accumulated invisible updates, clear and respawn without stale live data', () => {
    const p = particleFixture(), gpu = gpuHarness();
    p.count = 100;
    for (let i = 0; i < 100; i++) setParticle(p, i, i % 3 === 0 ? .02 : 10);
    p.update(.01); gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
    p.update(.02);
    p.update(.02);
    assert.equal(p.count, 66);
    // Keep inactive tail bytes at their last upload: they are excluded by mesh.count.
    for (const attribute of [p.mesh.instanceMatrix, p.mesh.instanceColor]) {
        const stride = attribute === p.mesh.instanceMatrix ? 16 : 3;
        // Inactive tail slots remain untouched and are excluded by mesh.count.
        gpu.upload(attribute);
        assert.ok(attribute.array.slice(0, p.count * stride).every(Number.isFinite));
    }
    p.clear();
    p.count = 1; setParticle(p, 0, 10); p.update(.01);
    gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
    assert.equal(p.mesh.count, 1);
    p.dispose();
});

function cherryFixture() {
    const scene = new THREE.Group();
    for (let group = 0; group < 4; group++) {
        const geometry = new THREE.PlaneGeometry(.1 + group * .01, .2);
        const material = new THREE.MeshBasicMaterial({ color: 0xeeaaaa });
        for (let i = 0; i < 40; i++) {
            const leaf = new THREE.Mesh(geometry, material);
            leaf.position.set(group * 10 + i * .1, 2, group);
            leaf.userData.role = 'wind_leaf'; scene.add(leaf);
        }
    }
    return new CherryLeafController(scene);
}

test('cherry uploads only changed groups/slots, preserving flight, expiry, reset and replay matrices', () => {
    const c = cherryFixture(), gpu = gpuHarness();
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    c.release(c.leaves[0].index, 0); c.release(c.leaves[2].index, 0);
    const start = gpu.calls.length;
    c.update(2);
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    assert.equal(gpu.calls.slice(start).reduce((a, b) => a + b, 0), 128);
    c.update(40); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    const expiredCalls = gpu.calls.length;
    c.update(41); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    assert.equal(gpu.calls.length, expiredCalls);
    const events = c.serialize();
    c.reset(); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    c.applyNetworkState(events); c.update(3);
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
});

test('cherry ranges survive merged uploads, hidden updates, expiry and a network reset before rendering', () => {
    const c = cherryFixture(), gpu = gpuHarness();
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    const batch = c.leaves[0].batchGroup.batch;
    c.release(1, 0);
    c.update(1);
    batch.visible = false;
    c.update(2);
    c.update(3);
    const hiddenCalls = gpu.calls.length;
    assert.ok(batch.instanceMatrix.updateRanges.length > 0, 'hidden group keeps its unsent leaf range');
    for (const visibleBatch of c.batches) if (visibleBatch.visible) gpu.upload(visibleBatch.instanceMatrix);
    assert.equal(gpu.calls.length, hiddenCalls, 'hidden group is not treated as uploaded');
    batch.visible = true;
    gpu.upload(batch.instanceMatrix);
    assert.equal(gpu.calls.at(-1), 64, 'reappearing group uploads only the changed leaf matrix');
    assert.deepEqual(batch.instanceMatrix.updateRanges, []);

    batch.visible = false;
    c.applyNetworkState([[2, 0, 1, 0, 0]]); // Divergent replay resets all slots while hidden.
    c.update(4);
    const pendingRanges = batch.instanceMatrix.updateRanges.length;
    assert.ok(pendingRanges > 0);
    for (const visibleBatch of c.batches) if (visibleBatch.visible) gpu.upload(visibleBatch.instanceMatrix);
    batch.visible = true;
    gpu.upload(batch.instanceMatrix);
    assert.ok(batch.instanceMatrix.updateRanges.length === 0);
    c.update(5);
    const start = gpu.calls.length;
    for (const visibleBatch of c.batches) gpu.upload(visibleBatch.instanceMatrix);
    assert.equal(gpu.calls.slice(start).reduce((a, b) => a + b, 0), 64);
    assert.equal(c.serialize().length, 1);
});

test('particle spawn and recycling accumulate a single bounded prefix before the first and later uploads', () => {
    const p = particleFixture(), gpu = gpuHarness();
    p.spawn(new THREE.Vector3(), 100, 0xff8800);
    assert.deepEqual(p.mesh.instanceMatrix.updateRanges, [{ start: 0, count: 1600 }]);
    gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
    assert.deepEqual(p.mesh.instanceMatrix.updateRanges, []);
    p.spawnDirectional(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 100, 0xff8800);
    p.update(.01);
    assert.equal(p.mesh.instanceMatrix.updateRanges.length, 1);
    assert.equal(p.mesh.instanceMatrix.updateRanges[0].count, 3200);
    gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
    p.spawn(new THREE.Vector3(), 1100, 0xff8800);
    p.update(.01);
    gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
    assert.equal(p.count, 1000);
    p.clear();
    assert.deepEqual(p.mesh.instanceMatrix.updateRanges, []);
    p.dispose();
});

test('a fresh WebGLAttributes context receives complete current particle and leaf buffers', () => {
    const firstContext = gpuHarness(), recreatedContext = gpuHarness();
    const particles = particleFixture();
    particles.count = 100;
    for (let i = 0; i < particles.count; i++) setParticle(particles, i, 10);
    particles.update(.01);
    firstContext.upload(particles.mesh.instanceMatrix);
    firstContext.upload(particles.mesh.instanceColor);
    particles.update(.01);
    firstContext.upload(particles.mesh.instanceMatrix);
    firstContext.upload(particles.mesh.instanceColor);
    const particleAllocationsBefore = recreatedContext.allocations.length;
    recreatedContext.upload(particles.mesh.instanceMatrix);
    recreatedContext.upload(particles.mesh.instanceColor);
    assert.deepEqual(recreatedContext.allocations.slice(particleAllocationsBefore), [
        particles.mesh.instanceMatrix.array.byteLength,
        particles.mesh.instanceColor.array.byteLength,
    ]);

    const leaves = cherryFixture();
    for (const batch of leaves.batches) firstContext.upload(batch.instanceMatrix);
    leaves.release(1, 0);
    leaves.update(1);
    firstContext.upload(leaves.batches[0].instanceMatrix);
    const leafAllocationsBefore = recreatedContext.allocations.length;
    recreatedContext.upload(leaves.batches[0].instanceMatrix);
    assert.equal(recreatedContext.allocations.at(-1), leaves.batches[0].instanceMatrix.array.byteLength);
    assert.equal(recreatedContext.allocations.length, leafAllocationsBefore + 1);
    particles.dispose();
});

test('an already initialized second WebGLAttributes context catches up after the first clears update ranges', () => {
    const firstContext = gpuHarness(), secondContext = gpuHarness();
    const particles = particleFixture();
    particles.count = 100;
    for (let i = 0; i < particles.count; i++) setParticle(particles, i, 10);
    particles.update(.01);
    for (const context of [firstContext, secondContext]) {
        context.upload(particles.mesh.instanceMatrix);
        context.upload(particles.mesh.instanceColor);
    }
    particles.update(.01);
    firstContext.upload(particles.mesh.instanceMatrix);
    firstContext.upload(particles.mesh.instanceColor);
    const secondStart = secondContext.calls.length;
    secondContext.upload(particles.mesh.instanceMatrix);
    secondContext.upload(particles.mesh.instanceColor);
    assert.deepEqual(secondContext.calls.slice(secondStart), [
        particles.mesh.instanceMatrix.array.byteLength,
        particles.mesh.instanceColor.array.byteLength,
    ], 'the stale context full-uploads after the first context consumes the shared ranges');

    const leaves = cherryFixture();
    for (const context of [firstContext, secondContext]) {
        for (const batch of leaves.batches) context.upload(batch.instanceMatrix);
    }
    leaves.release(1, 0);
    leaves.update(1);
    firstContext.upload(leaves.batches[0].instanceMatrix);
    const leafStart = secondContext.calls.length;
    secondContext.upload(leaves.batches[0].instanceMatrix);
    assert.equal(secondContext.calls.slice(leafStart).reduce((sum, bytes) => sum + bytes, 0),
        leaves.batches[0].instanceMatrix.array.byteLength);
    particles.dispose();
});
