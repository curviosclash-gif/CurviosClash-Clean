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

// Eine hohle Roehre (shape 'tube' mit innerRadius > 0) hat zwei freie Seiten: den Tunnel
// innen und die Welt aussen. Die Normale muss auf beiden Seiten vom Mantel weg zeigen.
const TUBE_BOUNDS = Object.freeze({
    minX: -60, maxX: 60,
    minY: -60, maxY: 60,
    minZ: -60, maxZ: 60,
});
const TUBE_INNER_RADIUS = 6;
const TUBE_OUTER_RADIUS = 7.08;
const TUBE_PROBE_RADIUS = 0.5;
// Ein Schritt, der von beiden Mantelseiten aus sicher in den freien Raum fuehrt.
const TUBE_ESCAPE_STEP = 0.75;

function createHollowTubeArena() {
    const tube = {
        ax: -20, ay: 5, az: 0,
        bx: 20, by: 5, bz: 0,
        innerRadius: TUBE_INNER_RADIUS,
        outerRadius: TUBE_OUTER_RADIUS,
        lengthSq: 40 * 40,
    };
    const box = new THREE.Box3(
        new THREE.Vector3(tube.ax - TUBE_OUTER_RADIUS, tube.ay - TUBE_OUTER_RADIUS, tube.az - TUBE_OUTER_RADIUS),
        new THREE.Vector3(tube.bx + TUBE_OUTER_RADIUS, tube.by + TUBE_OUTER_RADIUS, tube.bz + TUBE_OUTER_RADIUS),
    );
    return {
        bounds: TUBE_BOUNDS,
        obstacles: [{ box, isWall: false, kind: 'hard', tube }],
    };
}

// Kontakt auf der Mantelflaeche in +Z, einmal knapp innerhalb der Aussenhuelle und
// einmal knapp ausserhalb der Innenwand.
const TUBE_CONTACTS = [
    { name: 'outer shell', radialDistance: TUBE_OUTER_RADIUS - 0.08, expectedSign: 1 },
    { name: 'inner wall', radialDistance: TUBE_INNER_RADIUS - 0.3, expectedSign: -1 },
];

test('hollow tube collision normals point away from the shell into free space', () => {
    const arena = createHollowTubeArena();
    const collision = new ArenaCollision(arena);
    const axisPoint = new THREE.Vector3(0, 5, 0);

    for (const { name, radialDistance, expectedSign } of TUBE_CONTACTS) {
        const point = new THREE.Vector3(0, 5, radialDistance);
        const hit = collision.getBotCollisionInfo(point, TUBE_PROBE_RADIUS);
        assert.ok(hit?.hit, `${name}: expected the shell to report a hit`);

        const radialDir = new THREE.Vector3().subVectors(point, axisPoint).normalize();
        assert.ok(
            hit.normal.dot(radialDir) * expectedSign > 0,
            `${name}: normal ${hit.normal.toArray().join(',')} does not point to the free side`,
        );

        // Der Aufprall schiebt entlang der Normale: ein Schritt dorthin muss frei sein.
        const escaped = point.clone().addScaledVector(hit.normal, TUBE_ESCAPE_STEP);
        assert.equal(
            collision.checkWorldGeometryCollision(escaped, TUBE_PROBE_RADIUS),
            false,
            `${name}: stepping along the normal stays inside the shell`,
        );
    }
});
