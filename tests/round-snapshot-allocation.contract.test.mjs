import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundSnapshotStore } from '../src/state/recorder/RoundSnapshotStore.js';

const PARTICLE_VALUE_STRIDE = 13;

function createParticleSource(count) {
    const positions = [];
    const velocities = [];
    const colors = [];
    const lifetimes = [];
    const maxLifetimes = [];
    const gravities = [];
    const scales = [];
    for (let i = 0; i < count; i++) {
        positions.push(i * 3, i * 3 + 1, i * 3 + 2);
        velocities.push(-i, i, i * 2);
        colors.push(0.25, 0.5, 0.75);
        lifetimes.push(1 + i);
        maxLifetimes.push(4 + i);
        gravities.push(-9);
        scales.push(0.5 + i);
    }
    return { count, positions, velocities, colors, lifetimes, maxLifetimes, gravities, scales };
}

function createSource(particleCount) {
    return {
        players: [{
            index: 0,
            alive: true,
            isBot: false,
            position: { x: 1, y: 2, z: 3 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        }],
        particles: createParticleSource(particleCount),
    };
}

// A single-slot ring makes every capture reuse the same snapshot object, which is exactly
// the situation the per-frame allocation churn used to happen in.
function createSingleSlotStore() {
    return new RoundSnapshotStore({ maxSnapshots: 1, timeProvider: () => 1 });
}

test('particle values live in a typed array instead of a grown-and-truncated plain array', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(4));

    const buffer = store.snapshots[0].particleValues;
    assert.ok(ArrayBuffer.isView(buffer), 'particleValues must be a typed array');
    assert.equal(buffer.constructor, Float32Array);
});

test('repeated captures reuse the same particle buffer, whatever the particle count does', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(4));
    const firstBuffer = store.snapshots[0].particleValues;

    // The count swinging up and back down is what used to reallocate the backing store on
    // every single capture.
    for (const count of [0, 12, 1, 64, 0, 192, 7]) {
        store.capture(createSource(count));
        assert.equal(
            store.snapshots[0].particleValues,
            firstBuffer,
            `capture with ${count} particles must not replace the buffer`
        );
    }
});

test('the particle buffer is never shrunk below the replay cap once allocated', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(192));
    const fullLength = store.snapshots[0].particleValues.length;
    assert.ok(fullLength >= 192 * PARTICLE_VALUE_STRIDE);

    store.capture(createSource(1));
    assert.equal(store.snapshots[0].particleValues.length, fullLength);
    assert.equal(store.snapshots[0].particleCount, 1);
});

test('stale values beyond the current particle count never reach consumers', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(8));
    store.capture(createSource(2));

    const [snapshot] = store.getOrderedSnapshots();
    assert.equal(snapshot.particles.count, 2);
    // The buffer still holds the older, longer capture - the emitted clip must not.
    assert.equal(snapshot.particles.values.length, 2 * PARTICLE_VALUE_STRIDE);
});

test('particle payloads survive the typed-array round trip', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(3));

    const [snapshot] = store.getOrderedSnapshots();
    assert.equal(snapshot.particles.count, 3);
    for (let i = 0; i < 3; i++) {
        const base = i * PARTICLE_VALUE_STRIDE;
        assert.equal(snapshot.particles.values[base], i * 3, 'position x');
        assert.equal(snapshot.particles.values[base + 1], i * 3 + 1, 'position y');
        assert.equal(snapshot.particles.values[base + 3], -i, 'velocity x');
        assert.equal(snapshot.particles.values[base + 6], 1 + i, 'lifetime');
        assert.equal(snapshot.particles.values[base + 7], 4 + i, 'max lifetime');
        assert.equal(snapshot.particles.values[base + 8], -9, 'gravity');
        assert.equal(snapshot.particles.values[base + 10], 0.25, 'colour r');
    }
});

test('the emitted clip keeps a plain array so the ghost clip consumer still recognises it', () => {
    const store = createSingleSlotStore();
    store.capture(createSource(2));

    const [snapshot] = store.getOrderedSnapshots();
    // RoundRecorder.getLastRoundGhostClip() gates on Array.isArray before copying the
    // values; handing it a typed array would silently drop every replay particle.
    assert.ok(Array.isArray(snapshot.particles.values));
});

test('a source without projectiles, powerups or turrets captures without allocating lists', () => {
    const store = createSingleSlotStore();
    store.capture({ players: [], particles: createParticleSource(0) });

    const snapshot = store.snapshots[0];
    assert.equal(snapshot.projectileCount, 0);
    assert.equal(snapshot.powerupCount, 0);
    assert.equal(snapshot.turretCount, 0);
    assert.equal(snapshot.particleCount, 0);
});

test('entity slot arrays grow once and are then reused across captures', () => {
    const store = createSingleSlotStore();
    const withProjectiles = {
        players: [],
        particles: createParticleSource(0),
        projectiles: [
            { id: 'p1', type: 'mg', position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, radius: 1 },
            { id: 'p2', type: 'rocket', position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 }, radius: 2 },
        ],
    };
    store.capture(withProjectiles);
    const slots = store.snapshots[0].projectiles;
    const firstSlot = slots[0];

    store.capture(withProjectiles);
    assert.equal(store.snapshots[0].projectiles, slots, 'the slot list itself must be reused');
    assert.equal(store.snapshots[0].projectiles[0], firstSlot, 'slot objects must be overwritten, not replaced');
    assert.equal(store.snapshots[0].projectileCount, 2);
});
