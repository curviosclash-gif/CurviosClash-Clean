import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RING_FIELD_DEFAULT_RADIUS,
    claimRingFieldRing,
    countRingFieldRingsOwnedBy,
    createRingField,
    releaseRingFieldOwner,
    testRingFieldCrossing,
} from '../src/shared/contracts/RingFieldContract.js';

function ring(overrides = {}) {
    return createRingField([{ id: 'r', pos: [0, 0, 0], forward: [0, 0, 1], radius: 5, ...overrides }]).rings[0];
}

test('createRingField normalizes ids, radius and forward vectors', () => {
    const field = createRingField([
        { id: 'a', pos: [1, 2, 3], forward: [0, 0, 10], radius: 4 },
        { pos: ['x', 2, 3], forward: [0, 0, 0], radius: -2, directional: true },
    ]);
    assert.equal(field.rings.length, 2);
    assert.deepEqual([field.rings[0].fx, field.rings[0].fy, field.rings[0].fz], [0, 0, 1]);
    assert.equal(field.rings[1].id, 'ring_1');
    assert.equal(field.rings[1].x, 0);
    assert.equal(field.rings[1].radius, RING_FIELD_DEFAULT_RADIUS);
    assert.deepEqual([field.rings[1].fx, field.rings[1].fy, field.rings[1].fz], [0, 0, 1]);
    assert.equal(field.rings[0].directional, false);
    assert.equal(field.rings[1].directional, true);
    assert.equal(field.rings[0].ownerId, '');
});

test('a fast segment through the ring plane counts even without a sample inside the ring', () => {
    // A guided rocket moves ~1.2 units per frame; a projectile can also jump far.
    assert.equal(testRingFieldCrossing(ring(), 1, 1, -40, 1, 1, 40), true);
});

test('crossing outside the radius does not count, the body radius widens the ring', () => {
    assert.equal(testRingFieldCrossing(ring(), 6, 0, -1, 6, 0, 1), false);
    assert.equal(testRingFieldCrossing(ring(), 6, 0, -1, 6, 0, 1, 1.5), true);
});

test('directional rings only count front-to-back along forward', () => {
    const directional = ring({ directional: true });
    assert.equal(testRingFieldCrossing(directional, 0, 0, -1, 0, 0, 1), true);
    assert.equal(testRingFieldCrossing(directional, 0, 0, 1, 0, 0, -1), false);
    const open = ring();
    assert.equal(testRingFieldCrossing(open, 0, 0, 1, 0, 0, -1), true);
});

test('segments that stay on one side or touch the plane twice do not count', () => {
    assert.equal(testRingFieldCrossing(ring(), 0, 0, 1, 0, 0, 2), false);
    assert.equal(testRingFieldCrossing(ring(), 0, 0, -2, 0, 0, -1), false);
    assert.equal(testRingFieldCrossing(ring(), 0, 0, 0, 0, 0, 0), false);
    assert.equal(testRingFieldCrossing(null, 0, 0, -1, 0, 0, 1), false);
});

test('ownership: claim, steal, release and count', () => {
    const field = createRingField([
        { id: 'a', pos: [0, 0, 0] },
        { id: 'b', pos: [0, 0, 50] },
        { id: 'c', pos: [0, 0, 100] },
    ]);
    assert.equal(claimRingFieldRing(field, 0, 'p1'), '');
    assert.equal(claimRingFieldRing(field, 1, 'p1'), '');
    assert.equal(claimRingFieldRing(field, 1, 'p1'), null);
    assert.equal(claimRingFieldRing(field, 1, 'bot2'), 'p1');
    assert.equal(claimRingFieldRing(field, 9, 'p1'), null);
    assert.equal(claimRingFieldRing(field, 2, ''), null);
    assert.equal(countRingFieldRingsOwnedBy(field, 'p1'), 1);
    assert.equal(countRingFieldRingsOwnedBy(field, 'bot2'), 1);
    assert.equal(releaseRingFieldOwner(field, 'p1'), 1);
    assert.equal(field.rings[0].ownerId, '');
    assert.equal(countRingFieldRingsOwnedBy(field, 'p1'), 0);
    assert.equal(releaseRingFieldOwner(field, ''), 0);
});
