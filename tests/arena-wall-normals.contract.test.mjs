import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { resolveNearestBoundsNormal } from '../src/entities/systems/CollisionResponseSystem.js';

const BOUNDS = Object.freeze({
    minX: -30, maxX: 50,
    minY: -10, maxY: 22,
    minZ: -40, maxZ: 60,
});

const CENTER = new THREE.Vector3(
    (BOUNDS.minX + BOUNDS.maxX) / 2,
    (BOUNDS.minY + BOUNDS.maxY) / 2,
    (BOUNDS.minZ + BOUNDS.maxZ) / 2,
);

// Kontaktpunkte knapp jenseits jeder Wand, jeweils in den anderen Achsen mittig,
// damit eindeutig genau diese Wand die naechste ist.
const WALL_CONTACTS = [
    { name: 'minX', point: new THREE.Vector3(BOUNDS.minX - 0.5, CENTER.y, CENTER.z) },
    { name: 'maxX', point: new THREE.Vector3(BOUNDS.maxX + 0.5, CENTER.y, CENTER.z) },
    { name: 'minY', point: new THREE.Vector3(CENTER.x, BOUNDS.minY - 0.5, CENTER.z) },
    { name: 'maxY', point: new THREE.Vector3(CENTER.x, BOUNDS.maxY + 0.5, CENTER.z) },
    { name: 'minZ', point: new THREE.Vector3(CENTER.x, CENTER.y, BOUNDS.minZ - 0.5) },
    { name: 'maxZ', point: new THREE.Vector3(CENTER.x, CENTER.y, BOUNDS.maxZ + 0.5) },
];

function towardsCenter(point) {
    return new THREE.Vector3().subVectors(CENTER, point);
}

test('arena wall collision normals point back into the arena', () => {
    const collision = new ArenaCollision({ bounds: BOUNDS, obstacles: [] });

    for (const { name, point } of WALL_CONTACTS) {
        const hit = collision.getCollisionInfo(point, 0.5);
        assert.ok(hit?.hit, `${name}: expected a wall hit`);
        assert.equal(hit.isWall, true, `${name}: expected the hit to be flagged as a wall`);
        assert.ok(
            hit.normal.dot(towardsCenter(point)) > 0,
            `${name}: normal ${hit.normal.toArray().join(',')} does not point into the arena`,
        );
    }
});

test('nearest bounds normal points back into the arena for every wall', () => {
    const out = new THREE.Vector3();

    for (const { name, point } of WALL_CONTACTS) {
        resolveNearestBoundsNormal(BOUNDS, point, out);
        assert.ok(
            out.dot(towardsCenter(point)) > 0,
            `${name}: normal ${out.toArray().join(',')} does not point into the arena`,
        );
    }
});

test('nearest bounds normal agrees with the arena collision normal', () => {
    const collision = new ArenaCollision({ bounds: BOUNDS, obstacles: [] });
    const out = new THREE.Vector3();

    for (const { name, point } of WALL_CONTACTS) {
        const hit = collision.getCollisionInfo(point, 0.5);
        resolveNearestBoundsNormal(BOUNDS, point, out);
        assert.deepEqual(
            out.toArray(),
            hit.normal.toArray(),
            `${name}: bounce fallback and collision info disagree on the wall normal`,
        );
    }
});
