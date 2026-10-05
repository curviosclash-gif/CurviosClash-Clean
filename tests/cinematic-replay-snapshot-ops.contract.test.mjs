import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReplayNetworkSnapshot } from '../src/core/recording/CinematicReplaySnapshotOps.js';

function createTarget() {
    return { projectiles: [], powerups: [], turrets: [], cherryLeaves: [], globalFog: null, sandstorm: null };
}

test('replay snapshot ops interpolate entries by id and keep only elapsed leaf events', () => {
    const target = createTarget();
    const left = {
        mapElapsedSeconds: 10,
        globalFog: { active: true, remainingSeconds: 4, visibilityRange: 30 },
        cherryLeaves: [[1, 10.5]],
        projectiles: [{ id: 'a', type: 'rocket', pos: [0, 0, 0], ttl: 2 }],
    };
    const right = {
        mapElapsedSeconds: 12,
        globalFog: { active: true, remainingSeconds: 0 },
        cherryLeaves: [[1, 10.5], [2, 13]],
        projectiles: [{ id: 'a', type: 'rocket', pos: [4, 2, -2], ttl: 1 }],
    };

    const result = buildReplayNetworkSnapshot(target, left, right, 0.25);

    assert.equal(result, target);
    assert.equal(target.mapElapsedSeconds, 10.5);
    assert.deepEqual(target.cherryLeaves, [[1, 10.5]]);
    assert.deepEqual(target.globalFog, { active: true, remainingSeconds: 4, visibilityRange: 30 });
    assert.equal(target.projectiles.length, 1);
    assert.deepEqual(target.projectiles[0].pos, [1, 0.5, -0.5]);
    assert.equal(target.projectiles[0].ttl, 1.75);
    assert.equal(target.projectiles[0].id, 'a');
});

test('replay snapshot ops switch to the right entry list past the midpoint and shrink the target', () => {
    const target = createTarget();
    buildReplayNetworkSnapshot(target, { powerups: [{ id: 'p1' }, { id: 'p2' }] }, { powerups: [{ id: 'p1' }] }, 0.25);
    assert.equal(target.powerups.length, 2);

    buildReplayNetworkSnapshot(target, { powerups: [{ id: 'p1' }, { id: 'p2' }] }, { powerups: [{ id: 'p1' }] }, 0.75);
    assert.equal(target.powerups.length, 1);
    assert.equal(target.powerups[0].id, 'p1');
    assert.equal(target.globalFog.active, false);
});
