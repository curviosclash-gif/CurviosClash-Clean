import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    createCheckpointRingMesh,
    disposeCheckpointRingMesh,
    RING_STATE_INACTIVE,
    RING_STATE_PASSED,
} from '../src/entities/arena/CheckpointRingMeshFactory.js';
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

function createGuidanceMotif() {
    return {
        visible: false,
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        scale: { setScalar() {} },
        material: { color: { setHex() {} }, opacity: 0 },
        userData: { guidanceCore: { material: { opacity: 0 } } },
    };
}

test('Checkpoint guidance motifs have a depth-tested additive core without bloom', () => {
    const group = createCheckpointRingMesh(new THREE.Vector3(), null, 1);
    const motifs = group.userData.guidanceMotifs;
    assert.equal(motifs.length, 6);
    assert.ok(motifs.every((motif) => motif.userData.guidanceCore?.isMesh));
    for (const motif of motifs) {
        assert.equal(motif.geometry.type, 'OctahedronGeometry');
        assert.equal(motif.material.blending, THREE.AdditiveBlending);
        assert.equal(motif.material.depthTest, true);
        assert.equal(motif.material.toneMapped, false);
        assert.equal(motif.userData.guidanceCore.material.blending, THREE.AdditiveBlending);
        assert.equal(motif.userData.guidanceCore.material.depthTest, true);
        assert.equal(motif.userData.guidanceCore.material.toneMapped, false);
    }
    let disposed = 0;
    motifs[0].userData.guidanceCore.material.addEventListener('dispose', () => { disposed += 1; });
    disposeCheckpointRingMesh(group);
    assert.equal(disposed, 1);
});

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

test('CheckpointRingRuntime guides all equal branch targets, then the finish, and clears at zero intensity', () => {
    const branchA = createRingEntry({ checkpointId: 'CP03A', routeIndex: 2 });
    const branchB = createRingEntry({ checkpointId: 'CP03B', routeIndex: 2 });
    const finish = createRingEntry({ checkpointId: 'FINISH', routeIndex: -1 });
    finish.isFinish = true;
    branchA.pos = { x: 48, y: 0, z: 0 };
    branchB.pos = { x: 0, y: 0, z: 48 };
    finish.pos = { x: 0, y: 0, z: 60 };
    for (const entry of [branchA, branchB, finish]) {
        entry.mesh.userData.guidanceMotifs = Array.from({ length: 6 }, createGuidanceMotif);
    }
    branchA.mesh.userData.ringState = 'next';
    branchB.mesh.userData.ringState = 'next';
    const arena = { checkpointRings: [branchA, branchB, finish], runtimeConfig: { gameplay: { nextCheckpointGlowIntensity: 8 } } };
    const runtime = new CheckpointRingRuntime(arena);
    let source = { active: true, player: { position: { x: 0, y: 0, z: 0 } }, nextCheckpointIndex: 2, totalCheckpoints: 3, completed: false };
    runtime.setGuidanceProvider(() => source);
    runtime._animateGuidance(arena.checkpointRings, 0);

    assert.equal(runtime.getGuidanceView().targets.length, 2);
    assert.ok(branchA.mesh.userData.guidanceMotifs.every((motif) => motif.visible));
    assert.ok(branchB.mesh.userData.guidanceMotifs.every((motif) => motif.material.opacity <= 0.42));
    assert.equal(runtime.getGuidanceView().intensity, 2);
    assert.equal(branchA.mesh.userData.guidanceMotifs[0].position.x, -24);

    runtime._animateGuidance(arena.checkpointRings, 600);
    assert.equal(branchA.mesh.userData.guidanceMotifs[0].position.x, -12);
    assert.ok(branchA.mesh.userData.guidanceMotifs[0].userData.guidanceCore.material.opacity > 0);

    runtime._animateGuidance(arena.checkpointRings, 1200);
    assert.equal(runtime.getGuidanceView().active, false);
    assert.ok(branchA.mesh.userData.guidanceMotifs.every((motif) => !motif.visible));

    runtime._animateGuidance(arena.checkpointRings, 4500);
    assert.equal(runtime.getGuidanceView().active, true);
    assert.ok(branchA.mesh.userData.guidanceMotifs.every((motif) => motif.visible));

    arena.runtimeConfig.gameplay.nextCheckpointGlowIntensity = 0;
    runtime._animateGuidance(arena.checkpointRings, 4600);
    arena.runtimeConfig.gameplay.nextCheckpointGlowIntensity = 1.35;
    runtime._animateGuidance(arena.checkpointRings, 4700);
    assert.equal(runtime.getGuidanceView().active, true);
    assert.ok(branchA.mesh.userData.guidanceMotifs.every((motif) => motif.visible));

    branchA.mesh.userData.ringState = 'inactive';
    branchB.mesh.userData.ringState = 'inactive';
    source = { ...source, nextCheckpointIndex: 3 };
    runtime._animateGuidance(arena.checkpointRings, 4800);
    assert.deepEqual(runtime.getGuidanceView().targets, [finish]);

    arena.runtimeConfig.gameplay.nextCheckpointGlowIntensity = 0;
    runtime._animateGuidance(arena.checkpointRings, 4900);
    assert.equal(runtime.getGuidanceView().active, false);
    assert.ok(finish.mesh.userData.guidanceMotifs.every((motif) => !motif.visible));

    arena.runtimeConfig.gameplay.nextCheckpointGlowIntensity = 1.35;
    finish.pos = { x: 0, y: 0, z: 0 };
    runtime._animateGuidance(arena.checkpointRings, 5000);
    assert.ok(finish.mesh.userData.guidanceMotifs.every((motif) => !motif.visible));
});
