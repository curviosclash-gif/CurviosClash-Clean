import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { applyDecisionToInput } from '../src/entities/ai/BotActionOps.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { buildObservation } from '../src/entities/ai/observation/ObservationSystem.js';
import {
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

function createInput() {
    return {
        pitchUp: false,
        pitchDown: false,
        yawLeft: false,
        yawRight: false,
        rollLeft: false,
        rollRight: false,
        boost: false,
        cameraSwitch: false,
        dropItem: false,
        shootItem: false,
        shootMG: false,
        shootItemIndex: -1,
        nextItem: false,
        useItem: -1,
    };
}

function createPlayer() {
    return {
        index: 0,
        alive: true,
        position: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        speed: 35,
        baseSpeed: 35,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hitboxRadius: 0.8,
        inventory: [],
        selectedItemIndex: 0,
        getDirection(out) {
            return out.set(0, 0, -1).applyQuaternion(this.quaternion);
        },
    };
}

test('heuristic observation reports semantic left and right wall clearance', () => {
    const player = createPlayer();
    const arena = {
        checkCollision(position) {
            return position.x > 0.5;
        },
    };

    const observation = buildObservation(player, {
        arena,
        players: [player],
        wallProbeDistance: 12,
        wallProbeMinSteps: 6,
        wallProbeMaxSteps: 6,
        wallProbeCacheWindowMs: 0,
    });

    assert.ok(
        observation[WALL_DISTANCE_LEFT] > observation[WALL_DISTANCE_RIGHT],
        `expected left clearance greater than right clearance, got left=${observation[WALL_DISTANCE_LEFT]} right=${observation[WALL_DISTANCE_RIGHT]}`
    );
});

test('heuristic bot steers away from a blocked right side', () => {
    const player = createPlayer();
    const policy = new HeuristicBotPolicy();
    const observation = new Array(40).fill(0);
    observation[WALL_DISTANCE_LEFT] = 1;
    observation[WALL_DISTANCE_RIGHT] = 0.1;

    const input = policy.update(1 / 60, player, {
        observation,
        mode: 'CLASSIC',
        players: [player],
    });

    assert.equal(input.yawLeft, true);
    assert.equal(input.yawRight, false);
});

test('rule-based bot yaw follows the same left-positive steering contract', () => {
    const bot = {
        currentInput: createInput(),
        _decision: {
            yaw: 1,
            pitch: 0,
            boost: false,
            useItem: -1,
            shootItem: false,
            shootItemIndex: -1,
        },
        _resetInput(input) {
            Object.assign(input, createInput());
        },
    };

    const input = applyDecisionToInput(bot);

    assert.equal(input.yawLeft, true);
    assert.equal(input.yawRight, false);
});
