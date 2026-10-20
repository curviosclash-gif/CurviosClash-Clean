import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { applyHeuristicSafetyArbiter } from '../src/entities/ai/HeuristicBotSafetyOps.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PLANAR_MODE_ACTIVE,
    PROJECTILE_THREAT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';

function safeObservation() {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    for (const index of [
        WALL_DISTANCE_FRONT, WALL_DISTANCE_LEFT, WALL_DISTANCE_RIGHT,
        WALL_DISTANCE_UP, WALL_DISTANCE_DOWN,
    ]) observation[index] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 1;
    observation[PROJECTILE_THREAT] = 0;
    observation[PLANAR_MODE_ACTIVE] = 0;
    return observation;
}

function createScene({ wall = false, trail = false } = {}) {
    const player = {
        index: 1,
        alive: true,
        isBot: true,
        position: new THREE.Vector3(),
        speed: 18,
        baseSpeed: 18,
        hitboxRadius: 0.8,
        arcadeAvoidRadius: 0.8,
        inventory: [],
        entityRuntimeConfig: { GAMEPLAY: { PLANAR_MODE: false } },
        getDirection(out) { return out.set(0, 0, -1); },
    };
    const rival = { index: 2, alive: true, isBot: true, trail: null };
    const players = [null, player, rival];
    const trailSpatialIndex = new TrailSpatialIndex({ players });
    if (trail) {
        trailSpatialIndex.registerTrailSegment(2, 0, {
            fromX: -0.1, fromY: 0, fromZ: -5,
            toX: 0.1, toY: 0, toZ: -5,
            radius: 0.1,
        });
    }
    const collisionSamples = [];
    const arena = {
        checkBotCollisionFast(position, radius) {
            collisionSamples.push({
                x: position.x,
                y: position.y,
                z: position.z,
                radius,
            });
            return wall && Math.abs(position.x) < 0.1 && position.z <= -5.5;
        },
    };
    const entityManager = Object.create(EntityManager.prototype);
    const runtimeContext = {
        mode: 'ARCADE',
        arena,
        trailSpatialIndex,
        entityManager,
        players,
        projectiles: [],
    };
    return { player, arena, collisionSamples, runtimeContext };
}

for (const hazard of ['wall', 'trail']) {
    test(`predictive safety samples a real ${hazard} hazard and steers into the clearer lane`, () => {
        const { player, collisionSamples, runtimeContext } = createScene({
            wall: hazard === 'wall',
            trail: hazard === 'trail',
        });
        const policy = new HeuristicBotPolicy({ profile: 'defensive', difficulty: 'HARD' });
        const state = policy._safetyState;
        const input = {};
        const observation = safeObservation();

        applyHeuristicSafetyArbiter(policy, input, 1 / 60, player, runtimeContext, observation);

        if (hazard === 'wall') {
            assert.ok(state.frontArenaClearance < 1, 'the forward samples encounter the arena callback');
            assert.equal(state.reason, 'wall-ahead');
            assert.ok(collisionSamples.length > 0);
            assert.ok(collisionSamples.every((sample) => sample.radius === player.hitboxRadius * 2),
                'the consumer passes its hitbox-scaled probe radius to checkBotCollisionFast');
        } else {
            assert.ok(state.frontTrailClearance < 1, 'the forward samples query the rival trail index');
            assert.equal(state.reason, 'trail-ahead');
        }
        assert.equal(state.state, 'evade');
        assert.ok(input.yawLeft || input.yawRight || input.pitchUp || input.pitchDown,
            'the safety arbiter selects a steering direction');
        const selectedClearance = input.yawLeft ? state.leftClearance
            : input.yawRight ? state.rightClearance
                : input.pitchUp ? state.upClearance
                    : state.downClearance;
        assert.ok(selectedClearance > state.frontClearance,
            'the selected escape lane is clearer than the blocked forward path');
    });
}
