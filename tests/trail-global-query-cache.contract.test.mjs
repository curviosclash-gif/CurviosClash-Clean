import test from 'node:test';
import assert from 'node:assert/strict';

import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

// The bot flight guard asks checkGlobalCollision at every step of up to ten rolled-out paths per
// bot and tick, so neighbouring probes share their 3x3 grid neighbourhood. The query keeps the
// filtered candidates of a neighbourhood between probes. The uncached scan (still used with trail
// debug telemetry on) is the reference: both must report the same hit for every probe, also while
// trails grow, segments die and the probing player changes between probes.

function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function buildPair() {
    const make = () => {
        const players = [];
        for (let p = 0; p < 4; p += 1) {
            players.push({ index: p, trail: { kind: 'player-trail', writeIndex: 0, maxSegments: 48 } });
        }
        const index = new TrailSpatialIndex({ gridSize: 10, getPlayers: () => players, debugConfig: { enabled: false } });
        return { players, index, refs: new Map() };
    };
    const cached = make();
    const reference = make();
    reference.index._trailCollisionDebugEnabled = true;
    // Debug mode logs through console; a full counter keeps it quiet without changing the scan.
    reference.index._trailCollisionDebugLogCount = Number.MAX_SAFE_INTEGER;
    return { cached, reference };
}

function addSegment(world, playerIndex, random, rocket = false) {
    const player = world.players[playerIndex];
    const trail = rocket ? { kind: 'rocket-trail' } : player.trail;
    const slot = rocket ? 1000 + Math.floor(random() * 50) : trail.writeIndex % trail.maxSegments;
    const fromX = -30 + random() * 60;
    const fromY = random() * 12;
    const fromZ = -30 + random() * 60;
    const key = `${playerIndex}:${slot}`;
    const previous = world.refs.get(key);
    if (previous) world.index.unregisterTrailSegment(previous.key, previous.entry);
    const ref = world.index.registerTrailSegment(playerIndex, slot, {
        fromX, fromY, fromZ,
        toX: fromX + (random() - 0.5) * 6,
        toY: fromY + (random() - 0.5) * 2,
        toZ: fromZ + (random() - 0.5) * 6,
        radius: 0.4 + random() * 0.4,
        ownerTrail: trail,
        hp: 1,
    }, previous || null);
    world.refs.set(key, ref);
    if (!rocket) trail.writeIndex = (trail.writeIndex + 1) % trail.maxSegments;
}

function run(world, seed) {
    const random = lcg(seed);
    const answers = [];
    const hull = { isSphereInOBB: (point, radius) => (Math.floor(point.x * 7 + point.z * 3 + radius * 11) % 3) !== 0 };
    for (let round = 0; round < 60; round += 1) {
        const mutation = random();
        if (mutation < 0.5) addSegment(world, Math.floor(random() * 4), random, random() < 0.1);
        else if (mutation < 0.6) {
            const refs = [...world.refs.values()];
            const victim = refs[Math.floor(random() * refs.length)];
            if (victim) world.index.destroySegment(victim.entry);
        } else if (mutation < 0.7) {
            world.players[Math.floor(random() * 4)].trail.writeIndex += 1;
        }
        if (round < 20) {
            for (let fill = 0; fill < 8; fill += 1) addSegment(world, Math.floor(random() * 4), random);
        }
        // A rolled-out path: small steps, so consecutive probes stay in one neighbourhood.
        const exclude = Math.floor(random() * 5) - 1;
        const skipRecent = Math.floor(random() * 30);
        const radius = 0.8 + random() * 2;
        const useHull = random() < 0.2;
        let x = -30 + random() * 60;
        const y = random() * 12;
        let z = -30 + random() * 60;
        const dx = (random() - 0.5) * 3;
        const dz = (random() - 0.5) * 3;
        for (let step = 0; step < 40; step += 1) {
            x += dx;
            z += dz;
            const hit = world.index.checkGlobalCollision({ x, y, z }, radius, exclude, skipRecent, useHull ? hull : null);
            answers.push(hit?.hit ? hit.playerIndex : -9);
        }
    }
    return answers;
}

test('cached neighbourhood candidates answer every probe like the uncached scan', () => {
    for (const seed of [3, 17, 4242, 90001]) {
        const { cached, reference } = buildPair();
        const expected = run(reference, seed);
        const actual = run(cached, seed);
        assert.equal(actual.length, expected.length);
        const hits = expected.filter((value) => value !== -9).length;
        assert.ok(hits > 40, `seed ${seed}: the field must produce hits to mean something (${hits})`);
        assert.ok(expected.length - hits > 400, `seed ${seed}: and misses`);
        assert.deepEqual(actual, expected, `seed ${seed}: a probe answered differently`);
    }
});

test('probes inside one neighbourhood read the grid only once', () => {
    const { cached } = buildPair();
    const random = lcg(7);
    for (let i = 0; i < 40; i += 1) addSegment(cached, i % 4, random);
    const grid = cached.index.spatialGrid;
    let reads = 0;
    const get = grid.get.bind(grid);
    grid.get = (key) => { reads += 1; return get(key); };
    for (let step = 0; step < 10; step += 1) {
        cached.index.checkGlobalCollision({ x: 1 + step * 0.5, y: 4, z: 2 }, 1.5, 0, 10, null);
    }
    assert.equal(reads, 9, 'one 3x3 gather for ten probes in the same cell');
    cached.index.checkGlobalCollision({ x: 1, y: 4, z: 2 }, 1.5, 1, 10, null);
    assert.equal(reads, 18, 'another probing player gathers again');
});
