import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createAuthoredRespawnClock,
    refillAuthoredAnchors,
    spawnDueAuthoredAnchors,
} from '../src/entities/powerup/PowerupAuthoredRespawnOps.js';

// A growing map (expansion) keeps the anchors of still sealed rings empty: the fixed-respawn timer
// and the refill-on-death path must skip them like the random spawn path does.
function managerWithAnchors(anchors, expansion) {
    const spawned = [];
    return {
        spawned,
        arena: {
            currentMapDefinition: expansion ? { expansion: { stages: [] } } : {},
            bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
            getAuthoredItemAnchors: () => anchors,
        },
        _occupiedAnchorKeys: new Set(),
        _spawnFixedAuthoredAnchor: (anchor, key) => spawned.push(key),
    };
}

const anchors = [{ id: 'core', x: 0, y: 5, z: 0 }, { id: 'outer', x: 50, y: 5, z: 0 }];

test('fixed respawn and refill skip anchors in a sealed ring of a growing map', () => {
    const due = managerWithAnchors(anchors, true);
    spawnDueAuthoredAnchors(due, createAuthoredRespawnClock(), null);
    assert.deepEqual(due.spawned, ['core']);
    const refill = managerWithAnchors(anchors, true);
    refillAuthoredAnchors(refill, createAuthoredRespawnClock(), null);
    assert.deepEqual(refill.spawned, ['core']);
});

test('maps that do not grow keep every anchor', () => {
    const manager = managerWithAnchors(anchors, false);
    refillAuthoredAnchors(manager, createAuthoredRespawnClock(), null);
    assert.deepEqual(manager.spawned, ['core', 'outer']);
});