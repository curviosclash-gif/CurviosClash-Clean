import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { CherryLeafController } from '../src/entities/arena/CherryLeafController.js';

// Investigation fixtures: candidates change upload ranges, never simulation arrays.
function gpuHarness() {
    let bound;
    const calls = [];
    const gl = {
        ARRAY_BUFFER: 0x8892, FLOAT: 0x1406,
        createBuffer: () => ({ data: null }),
        bindBuffer(_target, buffer) { bound = buffer; },
        bufferData(_target, source) { bound.data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice(); },
        bufferSubData(_target, offset, source, sourceOffset = 0, count = source.length) {
            const bytes = new Uint8Array(source.buffer, source.byteOffset + sourceOffset * source.BYTES_PER_ELEMENT, count * source.BYTES_PER_ELEMENT);
            bound.data.set(bytes, offset); calls.push(bytes.length);
        },
        deleteBuffer() {},
    };
    const attributes = WebGLAttributes(gl);
    return {
        calls,
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

function prefix(p) {
    if (!p.count) return;
    p.mesh.instanceMatrix.addUpdateRange(0, p.count * 16);
    p.mesh.instanceColor.addUpdateRange(0, p.count * 3);
}

for (const count of [1, 100, 500, 1000]) {
    test(`particle ${count}/1000: active prefix preserves all live GPU matrices and colors`, () => {
        const p = particleFixture(), gpu = gpuHarness();
        p.count = count;
        for (let i = 0; i < count; i++) setParticle(p, i, 10);
        p.update(1 / 60);
        gpu.upload(p.mesh.instanceMatrix); gpu.upload(p.mesh.instanceColor);
        // Color and matrix values move every update; compare active GPU ranges below.
        p.update(1 / 60); prefix(p);
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
    p.update(.02); prefix(p);
    p.update(.02); prefix(p);
    assert.equal(p.count, 66);
    // Keep inactive tail bytes at their last upload: they are excluded by mesh.count.
    for (const attribute of [p.mesh.instanceMatrix, p.mesh.instanceColor]) {
        const stride = attribute === p.mesh.instanceMatrix ? 16 : 3;
        // Inactive tail slots remain untouched and are excluded by mesh.count.
        gpu.upload(attribute);
        assert.ok(attribute.array.slice(0, p.count * stride).every(Number.isFinite));
    }
    p.clear();
    p.count = 1; setParticle(p, 0, 10); p.update(.01); prefix(p);
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

test('cherry candidate uploads only changed groups/slots, preserving flight, expiry, reset and replay matrices', () => {
    const c = cherryFixture(), gpu = gpuHarness();
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    const originalUpdate = c.update;
    const candidate = (seconds) => {
        const versions = c.batches.map((batch) => batch.instanceMatrix.version);
        const changed = new Map();
        const originals = c.batches.map((batch) => batch.setMatrixAt);
        for (const batch of c.batches) batch.setMatrixAt = function (index, matrix) {
            const list = changed.get(this) || []; list.push(index); changed.set(this, list);
            return THREE.InstancedMesh.prototype.setMatrixAt.call(this, index, matrix);
        };
        try { originalUpdate.call(c, seconds); } finally {
            c.batches.forEach((batch, index) => { batch.setMatrixAt = originals[index]; });
        }
        c.batches.forEach((batch, index) => {
            const slots = changed.get(batch);
            if (!slots) batch.instanceMatrix.version = versions[index];
            else for (const slot of slots) batch.instanceMatrix.addUpdateRange(slot * 16, 16);
        });
    };
    c.release(c.leaves[0].index, 0); c.release(c.leaves[2].index, 0);
    const start = gpu.calls.length;
    candidate(2);
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    assert.equal(gpu.calls.slice(start).reduce((a, b) => a + b, 0), 128);
    candidate(40); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    const expiredCalls = gpu.calls.length;
    candidate(41); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    assert.equal(gpu.calls.length, expiredCalls);
    const events = c.serialize();
    c.reset(); for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
    c.applyNetworkState(events); candidate(3);
    for (const batch of c.batches) gpu.upload(batch.instanceMatrix);
});
