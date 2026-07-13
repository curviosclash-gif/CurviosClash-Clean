import assert from 'node:assert/strict';
import test from 'node:test';

import { RING_STATE_INACTIVE, RING_STATE_PASSED } from '../src/entities/arena/CheckpointRingMeshFactory.js';
import { CheckpointRingRuntime } from '../src/entities/arena/portal/CheckpointRingRuntime.js';

function createRingEntry({ checkpointId, routeIndex }) {
    const ringMesh = {
        rotation: { z: 0 },
        scale: {
            x: 1,
            setScalar(value) {
                this.x = value;
            },
        },
        material: {
            color: { setHex() {} },
            emissive: { setHex() {} },
            emissiveIntensity: 0,
        },
    };
    return {
        checkpointId,
        routeIndex,
        pos: { x: 0, y: 0, z: 0 },
        mesh: {
            userData: {
                ringMesh,
                ringState: null,
            },
        },
    };
}

test('CheckpointRingRuntime marks only the taken branch checkpoint as passed', () => {
    let snapshot = {
        passedMask: [1, 1, 1, 0],
        passedCheckpointIds: ['CP01', 'CP02', 'CP03A'],
        nextCheckpointIndex: 3,
        completed: false,
    };
    const rings = [
        createRingEntry({ checkpointId: 'CP01', routeIndex: 0 }),
        createRingEntry({ checkpointId: 'CP02', routeIndex: 1 }),
        createRingEntry({ checkpointId: 'CP03A', routeIndex: 2 }),
        createRingEntry({ checkpointId: 'CP03B', routeIndex: 2 }),
        createRingEntry({ checkpointId: 'CP04', routeIndex: 3 }),
    ];
    const runtime = new CheckpointRingRuntime({
        checkpointRings: rings,
    });
    runtime.setProgressProvider(() => snapshot);

    runtime.update(0.016);

    assert.equal(rings[2].mesh.userData.ringState, RING_STATE_PASSED);
    assert.equal(rings[3].mesh.userData.ringState, RING_STATE_INACTIVE);
});
