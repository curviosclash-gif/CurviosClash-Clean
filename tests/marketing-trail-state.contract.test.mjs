import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrailStateRecorder, applyRecordedTrailState } from '../src/core/recording/MarketingTrailState.js';

function player() {
    const array = new Float32Array(16 * 4);
    return { index: 0, trail: { segmentCount: 2, writeIndex: 2,
        mesh: { count: 2, instanceMatrix: { array } },
        clear() { array.fill(0); this.mesh.count = 0; this.segmentCount = 0; } } };
}

test('trail recording preserves destruction, ring replacement and periodic complete states', () => {
    const original = player(), replay = player();
    original.trail.mesh.instanceMatrix.array.fill(1, 0, 32);
    const record = createTrailStateRecorder();
    const full = record([original], 0);
    applyRecordedTrailState({ players: [replay] }, full);
    assert.deepEqual(replay.trail.mesh.instanceMatrix.array, original.trail.mesh.instanceMatrix.array);
    assert.equal(record([original], 33)[0].channels.mesh.changes.length, 0);
    original.trail.mesh.instanceMatrix.array.fill(0, 0, 16);
    const destroyed = record([original], 66);
    assert.equal(destroyed[0].full, false);
    assert.equal(destroyed[0].channels.mesh.changes.length, 1);
    applyRecordedTrailState({ players: [replay] }, destroyed);
    assert.deepEqual(replay.trail.mesh.instanceMatrix.array, original.trail.mesh.instanceMatrix.array);
    original.trail.mesh.instanceMatrix.array.fill(2, 0, 16);
    original.trail.writeIndex = 1;
    applyRecordedTrailState({ players: [replay] }, record([original], 99));
    assert.equal(replay.trail.writeIndex, 1);
    const checkpoint = record([original], 5000);
    assert.equal(checkpoint[0].full, true);
    assert.equal(checkpoint[0].channels.mesh.changes.length, 2);
    const fresh = player(); applyRecordedTrailState({ players: [fresh] }, checkpoint);
    assert.deepEqual(fresh.trail.mesh.instanceMatrix.array, original.trail.mesh.instanceMatrix.array);
});
