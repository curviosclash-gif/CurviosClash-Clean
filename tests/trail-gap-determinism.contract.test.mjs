import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';
import { Player } from '../src/entities/Player.js';
import { Trail } from '../src/entities/Trail.js';

const TRAIL_CONFIG = Object.freeze({
    TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 64, UPDATE_INTERVAL: 0.05, GAP_CHANCE: 0.3, GAP_DURATION: 0.1 },
    HUNT: { TRAIL_SEGMENT_HP: 3 },
});

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

function createTrailEntityManager(seed) {
    return {
        entityRuntimeConfig: TRAIL_CONFIG,
        runtimeRng: createRuntimeRng({ seed }),
        getTrailSpatialIndex() { return null; },
    };
}

// Faehrt die Spur eine feste Zahl von Schritten geradeaus und schreibt fuer jeden
// Schritt mit, ob gerade eine Luecke laeuft. Das ist das "Lueckenmuster".
function recordGapPattern(entityManager, steps = 120, trail = null) {
    trail = trail || new Trail(createRenderer(), 0x33aaff, 0, entityManager);
    const position = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, 0, -1);
    const pattern = [];

    for (let step = 0; step < steps; step++) {
        position.z -= 1;
        trail.update(0.05, position, direction);
        pattern.push(trail.inGap ? 1 : 0);
    }
    return pattern;
}

test('trail gaps repeat exactly for the same runtime rng seed', () => {
    const first = recordGapPattern(createTrailEntityManager(4711));
    const second = recordGapPattern(createTrailEntityManager(4711));

    assert.deepEqual(second, first);
    assert.ok(first.includes(1), 'expected at least one gap in the recorded pattern');
    assert.ok(first.includes(0), 'expected the trail to be drawn outside the gaps');
});

test('a different runtime rng seed produces a different gap pattern', () => {
    const first = recordGapPattern(createTrailEntityManager(4711));
    const other = recordGapPattern(createTrailEntityManager(90210));

    assert.notDeepEqual(other, first);
});

test('trail gaps ignore Math.random once the seeded rng is present', () => {
    const entityManager = createTrailEntityManager(1234);
    // Three.js zieht beim Materialbau selbst Math.random fuer UUIDs, deshalb steht
    // die Spur schon bevor der globale Zufall abgeklemmt wird.
    const trail = new Trail(createRenderer(), 0x33aaff, 0, entityManager);
    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error('Trail must not fall back to Math.random when runtimeRng is set');
    };
    try {
        const pattern = recordGapPattern(entityManager, 120, trail);
        assert.equal(pattern.length, 120);
        assert.ok(pattern.includes(1), 'expected the seeded rng to still produce gaps');
    } finally {
        Math.random = originalRandom;
    }
});

test('player yaw and trail gaps resolve an rng injected after construction', () => {
    const draws = [];
    const entityManager = { entityRuntimeConfig: TRAIL_CONFIG, getTrailSpatialIndex() { return null; } };
    const player = new Player(createRenderer(), 0, 0x33aaff, true, { entityManager });
    const trail = new Trail(createRenderer(), 0x33aaff, 1, entityManager);
    const runtimeRng = createRuntimeRng({ random: () => { draws.push(draws.length); return 0.2; } });

    entityManager.runtimeRng = runtimeRng;
    player.spawn(new THREE.Vector3(0, 5, 0));
    trail.update(0.05, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1));

    assert.equal(draws.length, 2, 'spawn yaw and the first trail sample each consume one match draw');
    assert.equal(trail.inGap, true);
});

function spawnHeading(seed) {
    const entityManager = {
        entityRuntimeConfig: TRAIL_CONFIG,
        runtimeRng: createRuntimeRng({ seed }),
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), 0, 0x33aaff, true, { entityManager });
    player.spawn(new THREE.Vector3(0, 5, 0));
    return player.quaternion.toArray();
}

test('spawn heading without a start direction repeats for the same seed', () => {
    assert.deepEqual(spawnHeading(4711), spawnHeading(4711));
    assert.notDeepEqual(spawnHeading(90210), spawnHeading(4711));
});
