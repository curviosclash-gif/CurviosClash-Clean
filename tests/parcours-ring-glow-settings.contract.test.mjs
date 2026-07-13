import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { CheckpointRingRuntime } from '../src/entities/arena/portal/CheckpointRingRuntime.js';
import { RING_STATE_NEXT } from '../src/entities/arena/CheckpointRingMeshFactory.js';

function createRingEntry() {
    return {
        routeIndex: 0,
        checkpointId: 'CP01',
        isFinish: false,
        mesh: {
            userData: {
                ringState: RING_STATE_NEXT,
                ringMesh: {
                    rotation: { z: 0 },
                    scale: {
                        x: 1,
                        setScalar() {},
                    },
                    material: {
                        color: { setHex() {} },
                        emissive: { setHex() {} },
                        emissiveIntensity: 0,
                    },
                },
            },
        },
    };
}

test('Runtime config snapshot carries and clamps next checkpoint glow intensity', () => {
    const defaultSnapshot = createRuntimeConfigSnapshot({});
    assert.equal(defaultSnapshot.gameplay.nextCheckpointGlowIntensity, 1.35);

    const clampedSnapshot = createRuntimeConfigSnapshot({
        gameplay: {
            nextCheckpointGlowIntensity: 8,
        },
    });
    assert.equal(clampedSnapshot.gameplay.nextCheckpointGlowIntensity, 3);
});

test('CheckpointRingRuntime scales next-ring emissive pulse with gameplay glow setting', () => {
    const ringEntry = createRingEntry();
    const arena = {
        runtimeConfig: {
            gameplay: {
                nextCheckpointGlowIntensity: 2,
            },
        },
    };
    const runtime = new CheckpointRingRuntime(arena);

    runtime._animateNextPulse([ringEntry], 0);
    assert.equal(ringEntry.mesh.userData.ringMesh.material.emissiveIntensity, 2);

    arena.runtimeConfig.gameplay.nextCheckpointGlowIntensity = 0.5;
    runtime._animateNextPulse([ringEntry], 0);
    assert.equal(ringEntry.mesh.userData.ringMesh.material.emissiveIntensity, 0.5);
});
