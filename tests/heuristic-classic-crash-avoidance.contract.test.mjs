import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { HEURISTIC_PROFILES } from '../src/entities/ai/HeuristicBotPolicyOps.js';
import { applySteeringTowardPosition } from '../src/hunt/HuntBotPolicy.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

/**
 * Stands in for a Classic vehicle right after a spawn: it flies straight along `forward`
 * at full speed, and `velocity` is what PlayerMotionOps publishes (direction * speed).
 * Two of these facing each other is the situation the measurement showed: after a
 * spawn the two nearest bots pick each other as target and fly head-on, and in Classic
 * a vehicle crash kills both.
 */
function createVehicle(index, position, forward, speed = 30) {
    const direction = new THREE.Vector3(...forward).normalize();
    return {
        index,
        isBot: true,
        alive: true,
        position: new THREE.Vector3(...position),
        velocity: direction.clone().multiplyScalar(speed),
        speed,
        baseSpeed: speed,
        hitboxRadius: 0.8,
        inventory: [],
        selectedItemIndex: 0,
        getDirection(out) {
            return out.copy(direction);
        },
    };
}

// Open space everywhere: no wall, no trail and no pressure may explain a turn.
function createOpenObservation() {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[WALL_DISTANCE_FRONT] = 1;
    observation[WALL_DISTANCE_LEFT] = 1;
    observation[WALL_DISTANCE_RIGHT] = 1;
    observation[WALL_DISTANCE_UP] = 1;
    observation[WALL_DISTANCE_DOWN] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 1;
    observation[TARGET_DISTANCE_RATIO] = 0.35;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0.1;
    return observation;
}

function runClassicUpdate(policy, player, players) {
    return policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players,
        projectiles: [],
        arena: {},
        observation: createOpenObservation(),
    });
}

test('a ghost on a collision course is no crash threat, because ghosts never collide', async () => {
    const { findVehicleCollisionCourse } = await import('../src/entities/ai/HeuristicTrafficAvoidanceOps.js');
    const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
    const ghost = { ...createVehicle(2, [0, 0, -40], [0, 0, 1]), isGhost: true };
    assert.equal(findVehicleCollisionCourse(player, [player, ghost]), null,
        'a ghost replay cannot crash into the bot, so it must not make the bot swerve');
});

test('outside Classic the tactic does not swerve for an oncoming vehicle, because a crash there only costs health', async () => {
    const { applyHeuristicClassicBehavior } = await import('../src/entities/ai/HeuristicClassicTacticsOps.js');
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL' });
    const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
    const oncoming = createVehicle(2, [0, 0, -40], [0, 0, 1]);
    const input = {};
    const decision = applyHeuristicClassicBehavior(policy, input, 1 / 60, player, {
        mode: 'ARCADE', players: [player, oncoming], projectiles: [], arena: {},
    }, createOpenObservation());
    assert.equal(decision.crashThreat, null, 'Arcade crashes only cost health, so no crash threat may be reported');
    assert.notEqual(decision.intent, 'traffic-avoid');
});

function yawSign(input) {
    if (input.yawLeft && !input.yawRight) return 1;
    if (input.yawRight && !input.yawLeft) return -1;
    return 0;
}

for (const difficulty of ['EASY', 'NORMAL', 'HARD']) {
    test(`Classic ${difficulty} bot turns away from an oncoming vehicle instead of meeting it head-on`, () => {
        const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
        const oncoming = createVehicle(2, [3, 0, -40], [0, 0, 1]);
        const policy = new HeuristicBotPolicy({ difficulty, profile: 'balanced' });

        const action = runClassicUpdate(policy, player, [player, oncoming]);

        const towardOncoming = {};
        applySteeringTowardPosition(policy, towardOncoming, player, oncoming.position);
        assert.notEqual(yawSign(towardOncoming), 0, 'the oncoming vehicle sits off to one side');
        assert.equal(
            yawSign(action),
            -yawSign(towardOncoming),
            'a Classic crash kills both vehicles, so the bot must turn away from the oncoming one',
        );
        assert.equal(action.boost, false, 'the bot does not boost into a closing vehicle');
    });
}

test('Classic crash avoidance does not depend on the Hunt traffic tuning bias', () => {
    assert.equal(HEURISTIC_PROFILES.balanced.trafficAvoidanceBias, 0.5, 'neutral bias keeps Hunt traffic avoidance off');
    const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
    const oncoming = createVehicle(2, [-3, 0, -40], [0, 0, 1]);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });

    const action = runClassicUpdate(policy, player, [player, oncoming]);

    const towardOncoming = {};
    applySteeringTowardPosition(policy, towardOncoming, player, oncoming.position);
    assert.equal(yawSign(action), -yawSign(towardOncoming), 'the aggressive profile avoids the crash as well');
});

test('Classic safety evade picks the side away from an oncoming vehicle when both sides are open', () => {
    // Wall straight ahead with both sides equally open: the safety arbiter takes over and,
    // without a vehicle in view, settles the tie by the player index (odd index: right).
    // The oncoming vehicle sits on exactly that side, so the tie-break would turn into it.
    const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
    const oncoming = createVehicle(2, [3, 0, -40], [0, 0, 1]);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const observation = createOpenObservation();
    observation[WALL_DISTANCE_FRONT] = 0.1;

    const action = policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player, oncoming],
        projectiles: [],
        arena: {},
        observation,
    });

    assert.equal(policy.getDecisionSnapshot().safetyState, 'evade', 'the wall ahead hands control to the safety arbiter');
    const towardOncoming = {};
    applySteeringTowardPosition(policy, towardOncoming, player, oncoming.position);
    assert.equal(
        yawSign(action),
        -yawSign(towardOncoming),
        'the evade turn must not swing into the vehicle the bot is about to crash into',
    );
});

test('Classic bot still hunts a target whose flight path does not cross its own', () => {
    const player = createVehicle(1, [0, 0, 0], [0, 0, -1]);
    // Flies away, parallel and well to the side: no collision course, the normal intercept stays.
    const target = createVehicle(2, [-20, 0, -36], [0, 0, -1]);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });

    const action = runClassicUpdate(policy, player, [player, target]);

    assert.equal(policy.getDecisionSnapshot().intent, 'intercept');
    const towardTarget = {};
    applySteeringTowardPosition(policy, towardTarget, player, target.position);
    assert.equal(yawSign(action), yawSign(towardTarget), 'the bot keeps steering toward its target');
});
