import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    buildTimelineSummary,
    calculateAverageFrameTime,
    collectFrameSamples,
    hasMetricDrifted,
} from './errors-easy.mjs';
import {
    createSessionStateCache,
    provideGlobalDispatcher,
} from './errors-medium.mjs';
import {
    buildSnapshotDebugPayload,
    classifyTrajectoryAcceleration,
    detectLaneOverlap,
    integrateSnapshotChannel,
    projectTrajectorySegment,
    resolveSnapshotGameState,
} from './errors-hard.mjs';

test('easy fixture preserves basic metric contracts', () => {
    assert.deepEqual(collectFrameSamples([16, 17]), [16, 17]);
    assert.equal(hasMetricDrifted(20, 16, 2), true);
    assert.equal(calculateAverageFrameTime([10, 20]), 15);
    assert.deepEqual(buildTimelineSummary([100, 116, 135]), {
        intervals: [
            { from: 100, to: 116, gap: 16 },
            { from: 116, to: 135, gap: 19 },
        ],
        totalDurationMs: 35,
    });
});

test('medium fixture awaits refreshes and releases its listener', async () => {
    const listeners = new Set();
    provideGlobalDispatcher({
        addEventListener: (_name, listener) => listeners.add(listener),
        removeEventListener: (_name, listener) => listeners.delete(listener),
    });
    const cache = createSessionStateCache();
    const payload = await cache.refreshEntry('alpha', async () => ({ value: 7 }));
    assert.deepEqual(payload, { value: 7 });
    assert.equal(cache.activeListenerCount, 1);
    cache.dispose();
    assert.equal(cache.activeListenerCount, 0);
    assert.equal(listeners.size, 0);
});

test('hard fixture preserves contracts across numeric, async, and Three.js boundaries', async () => {
    const nearLinear = [
        { time: 0, position: { x: 0, z: 0 } },
        { time: 1000, position: { x: 1e-8, z: 0 } },
    ];
    assert.equal(classifyTrajectoryAcceleration(nearLinear), 'LINEAR');
    assert.equal(resolveSnapshotGameState({ isRaceComplete: true }), 'MATCH_END');

    const velocity = new THREE.Vector3(2, 0, 4);
    assert.deepEqual(projectTrajectorySegment(new THREE.Vector3(), velocity, 0.5).toArray(), [1, 0, 2]);
    assert.deepEqual(velocity.toArray(), [2, 0, 4]);
    assert.doesNotThrow(() => JSON.stringify(buildSnapshotDebugPayload('snap', [])));

    const overlap = detectLaneOverlap(
        { position: { x: 100, z: 1 }, velocity: { x: 0, z: 2 } },
        { position: { x: -100, z: 2 }, velocity: { x: 0, z: 1 } },
    );
    assert.equal(overlap.overlapping, true);

    const channel = `race-${Date.now()}`;
    let release;
    const first = integrateSnapshotChannel(channel, () => new Promise((resolve) => { release = resolve; }));
    const fill = Array.from({ length: 128 }, (_, index) => ({ x: index, y: 0, z: 0, timestamp: index }));
    const buffer = await integrateSnapshotChannel(channel, async () => fill);
    release([{ x: 999, y: 0, z: 0, timestamp: 999 }]);
    await first;
    assert.equal(buffer.count, buffer.capacity);
});
