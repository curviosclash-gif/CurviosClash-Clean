import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';

function createArenaStub(seenRolls) {
    return {
        bounds: { minX: -50, maxX: 50, minY: 0, maxY: 20, minZ: -50, maxZ: 50 },
        getRandomPosition(margin, random) {
            seenRolls.push(random);
            const roll = typeof random === 'function' ? random : Math.random;
            return new THREE.Vector3(roll() * 10, 5, roll() * 10);
        },
        getRandomPositionOnLevel(level, margin, random) {
            seenRolls.push(random);
            const roll = typeof random === 'function' ? random : Math.random;
            return new THREE.Vector3(roll() * 10, level, roll() * 10);
        },
        checkCollision() { return false; },
    };
}

function createSpawnOwner(seenRolls, seed) {
    return {
        arena: createArenaStub(seenRolls),
        players: [],
        runtimeRng: createRuntimeRng({ seed }),
    };
}

test('the spawn fallback draws from the seeded runtime rng, not the global one', () => {
    const seenRolls = [];
    const owner = createSpawnOwner(seenRolls, 4711);
    const system = new SpawnPlacementSystem(owner);

    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error('spawn placement must not fall back to Math.random');
    };
    try {
        const position = system.findSpawnPosition(12, 12);
        assert.ok(position, 'a spawn position is expected');
    } finally {
        Math.random = originalRandom;
    }

    assert.ok(seenRolls.length > 0, 'the arena helper has to be reached');
    assert.equal(seenRolls[0], owner.runtimeRng.next, 'the seeded roll has to be handed down');
});

test('the same seed places the spawn fallback at the same spot', () => {
    const run = (seed) => {
        const system = new SpawnPlacementSystem(createSpawnOwner([], seed));
        return system.findSpawnPosition(12, 12).toArray();
    };

    assert.deepEqual(run(4711), run(4711));
    assert.notDeepEqual(run(90210), run(4711));
});

test('the planar spawn fallback carries the seeded roll too', () => {
    const seenRolls = [];
    const system = new SpawnPlacementSystem(createSpawnOwner(seenRolls, 4711));

    system.findSpawnPosition(12, 12, 3);

    assert.ok(seenRolls.length > 0);
    assert.equal(typeof seenRolls[0], 'function');
});

function createClassicPlayer() {
    return { alive: true, hp: 1, maxHp: 1, shieldHP: 0, hasShield: false, lastDamageTimestamp: -Infinity };
}

test('classic damage stamps its timestamp from the injected clock', () => {
    const strategy = new ClassicModeStrategy({ nowMs: () => 5_000 });
    const player = createClassicPlayer();

    strategy.applyDamage(player, 1, {});

    assert.equal(player.lastDamageTimestamp, 5, '5000 ms of match time is 5 s');
});

test('an explicitly passed nowSeconds still wins over the clock', () => {
    const strategy = new ClassicModeStrategy({ nowMs: () => 5_000 });
    const player = createClassicPlayer();

    strategy.applyDamage(player, 1, { nowSeconds: 42 });

    assert.equal(player.lastDamageTimestamp, 42);
});

test('the runtime can swap the classic clock in later, same as for arcade', () => {
    const strategy = new ClassicModeStrategy();
    strategy.setNowMsSource(() => 9_000);
    const player = createClassicPlayer();

    strategy.applyDamage(player, 1, {});

    assert.equal(player.lastDamageTimestamp, 9);
});
