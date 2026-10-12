import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Arena } from '../src/entities/Arena.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';

function createArena(random) {
    const arena = Object.create(Arena.prototype);
    arena.bounds = { minX: -10, maxX: 10, minY: 0, maxY: 20, minZ: -10, maxZ: 10 };
    arena.checkCollision = () => false;
    arena._runtimeRng = createRuntimeRng({ random });
    return arena;
}

test('arena position methods use the contract fallback and preserve explicit random injection', () => {
    const fallbackDraws = [];
    const arena = createArena(() => {
        fallbackDraws.push(fallbackDraws.length);
        return 0.25;
    });
    const fallbackPosition = arena.getRandomPosition(0);

    assert.deepEqual(fallbackPosition.toArray(), [-5, 6.5, -5]);
    assert.equal(fallbackDraws.length, 3);

    const injectedDraws = [];
    const injectedPosition = arena.getRandomPositionOnLevel(12, 0, () => {
        injectedDraws.push(injectedDraws.length);
        return 0.75;
    });
    assert.deepEqual(injectedPosition.toArray(), [5, 12, 5]);
    assert.equal(injectedDraws.length, 2);
    assert.ok(injectedPosition instanceof THREE.Vector3);
});

test('authored powerup anchor selection uses the strategy rng at call time, with explicit and standalone fallbacks', () => {
    const anchors = [
        { key: 'first', weight: 1 },
        { key: 'second', weight: 1 },
    ];
    const manager = {
        _fallbackRuntimeRng: createRuntimeRng({ random: () => 0.1 }),
        getStrategy: () => ({ runtimeRng: createRuntimeRng({ random: () => 0.75 }) }),
    };

    assert.equal(PowerupManager.prototype._pickAuthoredAnchor.call(manager, anchors).key, 'second');
    assert.equal(PowerupManager.prototype._pickAuthoredAnchor.call(manager, anchors, () => 0.25).key, 'first');

    manager.getStrategy = null;
    assert.equal(PowerupManager.prototype._pickAuthoredAnchor.call(manager, anchors).key, 'first');
});
