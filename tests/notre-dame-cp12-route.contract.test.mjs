import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import {
    buildRouteFromParcours,
    createPlayerProgressState,
    resolveExpectedCheckpointEntries,
} from '../src/entities/systems/ParcoursProgressUtils.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP = NOTRE_DAME_MAPS.notre_dame;
const FABRIC_MODEL_IDS = new Set([
    'notre-dame-parvis',
    'notre-dame-west-facade',
    'notre-dame-nave',
    'notre-dame-transept',
    'notre-dame-choir-apse',
    'notre-dame-buttresses',
    'notre-dame-roof-fleche',
]);
const SHIP_RADIUS_AUTHORED = 1.6 / 3;
const MAX_SWEEP_STEP = SHIP_RADIUS_AUTHORED / 2;

function blockedCollider(colliders, point) {
    const center = { x: point[0], y: point[1], z: point[2] };
    return colliders.find((entry) => sphereIntersectsStaticMeshCollider(
        entry.meshCollider,
        center,
        SHIP_RADIUS_AUTHORED,
    )) || null;
}

function firstSweepHit(colliders, from, to) {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const steps = Math.max(1, Math.ceil(distance / MAX_SWEEP_STEP));
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const point = from.map((value, axis) => value + (to[axis] - value) * t);
        const blocker = blockedCollider(colliders, point);
        if (blocker) return { point, modelId: blocker.modelId, sourceName: blocker.sourceName };
    }
    return null;
}

test('both choir branches clear the CP12 ring approach and pass through the east apse opening', async () => {
    const descriptors = MAP.glbModels.filter((model) => FABRIC_MODEL_IDS.has(model.id));
    const loaded = await loadGLBMapCollection(descriptors, {
        loader: geometryOnlyGlbLoader,
        placementScale: 1,
        colliderMode: 'scene',
        requireComplete: true,
        concurrency: 3,
    });
    assert.equal(loaded.loadedCount, FABRIC_MODEL_IDS.size);
    assert.equal(loaded.warnings.length, 0);
    assert.ok(loaded.colliders.length > 0);

    const route = buildRouteFromParcours(MAP.parcours);
    const routeCheckpoint = (id) => {
        const entry = route.checkpoints.find((candidate) => candidate.id === id);
        assert.ok(entry, `${id} is part of the built route`);
        return entry;
    };
    const choir = routeCheckpoint('CP11_CHOIR');
    const ambulatory = routeCheckpoint('CP11_AMBULATORY');
    const choirExit = routeCheckpoint('CP11_APSE_EXIT');
    const ambulatoryExit = routeCheckpoint('CP11_APSE_EXIT_AMBULATORY');
    const approachRing = routeCheckpoint('CP11_APSE_APPROACH');
    const cp12 = routeCheckpoint('CP12');
    assert.equal(ambulatoryExit.aliasOf, choirExit.id);
    assert.deepEqual(choir.nextCheckpointIds, [choirExit.id]);
    assert.deepEqual(ambulatory.nextCheckpointIds, [choirExit.id]);
    assert.deepEqual(choirExit.nextCheckpointIds, [approachRing.id]);
    assert.deepEqual(approachRing.nextCheckpointIds, [cp12.id]);
    for (const branch of [choir, ambulatory]) {
        const state = createPlayerProgressState(route.totalCheckpoints);
        state.nextCheckpointIndex = choirExit.routeIndex;
        state.stageCheckpointIds[choirExit.routeIndex - 1] = branch.id;
        assert.deepEqual(
            resolveExpectedCheckpointEntries(route, state).map((entry) => entry.id),
            [choirExit.id, ambulatoryExit.id],
            `${branch.id} leads to the authored CP11 apse-exit stage`,
        );
    }
    const previousCp12 = [85, 23, 0];
    assert.ok(firstSweepHit(loaded.colliders, choir.pos, previousCp12),
        'the former straight choir approach intersects the placed cathedral triangles');
    assert.ok(firstSweepHit(loaded.colliders, ambulatory.pos, previousCp12),
        'the former straight ambulatory approach intersects the placed cathedral triangles');
    const approach = cp12.pos.map((value, axis) => value - cp12.forward[axis] * cp12.radius);
    const exit = cp12.pos.map((value, axis) => value + cp12.forward[axis] * cp12.radius);
    const apseWallFace = [86.5, cp12.pos[1], cp12.pos[2]];
    const outside = [94, cp12.pos[1], cp12.pos[2]];

    // The high choir branch stays in the vessel. The low branch follows the ambulatory to its
    // eastern end, rises above the aisle roof, then enters the same vessel-side approach.
    const paths = [
        {
            id: 'CP11_CHOIR',
            points: [choir.pos, choirExit.pos, approachRing.pos, approach,
                cp12.pos, apseWallFace, exit, outside],
        },
        {
            id: 'CP11_AMBULATORY',
            points: [ambulatory.pos, ambulatoryExit.pos, approachRing.pos, approach,
                cp12.pos, apseWallFace, exit, outside],
        },
    ];

    for (const path of paths) {
        for (let index = 0; index < path.points.length - 1; index += 1) {
            const from = path.points[index];
            const to = path.points[index + 1];
            const hit = firstSweepHit(loaded.colliders, from, to);
            assert.equal(hit, null,
                `${path.id} has a ${MAX_SWEEP_STEP.toFixed(3)} authored-unit full-ship-clear sweep `
                + `from ${from.join(',')} to ${to.join(',')}; hit ${JSON.stringify(hit)}`);
        }
    }
});
