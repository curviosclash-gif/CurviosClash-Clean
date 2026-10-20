import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';

const THIN_WALL = new THREE.Box3(new THREE.Vector3(-0.2, 0, -5), new THREE.Vector3(0.2, 10, 5));

function thinWallCollision() {
    return new ArenaCollision({
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        obstacles: [{ box: THIN_WALL.clone() }],
    });
}

// Outside the box the normal points from the nearest box point to the sphere centre.
function nearestPointDirection(centre) {
    return centre.clone().sub(THIN_WALL.clampPoint(centre, new THREE.Vector3())).normalize();
}

const degrees = (radians) => radians * 180 / Math.PI;

test('box collision normal follows the outside axis for a thin box', () => {
    const hit = thinWallCollision().getCollisionInfo(new THREE.Vector3(0.1, 10.3, 0), 0.5);
    assert.deepEqual(hit?.normal.toArray(), [0, 1, 0]);
});

test('an edge contact points from the nearest edge point to the centre (B2)', () => {
    const centre = new THREE.Vector3(0.25, 10.45, 0);
    const hit = thinWallCollision().getCollisionInfo(centre, 0.5);
    assert.ok(hit, 'the sphere touches the top edge');
    const off = degrees(hit.normal.angleTo(nearestPointDirection(centre)));
    assert.ok(off < 5, `edge normal is ${off.toFixed(1)} deg off the nearest-point direction`);
    assert.ok(Math.abs(hit.normal.length() - 1) < 1e-9);
});

test('a corner contact points from the corner to the centre', () => {
    const centre = new THREE.Vector3(0.5, 10.4, 5.3);
    const hit = thinWallCollision().getCollisionInfo(centre, 0.8);
    assert.ok(hit, 'the sphere touches the corner');
    const expected = nearestPointDirection(centre);
    assert.ok(degrees(hit.normal.angleTo(expected)) < 1e-6, `corner normal ${hit.normal.toArray()} vs ${expected.toArray()}`);
});

test('grazing over the top edge tilts the normal smoothly instead of a fixed 45 deg', () => {
    const collision = thinWallCollision();
    const up = new THREE.Vector3(0, 1, 0);
    const tilts = [10.1, 10.3, 10.5, 10.7].map((height) => {
        for (let x = -2; x <= 2; x += 0.01) {
            const hit = collision.getCollisionInfo(new THREE.Vector3(x, height, 0), 0.8);
            if (hit) return degrees(hit.normal.angleTo(up));
        }
        return NaN;
    });
    for (let index = 1; index < tilts.length; index += 1) {
        assert.ok(tilts[index] < tilts[index - 1], `a higher pass tilts less: ${tilts.map((tilt) => tilt.toFixed(1)).join(' > ')}`);
    }
    assert.ok(tilts.at(-1) < 45, 'the highest graze is pushed mostly upward');
});

test('a centre exactly on a face falls back to that face normal', () => {
    const collision = thinWallCollision();
    assert.deepEqual(collision.getCollisionInfo(new THREE.Vector3(0, 10, 0), 0.5)?.normal.toArray(), [0, 1, 0]);
    assert.deepEqual(collision.getCollisionInfo(new THREE.Vector3(0.2, 5, 0), 0.5)?.normal.toArray(), [1, 0, 0]);
});
