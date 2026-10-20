import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { checkTrailCollision, refreshHeuristicPlannedPathClearance, resolveHeuristicSelfTrailSkipRecentSegments } from '../src/entities/ai/HeuristicTrailSafetyOps.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

function createClearanceState(planarMode = false) {
    return {
        planarMode,
        frontArenaClearance: 0.9,
        frontTrailClearance: 0.8,
        frontClearance: 0.75,
        leftArenaClearance: 0.6,
        leftTrailClearance: 0.55,
        leftClearance: 0.5,
        rightArenaClearance: 0.4,
        rightTrailClearance: 0.35,
        rightClearance: 0.3,
        upArenaClearance: 0.25,
        upTrailClearance: 0.2,
        upClearance: 0.15,
        downArenaClearance: 0.1,
        downTrailClearance: 0.08,
        downClearance: 0.05,
    };
}

test('real trail queries skip the own recent envelope and still detect a rival segment', () => {
    const playerTrail = { writeIndex: 2, maxSegments: 100, width: 0.6 };
    const player = {
        index: 1,
        speed: 18,
        hitboxRadius: 0.8,
        trail: playerTrail,
        entityRuntimeConfig: { PLAYER: { SPEED: 18, HITBOX_RADIUS: 0.8 }, TRAIL: { UPDATE_INTERVAL: 0.07, WIDTH: 0.6 } },
    };
    const players = [null, player, { index: 2, trail: null }];
    const index = new TrailSpatialIndex({ players });
    const point = new THREE.Vector3(0, 0, -5);
    const owner = Object.create(EntityManager.prototype);
    const runtimeContext = { entityManager: owner };
    const skipRecent = resolveHeuristicSelfTrailSkipRecentSegments(runtimeContext, player);
    assert.equal(skipRecent, EntityManager.deriveSelfTrailSkipRecentSegments(player));
    assert.ok(skipRecent > 0);

    index.registerTrailSegment(1, 1, {
        fromX: 0, fromY: 0, fromZ: -5,
        toX: 0, toY: 0, toZ: -5,
        radius: 0.4,
        ownerTrail: playerTrail,
    });
    assert.equal(checkTrailCollision(index, point, 0.5, player, skipRecent), false,
        'the recent own segment is inside the skip envelope');

    index.registerTrailSegment(2, 0, {
        fromX: 0, fromY: 0, fromZ: -5,
        toX: 0, toY: 0, toZ: -5,
        radius: 0.4,
    });
    assert.equal(checkTrailCollision(index, point, 0.5, player, skipRecent), true,
        'the same spatial point on another player trail remains dangerous');
});

test('held keys and analog axes include the chosen path; planar clearance ignores pitch', () => {
    const heldState = createClearanceState();
    refreshHeuristicPlannedPathClearance(heldState, { yawLeft: true, pitchUp: true });
    assert.equal(heldState.plannedArenaClearance, 0.25, 'held yaw-left and pitch-up include both lanes');
    assert.equal(heldState.plannedTrailClearance, 0.2);
    assert.equal(heldState.plannedClearance, 0.15);

    const axisState = createClearanceState();
    refreshHeuristicPlannedPathClearance(axisState, { yawAxis: -0.6, pitchAxis: -0.7 });
    assert.equal(axisState.plannedArenaClearance, 0.1, 'negative axes select right and down');
    assert.equal(axisState.plannedTrailClearance, 0.08);
    assert.equal(axisState.plannedClearance, 0.05);

    const planarState = createClearanceState(true);
    refreshHeuristicPlannedPathClearance(planarState, { yawAxis: -0.6, pitchAxis: -0.7 });
    assert.equal(planarState.plannedArenaClearance, 0.4, 'planar mode includes the right lane only');
    assert.equal(planarState.plannedTrailClearance, 0.35);
    assert.equal(planarState.plannedClearance, 0.3);
});
