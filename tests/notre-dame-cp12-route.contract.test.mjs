import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_OBSTACLES } from '../src/core/config/maps/presets/notre_dame/NotreDameStructure.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import {
    buildRouteFromParcours,
} from '../src/entities/systems/ParcoursProgressUtils.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { isParcoursGuidanceRequiredAfterBranch, resolveActiveParcoursGuidance } from '../src/shared/utils/ParcoursGuidance.js';
import { getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import {
    ARCADE_FACTORY_VEHICLE_IDS,
    resolveArcadeWallHitboxScale,
} from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    ARCADE_HITBOX_MIN_THICKNESS,
    buildArcadeHitboxShape,
    computeArcadeSweepSteps,
} from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { ARCADE_PART_SIZE_GROUPS, ARCADE_PART_SIZE_MAX_PCT } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP = NOTRE_DAME_MAPS.notre_dame;
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
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
const MAX_MODEL_SCALE = SETTINGS_LIMITS.gameplay.planeScale.max;

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

// Arcade walls see the part boxes, not hitboxRadius (PlayerCollisionPhase ->
// resolveArcadeArenaCollision): a ship is as wide as its wings. The 02.10.2026 playtest lost
// ship5 and the manta on the south apse flyer while the drone passed, so every factory ship
// is swept with its real wall shape, in world units against the GLB fabric.
const FACTORY_PART_SIZES = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 100]));
const MAX_PART_SIZES = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, ARCADE_PART_SIZE_MAX_PCT]));
function buildWallShapes(partSizes) {
    return ARCADE_FACTORY_VEHICLE_IDS.map((vehicleId) => ({
        vehicleId,
        shape: buildArcadeHitboxShape(getVehicleModularConfig(vehicleId)?.parts, partSizes, {
            originScale: resolveArcadeWallHitboxScale(vehicleId),
        }),
    }));
}
const WALL_SHAPES = buildWallShapes(FACTORY_PART_SIZES);
const MAX_WALL_SHAPES = buildWallShapes(MAX_PART_SIZES);
// A line only the exact centre threads is not a flyable route: each shape must also clear the
// path shifted this far sideways (world units).
const LATERAL_SLACK_WORLD = 1;
const FORWARD_LOCAL = new THREE.Vector3(0, 0, -1);

function firstShapeHit(colliders, shape, fromAuthored, toAuthored, startQuaternion, endQuaternion, modelScale) {
    const from = new THREE.Vector3(...fromAuthored).multiplyScalar(MAP_SCALE);
    const to = new THREE.Vector3(...toAuthored).multiplyScalar(MAP_SCALE);
    const reach = shape.boundRadius * modelScale;
    const steps = computeArcadeSweepSteps(
        from.distanceTo(to), startQuaternion.angleTo(endQuaternion), reach,
        ARCADE_HITBOX_MIN_THICKNESS * modelScale,
    );
    const pose = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const hits = (point, radius) => colliders.find((entry) => sphereIntersectsStaticMeshCollider(
        entry.meshCollider,
        { x: point.x / MAP_SCALE, y: point.y / MAP_SCALE, z: point.z / MAP_SCALE },
        radius / MAP_SCALE,
    ));
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        pose.lerpVectors(from, to, t);
        quaternion.slerpQuaternions(startQuaternion, endQuaternion, t);
        if (!hits(pose, reach)) continue;
        for (let k = 0; k < shape.probes.length / 4; k += 1) {
            probe.set(shape.probes[k * 4], shape.probes[k * 4 + 1], shape.probes[k * 4 + 2]).multiplyScalar(modelScale)
                .applyQuaternion(quaternion).add(pose);
            const blocker = hits(probe, shape.probes[k * 4 + 3] * modelScale);
            if (blocker) return {
                world: pose.toArray().map((value) => +value.toFixed(2)),
                probe: probe.toArray().map((value) => +value.toFixed(2)),
                sourceName: blocker.sourceName,
            };
        }
    }
    return null;
}

function firstStructureShapeHit(collision, shape, fromAuthored, toAuthored, startQuaternion, endQuaternion, modelScale) {
    const from = new THREE.Vector3(...fromAuthored).multiplyScalar(MAP_SCALE);
    const to = new THREE.Vector3(...toAuthored).multiplyScalar(MAP_SCALE);
    const reach = shape.boundRadius * modelScale;
    const steps = computeArcadeSweepSteps(
        from.distanceTo(to), startQuaternion.angleTo(endQuaternion), reach,
        ARCADE_HITBOX_MIN_THICKNESS * modelScale,
    );
    const pose = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        pose.lerpVectors(from, to, t);
        quaternion.slerpQuaternions(startQuaternion, endQuaternion, t);
        for (let k = 0; k < shape.probes.length / 4; k += 1) {
            probe.set(shape.probes[k * 4], shape.probes[k * 4 + 1], shape.probes[k * 4 + 2])
                .multiplyScalar(modelScale).applyQuaternion(quaternion).add(pose);
            if (collision.checkWorldGeometryCollision(probe, shape.probes[k * 4 + 3] * modelScale)) {
                    return {
                        world: pose.toArray().map((value) => +value.toFixed(2)),
                        probe: probe.toArray().map((value) => +value.toFixed(2)),
                    };
            }
        }
    }
    return null;
}

function directionQuaternion(direction) {
    return new THREE.Quaternion().setFromUnitVectors(FORWARD_LOCAL, new THREE.Vector3(...direction).normalize());
}

function headingQuaternion(from, to) {
    const heading = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    return directionQuaternion(heading.toArray());
}

function lateralOffsets(from, to) {
    const side = new THREE.Vector3(to[0] - from[0], 0, to[2] - from[2]).cross(new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-9) {
        const slack = LATERAL_SLACK_WORLD / MAP_SCALE;
        return [[0, 0, 0], [slack, 0, 0], [-slack, 0, 0], [0, 0, slack], [0, 0, -slack]];
    }
    side.normalize().multiplyScalar(LATERAL_SLACK_WORLD / MAP_SCALE);
    return [[0, 0, 0], side.toArray(), side.clone().negate().toArray()];
}

test('Notre-Dame CP11 guidance preserves 16 stages and clears the real apse bore', async () => {
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
    const approach = routeCheckpoint('CP11_APSE_APPROACH');
    const cp12 = routeCheckpoint('CP12');
    assert.equal(route.totalCheckpoints, 16, 'guidance points do not become progress stages');
    assert.equal(ambulatoryExit.aliasOf, choirExit.id, 'the chosen low exit reuses the same progression stage');
    assert.deepEqual(choir.nextCheckpointIds, ['CP11_APSE_EXIT']);
    assert.deepEqual(ambulatory.nextCheckpointIds, ['CP11_APSE_EXIT']);
    assert.deepEqual(choirExit.nextCheckpointIds, ['CP11_APSE_APPROACH']);
    assert.deepEqual(approach.nextCheckpointIds, [cp12.id]);
    assert.deepEqual(route.guidancePaths.map((path) => path.branchCheckpointId), [choir.id, ambulatory.id]);

    const paths = route.guidancePaths.map((guidance) => ({
        id: guidance.branchCheckpointId,
        points: guidance.points,
    }));
    assert.ok(paths[0].points.some((point) => point.every((value, axis) => value === choirExit.pos[axis])));
    assert.ok(paths[0].points.some((point) => point.every((value, axis) => value === approach.pos[axis])));
    assert.ok(paths[0].points.some((point) => point.every((value, axis) => value === cp12.pos[axis])));
    assert.ok(paths[1].points.some((point) => point.every((value, axis) => value === ambulatoryExit.pos[axis])));
    assert.deepEqual(paths[1].points.at(-2), cp12.pos);

    const structureArena = {
        obstacles: [],
        _pendingWallGeos: [],
        _pendingObstacleGeos: [],
        _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [],
        _pendingFoamEdgeGeos: [],
    };
    new ArenaGeometryCompilePipeline(structureArena).compileObstacleStage({
        obstacleDefs: NOTRE_DAME_OBSTACLES,
        scale: MAP_SCALE,
    });
    const structureCollision = new ArenaCollision(structureArena);

    const entityManager = {
        arena: { currentMapDefinition: MAP },
        activeGameMode: 'ARCADE',
        entityRuntimeConfig: CONFIG_SECTIONS,
        _simulationClockMs: 0,
    };
    const system = new ParcoursProgressSystem(entityManager);
    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 1.1, position: { x: 0, y: 0, z: 0 } };
    system.startRound([player]);
    const liveRoute = system.getRouteSnapshot();
    assert.equal(liveRoute.totalCheckpoints, 16);
    assert.equal(liveRoute.guidancePaths.length, 2);
    assert.equal(liveRoute.guidancePathWindows.length, 2, 'path windows remain bounded and deduplicated');
    assert.ok(Object.isFrozen(liveRoute.guidancePaths)
        && liveRoute.guidancePaths.every((path) => Object.isFrozen(path) && Object.isFrozen(path.points)
            && path.points.every(Object.isFrozen)), 'route snapshots share immutable, prebuilt guidance data');
    for (const branchId of [choir.id, ambulatory.id]) {
        const stageIds = [];
        const manager = new ParcoursProgressSystem({ ...entityManager, arena: { currentMapDefinition: MAP } });
        const runPlayer = { ...player, position: { x: 0, y: 0, z: 0 } };
        manager.startRound([runPlayer]);
        let now = 1000;
        while (true) {
            const progress = manager.getPlayerProgressSnapshot(0, now);
            if (progress.nextCheckpointIndex >= route.totalCheckpoints) break;
            const expected = progress.expectedCheckpointIds.map((id) => manager.getRouteSnapshot().checkpoints.find((entry) => entry.id === id));
            assert.ok(expected.length > 0, `natural route progression has an expected ring at stage ${progress.nextCheckpointIndex}`);
            const selected = expected.find((entry) => entry.id === branchId)
                || (progress.nextCheckpointIndex === choirExit.routeIndex
                    ? expected.find((entry) => entry.id === (branchId === ambulatory.id ? ambulatoryExit.id : choirExit.id))
                    : expected[0]);
            assert.ok(selected, `expected the selected branch ${branchId} at stage ${progress.nextCheckpointIndex}`);
            const direction = new THREE.Vector3(...selected.forward).normalize();
            const before = {
                x: selected.pos[0] - direction.x * selected.radius * 0.5,
                y: selected.pos[1] - direction.y * selected.radius * 0.5,
                z: selected.pos[2] - direction.z * selected.radius * 0.5,
            };
            runPlayer.position = {
                x: selected.pos[0] + direction.x * selected.radius * 0.5,
                y: selected.pos[1] + direction.y * selected.radius * 0.5,
                z: selected.pos[2] + direction.z * selected.radius * 0.5,
            };
            const previousIndex = progress.nextCheckpointIndex;
            manager.updatePlayerProgress(runPlayer, before, now);
            now += 451;
            stageIds.push(selected.id);
            const after = manager.getPlayerProgressSnapshot(0, now);
            assert.equal(after.nextCheckpointIndex, previousIndex + 1, `${selected.id} advances one real stage`);
            if (selected.id === branchId) {
                const guidance = resolveActiveParcoursGuidance(manager.getRouteSnapshot(), after);
                assert.equal(guidance?.branchCheckpointId, branchId, 'the active guidance follows the naturally selected lane');
            }
            if (selected.id === cp12.id) {
                assert.equal(resolveActiveParcoursGuidance(manager.getRouteSnapshot(), after), null,
                    'route guidance deactivates after CP12');
            }
        }
        assert.equal(stageIds.includes(branchId), true);
        assert.equal(stageIds.length, route.totalCheckpoints, 'natural progression reaches all 16 stages');
    }

    const setGuidance = resolveActiveParcoursGuidance(liveRoute, {
        nextCheckpointIndex: choirExit.routeIndex,
        passedCheckpointIds: new Set([choir.id]),
    });
    assert.equal(setGuidance?.branchCheckpointId, choir.id, 'the minimap Set membership path resolves guidance');
    const overlappingGuidance = resolveActiveParcoursGuidance({
        ...liveRoute,
        guidancePaths: [
            { branchCheckpointId: 'CP05_ROSE', endCheckpointId: cp12.id, points: [[0, 0, 0], [1, 0, 0]] },
            liveRoute.guidancePaths.find((path) => path.branchCheckpointId === ambulatory.id),
        ],
    }, { nextCheckpointIndex: choirExit.routeIndex, passedCheckpointIds: ['CP05_ROSE', ambulatory.id] });
    assert.equal(overlappingGuidance?.branchCheckpointId, ambulatory.id,
        'when guidance windows overlap, the most recently selected branch owns the route');
    const aliasGuidanceRoute = {
        ...liveRoute,
        checkpoints: [
            { ...choir, aliasOf: undefined },
            { id: 'CP11_CHOIR_ALIAS', routeIndex: choir.routeIndex, aliasOf: choir.id, isBranchOption: true },
            ...liveRoute.checkpoints.filter((checkpoint) => checkpoint.id !== choir.id),
        ],
    };
    assert.equal(resolveActiveParcoursGuidance(aliasGuidanceRoute, {
        nextCheckpointIndex: choirExit.routeIndex,
        passedCheckpointIds: ['CP11_CHOIR_ALIAS'],
    })?.branchCheckpointId, choir.id, 'a passed alias activates its canonical guided branch');
    assert.equal(resolveActiveParcoursGuidance({
        ...liveRoute,
        guidancePaths: [{ branchCheckpointId: choir.id, endCheckpointId: 'missing-end', points: [] }],
    }, { nextCheckpointIndex: choirExit.routeIndex, passedCheckpointIds: new Set([choir.id]) }), null,
    'unknown guidance ends fail closed');
    assert.equal(isParcoursGuidanceRequiredAfterBranch({
        ...liveRoute,
        guidanceRequired: true,
        guidancePaths: [],
        guidanceBranchCheckpointIds: [choir.id],
    }, { nextCheckpointIndex: choirExit.routeIndex + 1, passedCheckpointIds: [choir.id] }), true,
    'consumers suppress direct-ring fallbacks after a selected branch with no valid guidance path');
    const earlierBranch = liveRoute.checkpoints.find((checkpoint) => checkpoint.id === 'CP05_ROSE');
    assert.equal(isParcoursGuidanceRequiredAfterBranch(liveRoute, {
        nextCheckpointIndex: earlierBranch.routeIndex + 1,
        passedCheckpointIds: ['CP03', 'CP05_ROSE'],
    }), false, 'an unrelated earlier branch does not suppress bot guidance');
    const rejectedGuidance = buildRouteFromParcours({
        ...MAP.parcours,
        guidancePaths: [
            { branchCheckpointId: 'missing-branch', endCheckpointId: 'CP12', points: [[0, 0, 0], [1, 1, 1]] },
            { branchCheckpointId: 'CP11_CHOIR', endCheckpointId: 'missing-end', points: [[0, 0, 0], [1, 1, 1]] },
            { branchCheckpointId: 'CP11_CHOIR', endCheckpointId: 'CP12', points: [[0, 0, 0], ['bad', 1, 1]] },
        ],
    });
    assert.equal(rejectedGuidance.guidancePaths.length, 0, 'invalid guidance definitions are discarded');
    assert.deepEqual(rejectedGuidance.guidanceBranchCheckpointIds, [choir.id],
        'a malformed selected-lane path still identifies the branch whose direct fallback is unsafe');
    assert.equal(isParcoursGuidanceRequiredAfterBranch(liveRoute, {
        nextCheckpointIndex: cp12.routeIndex + 1,
        passedCheckpointIds: [ambulatory.id, cp12.id],
    }), false, 'guidance suppression ends after CP12');
    const windowsRoute = {
        ...liveRoute,
        guidanceRequired: true,
        guidancePaths: [],
        guidanceBranchCheckpointIds: [],
        guidancePathWindows: [{ branchCheckpointId: choir.id, endCheckpointId: cp12.id }],
    };
    assert.equal(isParcoursGuidanceRequiredAfterBranch(windowsRoute, { nextCheckpointIndex: choirExit.routeIndex }), true,
        'legacy snapshots fail closed inside a guided window when branch history is missing');
    assert.equal(isParcoursGuidanceRequiredAfterBranch(windowsRoute, {
        nextCheckpointIndex: choirExit.routeIndex,
        passedCheckpointIds: new Set(),
    }), true, 'minimap empty Set history uses the same legacy fail-closed window');
    const partialGuidanceRoute = {
        ...windowsRoute,
        checkpoints: [
            { id: 'GUIDED', routeIndex: 10, isBranchOption: true },
            { id: 'DIRECT', routeIndex: 10, isBranchOption: true },
            { id: cp12.id, routeIndex: cp12.routeIndex },
        ],
        guidanceBranchCheckpointIds: ['GUIDED'],
        guidancePathWindows: [{ branchCheckpointId: 'GUIDED', endCheckpointId: cp12.id }],
    };
    assert.equal(isParcoursGuidanceRequiredAfterBranch(partialGuidanceRoute, {
        nextCheckpointIndex: 11,
        passedCheckpointIds: ['DIRECT'],
    }), false, 'an explicitly selected unguided sibling retains normal route guidance');
    assert.equal(isParcoursGuidanceRequiredAfterBranch(windowsRoute, { nextCheckpointIndex: cp12.routeIndex + 1 }), false,
        'legacy snapshot fallback resumes after the guided window ends');

    const minimumDistanceTo = (points, center) => {
        let minimum = Infinity;
        for (let segment = 0; segment < points.length - 1; segment += 1) {
            const from = new THREE.Vector3(...points[segment]);
            const to = new THREE.Vector3(...points[segment + 1]);
            const axis = to.clone().sub(from);
            const t = Math.max(0, Math.min(1, new THREE.Vector3(...center).sub(from).dot(axis) / axis.lengthSq()));
            minimum = Math.min(minimum, from.clone().addScaledVector(axis, t).distanceTo(new THREE.Vector3(...center)));
        }
        return minimum;
    };
    assert.ok(minimumDistanceTo(paths[1].points.slice(1), choirExit.pos) > choirExit.radius + 1,
        'the ambulatory lane does not re-enter the unchosen canonical exit trigger');
    assert.ok(minimumDistanceTo(paths[0].points, ambulatoryExit.pos) > ambulatoryExit.radius + 1,
        'the choir lane stays clear of the unchosen ambulatory alias');

    for (const path of paths) {
        for (let index = 0; index < path.points.length - 1; index += 1) {
            const from = path.points[index];
            const to = path.points[index + 1];
            const startQuaternion = index === 0
                ? directionQuaternion(routeCheckpoint(path.id).forward)
                : headingQuaternion(path.points[index - 1], from);
            const endQuaternion = headingQuaternion(from, to);
            for (const offset of lateralOffsets(from, to)) {
                const shiftedFrom = from.map((value, axis) => value + offset[axis]);
                const shiftedTo = to.map((value, axis) => value + offset[axis]);
                for (const { vehicleId, shape } of MAX_WALL_SHAPES) {
                    const glbHit = firstShapeHit(loaded.colliders, shape, shiftedFrom, shiftedTo,
                        startQuaternion, endQuaternion, MAX_MODEL_SCALE);
                    assert.equal(glbHit, null,
                        `${path.id}: maximum ${vehicleId} profile clears GLB along ${from.join(',')}→${to.join(',')}: ${JSON.stringify(glbHit)}`);
                    const structureHit = firstStructureShapeHit(structureCollision, shape, shiftedFrom, shiftedTo,
                        startQuaternion, endQuaternion, MAX_MODEL_SCALE);
                    assert.equal(structureHit, null,
                        `${path.id}: maximum ${vehicleId} profile clears NotreDameStructure along ${from.join(',')}→${to.join(',')}: ${JSON.stringify(structureHit)}`);
                }
            }
        }
    }
    assert.equal(MAX_MODEL_SCALE, 2);
    assert.equal(ARCADE_PART_SIZE_MAX_PCT, 125);
});
