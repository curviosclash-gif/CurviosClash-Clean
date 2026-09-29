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

function assertClose(actual, expected, message = undefined) {
    assert.ok(Math.abs(actual - expected) < 1e-9, message || `expected ${actual} to be close to ${expected}`);
}

function createGuidanceScene(intensity, ringPos = { x: 48, y: 0, z: 0 }) {
    const ring = createRingEntry({ checkpointId: 'CP01', routeIndex: 0 });
    ring.pos = { ...ringPos };
    ring.mesh.userData.ringState = 'next';
    ring.mesh.userData.guidanceMotifs = Array.from({ length: 6 }, createGuidanceMotif);
    const arena = { checkpointRings: [ring], runtimeConfig: { gameplay: { nextCheckpointGlowIntensity: intensity } } };
    const runtime = new CheckpointRingRuntime(arena);
    const player = { position: { x: 0, y: 0, z: 0 } };
    runtime.setGuidanceProvider(() => ({ active: true, player, nextCheckpointIndex: 0, totalCheckpoints: 3, completed: false }));
    return { ring, arena, runtime, player, motifs: ring.mesh.userData.guidanceMotifs };
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
    assert.ok(branchB.mesh.userData.guidanceMotifs.every((motif) => motif.material.opacity <= 0.93));
    // An out-of-range setting clamps to the slider maximum (3), not to a hidden lower cap.
    assertClose(runtime.getGuidanceView().intensity, 3 / 1.35);
    // The trail starts just ahead of the player (8 units), not 24 units before the ring.
    assertClose(branchA.mesh.userData.guidanceMotifs[0].position.x, 8 - 48);

    runtime._animateGuidance(arena.checkpointRings, 600);
    assertClose(branchA.mesh.userData.guidanceMotifs[0].position.x, 8 + 36 * 0.5 - 48);
    assert.ok(branchA.mesh.userData.guidanceMotifs[0].userData.guidanceCore.material.opacity > 0);

    runtime._animateGuidance(arena.checkpointRings, 1200);
    assert.equal(runtime.getGuidanceView().active, true);
    assert.equal(runtime.getGuidanceView().pulse, 0);
    assert.ok(branchA.mesh.userData.guidanceMotifs.every((motif) => !motif.visible));

    // Standing still for 3 s asks for help again.
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

test('One glow slider scales the guidance trail continuously over its whole range', () => {
    const coreOpacityAt = (intensity) => {
        const scene = createGuidanceScene(intensity);
        scene.runtime._animateGuidance(scene.arena.checkpointRings, 0);
        // Motif 1 sits at t = 1/6, where the edge fade is exactly 1.
        return {
            opacity: scene.motifs[1].userData.guidanceCore.material.opacity,
            visible: scene.motifs.some((motif) => motif.visible),
            active: scene.runtime.getGuidanceView().active,
        };
    };
    const off = coreOpacityAt(0);
    assert.equal(off.visible, false);
    assert.equal(off.active, false);
    const standard = coreOpacityAt(1.35).opacity;
    const raised = coreOpacityAt(2).opacity;
    const maximum = coreOpacityAt(3).opacity;
    assertClose(standard, 0.42);
    assert.ok(raised > standard, `slider 2 (${raised}) must be brighter than 1.35 (${standard})`);
    assert.ok(maximum > raised, `slider 3 (${maximum}) must be brighter than 2 (${raised})`);
    assert.ok(maximum <= 0.93);
});

test('Checkpoint guidance breathes on target change and on a stall, not on a fixed clock', () => {
    const { arena, runtime, player, motifs } = createGuidanceScene(1.35, { x: 100, y: 0, z: 0 });
    const rings = arena.checkpointRings;
    runtime._animateGuidance(rings, 0);
    assert.equal(runtime.getGuidanceView().pulse, 1);
    assert.ok(motifs.every((motif) => motif.visible));

    runtime._animateGuidance(rings, 1200);
    assert.equal(runtime.getGuidanceView().active, true, 'the edge cue keeps its targets outside the breath');
    assert.equal(runtime.getGuidanceView().pulse, 0);
    assert.ok(motifs.every((motif) => !motif.visible));

    // Closing in on the ring: no breath, even where the old 4.5 s cycle would have fired.
    for (const now of [1500, 2500, 3500, 4500]) {
        player.position.x += 5;
        runtime._animateGuidance(rings, now);
    }
    assert.equal(runtime.getGuidanceView().pulse, 0);
    assert.ok(motifs.every((motif) => !motif.visible));

    // Standing still: a new breath only after 3 s without progress.
    runtime._animateGuidance(rings, 7400);
    assert.ok(motifs.every((motif) => !motif.visible));
    runtime._animateGuidance(rings, 7500);
    assert.equal(runtime.getGuidanceView().pulse, 1);
    assert.ok(motifs.every((motif) => motif.visible));
});

test('CheckpointRingRuntime animates on the game clock, so dt 0 freezes the trail', () => {
    const { runtime, motifs } = createGuidanceScene(1.35);
    runtime.update(0);
    const first = motifs[0].position.x;
    assertClose(first, 8 - 48);
    for (let i = 0; i < 2000; i += 1) Math.sqrt(i);
    runtime.update(0);
    assert.equal(motifs[0].position.x, first);
    runtime.update(0.6);
    assertClose(motifs[0].position.x, 8 + 36 * 0.5 - 48);
});