import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundSnapshotStore } from '../src/state/recorder/RoundSnapshotStore.js';

const PARTICLE_VALUE_STRIDE = 13;

// getOrderedSnapshots() hands out reused objects taken from a pool. That is only safe if the
// emitted lists still carry exactly the entries a naive rebuild would produce - same length,
// same keys, same values, no leftovers from an earlier, longer snapshot.
function referenceOrdered(store, limit = null) {
    const totalCount = limit == null
        ? store.snapshotCount
        : Math.min(store.snapshotCount, Math.max(1, Number(limit) || 1));
    const snapStart = store.snapshotCount >= store.maxSnapshots ? store.snapshotIndex : 0;
    const offset = Math.max(0, store.snapshotCount - totalCount);
    const frames = [];
    for (let i = 0; i < totalCount; i++) {
        const s = store.snapshots[(snapStart + offset + i) % store.maxSnapshots];
        frames.push({
            time: s.time,
            players: s.players.slice(0, s.playerCount).map((entry) => ({ ...entry })),
            projectiles: s.projectiles.slice(0, s.projectileCount).map((entry) => ({ ...entry })),
            powerups: s.powerups.slice(0, s.powerupCount).map((entry) => ({ ...entry })),
            turrets: s.turrets.slice(0, s.turretCount).map((entry) => ({ ...entry })),
            particles: {
                count: s.particleCount,
                values: Array.from(s.particleValues.slice(0, s.particleCount * PARTICLE_VALUE_STRIDE)),
            },
        });
    }
    return frames;
}

function plainCopy(frames) {
    return frames.map((frame) => ({
        time: frame.time,
        players: frame.players.map((entry) => ({ ...entry })),
        projectiles: frame.projectiles.map((entry) => ({ ...entry })),
        powerups: frame.powerups.map((entry) => ({ ...entry })),
        turrets: frame.turrets.map((entry) => ({ ...entry })),
        particles: { count: frame.particles.count, values: frame.particles.values.slice() },
    }));
}

function vec(x, y, z) {
    return { x, y, z };
}

function createSource(step, counts) {
    const players = [];
    for (let i = 0; i < counts.players; i++) {
        players.push({
            index: i,
            alive: i % 2 === 0,
            isBot: i > 0,
            position: vec(i + step, i * 2, i * 3),
            quaternion: { x: 0.1 * i, y: 0.2, z: 0.3, w: 1 },
            trail: { width: 0.5 + i * 0.1, inGap: i === 1 },
        });
    }
    const projectiles = [];
    for (let i = 0; i < counts.projectiles; i++) {
        projectiles.push({
            id: `p${step}-${i}`,
            type: i % 2 === 0 ? 'mg' : 'rocket',
            ownerIndex: i % 4,
            color: 0x112233 + i,
            position: vec(i, step, i + step),
            velocity: vec(-i, 1, i),
            radius: 0.25 + i,
        });
    }
    const powerups = [];
    for (let i = 0; i < counts.powerups; i++) {
        powerups.push({
            id: `u${step}-${i}`,
            type: 'shield',
            position: vec(i * 2, 4, i * 3),
            baseY: 4,
            mesh: { visible: i % 3 !== 0, position: vec(0, 0, 0) },
        });
    }
    const turrets = [];
    for (let i = 0; i < counts.turrets; i++) {
        turrets.push({
            id: `t${step}-${i}`,
            weapon: 'mg',
            rocketType: 'ROCKET_STRONG',
            ownerIndex: i,
            deployed: i % 2 === 0,
            position: vec(i, 1, i),
            aimDirection: vec(0, 1, 0),
            hp: 50 + i,
            maxHp: 100,
            expiresRemaining: 3 + i,
            ownerPlayer: { color: 0x445566 },
        });
    }
    const particleCount = counts.particles;
    const particles = {
        count: particleCount,
        positions: [],
        velocities: [],
        colors: [],
        lifetimes: [],
        maxLifetimes: [],
        gravities: [],
        scales: [],
    };
    for (let i = 0; i < particleCount; i++) {
        particles.positions.push(i, i + 1, i + 2);
        particles.velocities.push(-i, i, 2 * i);
        particles.colors.push(0.25, 0.5, 0.75);
        particles.lifetimes.push(1 + i);
        particles.maxLifetimes.push(5 + i);
        particles.gravities.push(-9);
        particles.scales.push(0.5);
    }
    return {
        players,
        projectiles,
        powerupManager: { items: powerups },
        _staticTurretSystem: { turrets },
        particles,
    };
}

// Entity counts swing wildly during a fight; that swing is what makes the reusable output lists
// shrink and grow again, and it is the only situation in which pooled entries can go stale.
const FLUCTUATING_COUNTS = [
    { players: 4, projectiles: 6, powerups: 5, turrets: 2, particles: 12 },
    { players: 4, projectiles: 0, powerups: 1, turrets: 0, particles: 0 },
    { players: 3, projectiles: 9, powerups: 7, turrets: 3, particles: 40 },
    { players: 2, projectiles: 2, powerups: 0, turrets: 1, particles: 3 },
    { players: 4, projectiles: 11, powerups: 9, turrets: 4, particles: 0 },
    { players: 1, projectiles: 1, powerups: 2, turrets: 0, particles: 7 },
];

function fill(store, rounds = 1) {
    let step = 0;
    for (let round = 0; round < rounds; round++) {
        for (const counts of FLUCTUATING_COUNTS) store.capture(createSource(step++, counts));
    }
}

test('the emitted frames match a naive rebuild, snapshot for snapshot', () => {
    let time = 0;
    const store = new RoundSnapshotStore({ maxSnapshots: 16, timeProvider: () => (time += 0.05) });
    fill(store, 2);

    assert.deepStrictEqual(plainCopy(store.getOrderedSnapshots()), referenceOrdered(store));
});

test('a wrapped ring still emits the oldest surviving snapshot first', () => {
    let time = 0;
    const store = new RoundSnapshotStore({ maxSnapshots: 4, timeProvider: () => (time += 0.05) });
    fill(store, 3);

    assert.ok(store.snapshotCount === 4, 'the ring must have wrapped for this test to mean anything');
    const emitted = plainCopy(store.getOrderedSnapshots());
    assert.deepStrictEqual(emitted, referenceOrdered(store));
    for (let i = 1; i < emitted.length; i++) {
        assert.ok(emitted[i].time > emitted[i - 1].time, 'frames stay in capture order');
    }
});

test('repeated calls stay identical even though every entry is reused', () => {
    let time = 0;
    const store = new RoundSnapshotStore({ maxSnapshots: 16, timeProvider: () => (time += 0.05) });
    fill(store, 2);

    const first = plainCopy(store.getOrderedSnapshots());
    const second = plainCopy(store.getOrderedSnapshots());
    const third = plainCopy(store.getOrderedSnapshots(4));

    assert.deepStrictEqual(second, first);
    assert.deepStrictEqual(third, referenceOrdered(store, 4));
    // The fourth call must not inherit the shortened lists of the limited third one.
    assert.deepStrictEqual(plainCopy(store.getOrderedSnapshots()), first);
});

test('an entry that comes back out of the pool carries no stale field', () => {
    let time = 0;
    const store = new RoundSnapshotStore({ maxSnapshots: 2, timeProvider: () => (time += 0.05) });

    store.capture(createSource(1, { players: 2, projectiles: 5, powerups: 4, turrets: 3, particles: 9 }));
    store.capture(createSource(2, { players: 2, projectiles: 5, powerups: 4, turrets: 3, particles: 9 }));
    store.getOrderedSnapshots();

    // Shrink hard, so the surplus entries land in the pool...
    store.capture(createSource(3, { players: 1, projectiles: 1, powerups: 0, turrets: 0, particles: 0 }));
    store.capture(createSource(4, { players: 1, projectiles: 1, powerups: 0, turrets: 0, particles: 0 }));
    store.getOrderedSnapshots();

    // ...and grow again, which hands those very entries back out.
    store.capture(createSource(5, { players: 3, projectiles: 7, powerups: 6, turrets: 2, particles: 15 }));
    store.capture(createSource(6, { players: 3, projectiles: 7, powerups: 6, turrets: 2, particles: 15 }));

    assert.deepStrictEqual(plainCopy(store.getOrderedSnapshots()), referenceOrdered(store));
});

test('shrinking and growing again reuses the same entry objects', () => {
    let time = 0;
    const store = new RoundSnapshotStore({ maxSnapshots: 1, timeProvider: () => (time += 0.05) });

    store.capture(createSource(1, { players: 2, projectiles: 6, powerups: 3, turrets: 2, particles: 0 }));
    const wide = store.getOrderedSnapshots()[0].projectiles.slice();
    assert.equal(wide.length, 6);

    store.capture(createSource(2, { players: 2, projectiles: 1, powerups: 3, turrets: 2, particles: 0 }));
    store.getOrderedSnapshots();

    store.capture(createSource(3, { players: 2, projectiles: 6, powerups: 3, turrets: 2, particles: 0 }));
    const again = store.getOrderedSnapshots()[0].projectiles;

    assert.equal(again.length, 6);
    const before = new Set(wide);
    for (const entry of again) {
        assert.ok(before.has(entry), 'a regrown list must come out of the pool, not out of a fresh allocation');
    }
});
