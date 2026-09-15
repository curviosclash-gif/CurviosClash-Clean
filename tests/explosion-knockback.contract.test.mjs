import test from 'node:test';
import assert from 'node:assert/strict';

import { applyExplosionKnockback } from '../src/entities/systems/ExplosionKnockbackOps.js';

/**
 * Stands in for Player.js: only activateSlingshot matters here, since that is the vehicle's
 * only mechanism for a temporary external impulse (PlayerMotionOps re-derives velocity from
 * steering input every frame, so a bare addition to it would never survive one tick).
 */
function createTarget(position, alive = true) {
    const calls = [];
    return {
        alive,
        position,
        activateSlingshot(params, forward, up) {
            calls.push({ params, forward, up });
        },
        _calls: calls,
    };
}

test('a center hit throws a vehicle away from the blast at full strength', () => {
    const target = createTarget({ x: 10, y: 0, z: 0 });
    applyExplosionKnockback(target, { x: 0, y: 0, z: 0 }, 1);

    assert.equal(target._calls.length, 1);
    const { params, forward, up } = target._calls[0];
    assert.deepEqual(forward, { x: 1, y: 0, z: 0 }, 'pushed straight away from the blast center');
    assert.deepEqual(up, { x: 0, y: 1, z: 0 });
    assert.ok(params.forwardImpulse > 0);
    assert.ok(params.liftImpulse > 0);
    assert.ok(params.duration > 0);
});

test('a grazing hit at the radius edge shoves far less than a center hit', () => {
    const center = createTarget({ x: 10, y: 0, z: 0 });
    applyExplosionKnockback(center, { x: 0, y: 0, z: 0 }, 1);
    const edge = createTarget({ x: 10, y: 0, z: 0 });
    applyExplosionKnockback(edge, { x: 0, y: 0, z: 0 }, 0.1);

    assert.ok(edge._calls[0].params.forwardImpulse < center._calls[0].params.forwardImpulse);
});

test('a dead player and a hit with no distance from the blast are never knocked back', () => {
    const dead = createTarget({ x: 10, y: 0, z: 0 }, false);
    applyExplosionKnockback(dead, { x: 0, y: 0, z: 0 }, 1);
    assert.equal(dead._calls.length, 0, 'a dead player is not thrown around');

    const onTopOfIt = createTarget({ x: 0, y: 0, z: 0 });
    applyExplosionKnockback(onTopOfIt, { x: 0, y: 0, z: 0 }, 1);
    assert.equal(onTopOfIt._calls.length, 0, 'no direction to push in without a safe distance to divide by');
});
