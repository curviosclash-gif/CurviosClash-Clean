import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrailStateRecorder, applyRecordedTrailState } from '../src/core/recording/MarketingTrailState.js';

function player() {
    const array = new Float32Array(16 * 4);
    const colors = new Float32Array(3 * 4);
    return { index: 0, trail: { segmentCount: 2, writeIndex: 2,
        mesh: { count: 2, instanceMatrix: { array }, instanceColor: { array: colors } },
        clear() { array.fill(0); this.mesh.count = 0; this.segmentCount = 0; } } };
}

test('trail recording preserves destruction, ring replacement and periodic complete states', () => {
    const original = player(), replay = player();
    original.trail.mesh.instanceMatrix.array.fill(1, 0, 32);
    const record = createTrailStateRecorder();
    const full = record([original], 0);
    assert.equal(full[0].channels.mesh.colorChanges.length, 2);
    applyRecordedTrailState({ players: [replay] }, full);
    assert.deepEqual(replay.trail.mesh.instanceMatrix.array, original.trail.mesh.instanceMatrix.array);
    assert.deepEqual(replay.trail.mesh.instanceColor.array, original.trail.mesh.instanceColor.array);
    assert.equal(record([original], 33)[0].channels.mesh.changes.length, 0);
    assert.equal(record([original], 33)[0].channels.mesh.colorChanges.length, 0);
    original.trail.mesh.instanceColor.array.set([0.1, 0.2, 0.3], 3);
    const recolored = record([original], 50);
    assert.equal(recolored[0].channels.mesh.colorChanges.length, 1);
    assert.equal(recolored[0].channels.mesh.colorChanges[0][0], 1);
    assert.equal('colors' in recolored[0].channels.mesh, false);
    applyRecordedTrailState({ players: [replay] }, recolored);
    assert.deepEqual(replay.trail.mesh.instanceColor.array, original.trail.mesh.instanceColor.array);
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
    assert.deepEqual(fresh.trail.mesh.instanceColor.array, original.trail.mesh.instanceColor.array);
    applyRecordedTrailState({ players: [fresh] }, [{ ...checkpoint[0], channels: { mesh: {
        count: 2, changes: [], colors: [0.4, 0.5, 0.6, 0, 0, 0],
    } }, heads: [] }]);
    assert.ok(Math.abs(fresh.trail.mesh.instanceColor.array[0] - 0.4) < 0.00001);
});
