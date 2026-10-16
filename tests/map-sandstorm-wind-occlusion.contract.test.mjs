import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createSandstormWindOcclusionScratch,
    resolveSandstormWindExposure,
} from '../src/entities/systems/MapSandstormWindOcclusionOps.js';

function fakeArena(blockedProbeIndexes = []) {
    const result = { hit: false };
    const calls = [];
    return {
        calls,
        raycast(origin, direction, maxDistance) {
            const probeIndex = calls.length % 3;
            calls.push({ origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z], maxDistance });
            result.hit = blockedProbeIndexes.includes(probeIndex);
            return result;
        },
    };
}

const position = { x: 10, y: 4, z: -3 };
const wind = { x: 1, z: 0 };

test('three blocked upwind paths give zero exposure', () => {
    const arena = fakeArena([0, 1, 2]);
    assert.equal(resolveSandstormWindExposure(arena, position, wind, createSandstormWindOcclusionScratch()), 0);
    assert.equal(arena.calls.length, 3);
});

test('one blocked lateral path leaves two thirds exposure', () => {
    const arena = fakeArena([1]);
    assert.equal(resolveSandstormWindExposure(arena, position, wind, createSandstormWindOcclusionScratch()), 2 / 3);
});

test('clear paths give full exposure and probe from upwind with the wind toward the player', () => {
    const arena = fakeArena();
    assert.equal(resolveSandstormWindExposure(arena, position, wind, createSandstormWindOcclusionScratch()), 1);
    assert.deepEqual(arena.calls.map((call) => call.origin), [
        [-6, 4, -4.25],
        [-6, 4, -3],
        [-6, 4, -1.75],
    ]);
    assert.deepEqual(arena.calls[0].direction, [1, 0, 0]);
    assert.equal(arena.calls[0].maxDistance, 16);
});

test('invalid arena, position, scratch, or zero wind fail open without raycasts', () => {
    const arena = fakeArena();
    const scratch = createSandstormWindOcclusionScratch();
    assert.equal(resolveSandstormWindExposure(null, position, wind, scratch), 1);
    assert.equal(resolveSandstormWindExposure(arena, null, wind, scratch), 1);
    assert.equal(resolveSandstormWindExposure(arena, position, { x: 0, z: 0 }, scratch), 1);
    assert.equal(resolveSandstormWindExposure(arena, position, { x: Number.NaN, z: 0 }, scratch), 1);
    assert.equal(resolveSandstormWindExposure(arena, position, wind, null), 1);
    assert.equal(arena.calls.length, 0);
});

test('scratch vectors are reused and hit state is read before the shared ray result changes', () => {
    const arena = fakeArena([0, 2]);
    const scratch = createSandstormWindOcclusionScratch();
    const { origin, direction, crosswind } = scratch;
    assert.equal(resolveSandstormWindExposure(arena, position, wind, scratch), 1 / 3);
    assert.equal(resolveSandstormWindExposure(arena, position, wind, scratch), 1 / 3);
    assert.equal(scratch.origin, origin);
    assert.equal(scratch.direction, direction);
    assert.equal(scratch.crosswind, crosswind);
    assert.equal(arena.calls.length, 6);
});

test('probe distance and lateral spacing can be tuned', () => {
    const arena = fakeArena();
    resolveSandstormWindExposure(arena, position, wind, createSandstormWindOcclusionScratch(), {
        maxDistance: 8,
        crosswindOffset: 2,
    });
    assert.deepEqual(arena.calls.map((call) => call.origin), [
        [2, 4, -5],
        [2, 4, -3],
        [2, 4, -1],
    ]);
    assert.equal(arena.calls[0].maxDistance, 8);
});
