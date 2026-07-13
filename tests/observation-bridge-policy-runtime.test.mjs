import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { resolveBotPolicyType } from '../src/core/RuntimeConfig.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { ObservationBridgePolicy } from '../src/entities/ai/ObservationBridgePolicy.js';
import { BotPolicyRegistry } from '../src/entities/ai/BotPolicyRegistry.js';
import {
    BOT_POLICY_TYPES,
    normalizeBotPolicyType,
} from '../src/entities/ai/BotPolicyTypes.js';
import {
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    MODE_ID,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

test('ObservationBridgePolicy skips latest checkpoint auto-load in desktop app runtime', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];

    globalThis.fetch = async (input) => {
        fetchCalls.push(String(input?.url || input));
        return { ok: false };
    };

    try {
        new ObservationBridgePolicy({
            type: 'classic-bridge',
            trainerBridgeEnabled: false,
            isDesktopRuntime: () => false,
            fallbackPolicy: {
                update() {
                    return { yawRight: true };
                },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(fetchCalls, ['/api/bot/latest-checkpoint']);

        fetchCalls.length = 0;
        const desktopPolicy = new ObservationBridgePolicy({
            type: 'classic-bridge',
            trainerBridgeEnabled: false,
            isDesktopRuntime: () => true,
            fallbackPolicy: {
                update() {
                    return { yawLeft: true };
                },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const action = desktopPolicy.update(1 / 60, { index: 0, inventory: [] }, {
            mode: 'classic',
            dt: 1 / 60,
            players: [],
            projectiles: [],
            observation: new Array(40).fill(0),
        });

        assert.deepEqual(fetchCalls, []);
        assert.equal(action?.yawLeft, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('HeuristicBotPolicy is selectable as a pure local policy type', () => {
    assert.equal(normalizeBotPolicyType('pure-heuristic'), BOT_POLICY_TYPES.HEURISTIC);
    assert.equal(resolveBotPolicyType('heuristic', 'CLASSIC'), BOT_POLICY_TYPES.HEURISTIC);

    const policy = new BotPolicyRegistry().create('heuristic');
    assert.ok(policy instanceof HeuristicBotPolicy);
    assert.equal(policy.usesRuntimeContext, true);
    assert.equal(policy.requiresObservation, true);
});

test('HeuristicBotPolicy avoids obstacles and uses classic items without MG', () => {
    const observation = new Array(40).fill(0);
    observation[WALL_DISTANCE_FRONT] = 0.12;
    observation[WALL_DISTANCE_LEFT] = 0.22;
    observation[WALL_DISTANCE_RIGHT] = 0.76;
    observation[LOCAL_OPENNESS_RATIO] = 0.7;
    observation[PRESSURE_LEVEL] = 0.3;
    observation[PROJECTILE_THREAT] = 0;
    observation[TARGET_DISTANCE_RATIO] = 0.24;
    observation[TARGET_ALIGNMENT] = 0.88;
    observation[TARGET_IN_FRONT] = 1;
    observation[INVENTORY_COUNT_RATIO] = 0.1;
    observation[PLANAR_MODE_ACTIVE] = 1;
    observation[MODE_ID] = 0;

    const policy = new HeuristicBotPolicy();
    const action = policy.update(1 / 60, {
        alive: true,
        inventory: ['SLOW_TIME'],
        selectedItemIndex: 0,
        gameplayConfig: { GAMEPLAY: { PLANAR_MODE: true } },
    }, {
        mode: 'CLASSIC',
        observation,
        players: [],
        projectiles: [],
        rules: { huntEnabled: false },
    });

    assert.equal(action.yawRight, true);
    assert.equal(action.yawLeft, false);
    assert.equal(action.boost, false);
    assert.equal(action.shootMG, false);
    assert.equal(action.shootItem, false);
    assert.equal(action.shootItemIndex, -1);
    assert.equal(action.useItem, 0);
});

function createHeuristicPlayer(overrides = {}) {
    const direction = overrides.direction || new THREE.Vector3(0, 0, 1);
    return {
        alive: true,
        index: 1,
        position: new THREE.Vector3(0, 0, 0),
        inventory: [],
        selectedItemIndex: 0,
        hp: 100,
        maxHp: 100,
        shieldHP: 30,
        maxShieldHp: 100,
        gameplayConfig: { GAMEPLAY: { PLANAR_MODE: false } },
        getDirection(out) {
            out.copy(direction);
            return out;
        },
        ...overrides,
    };
}

function createHeuristicObservation(overrides = {}) {
    const observation = new Array(40).fill(0);
    observation[WALL_DISTANCE_FRONT] = 0.9;
    observation[WALL_DISTANCE_LEFT] = 0.8;
    observation[WALL_DISTANCE_RIGHT] = 0.8;
    observation[LOCAL_OPENNESS_RATIO] = 0.9;
    observation[PRESSURE_LEVEL] = 0.2;
    observation[PROJECTILE_THREAT] = 0;
    observation[TARGET_DISTANCE_RATIO] = 0.42;
    observation[TARGET_ALIGNMENT] = 0.9;
    observation[TARGET_IN_FRONT] = 1;
    observation[INVENTORY_COUNT_RATIO] = 0;
    observation[PLANAR_MODE_ACTIVE] = 0;
    observation[MODE_ID] = 0;
    for (const [index, value] of Object.entries(overrides)) {
        observation[Number(index)] = value;
    }
    return observation;
}

test('HeuristicBotPolicy keeps classic MG-free even with combat inventory', () => {
    const policy = new HeuristicBotPolicy();
    const observation = createHeuristicObservation({
        [INVENTORY_COUNT_RATIO]: 0.2,
        [TARGET_DISTANCE_RATIO]: 0.2,
    });
    const action = policy.update(1 / 60, createHeuristicPlayer({
        inventory: ['ROCKET_MEGA', 'SLOW_DOWN'],
    }), {
        mode: 'CLASSIC',
        observation,
        players: [],
        rules: { huntEnabled: false },
    });

    assert.equal(action.shootMG, false);
    assert.equal(policy.getDecisionSnapshot().mode, 'CLASSIC');
});

test('HeuristicBotPolicy enables MG and rockets in fight mode with a target corridor', () => {
    const policy = new HeuristicBotPolicy({ profile: 'aggressive' });
    const player = createHeuristicPlayer({
        inventory: ['ROCKET_HEAVY'],
        shieldHP: 70,
    });
    const enemy = createHeuristicPlayer({
        index: 2,
        position: new THREE.Vector3(0, 0, 34),
        hp: 80,
        shieldHP: 20,
    });
    const observation = createHeuristicObservation({
        [MODE_ID]: 1,
        [INVENTORY_COUNT_RATIO]: 0.1,
        [TARGET_DISTANCE_RATIO]: 0.36,
        [TARGET_ALIGNMENT]: 0.95,
        [TARGET_IN_FRONT]: 1,
    });

    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        observation,
        players: [player, enemy],
        rules: { huntEnabled: true },
    });

    assert.equal(action.shootMG, true);
    assert.equal(action.shootItem, true);
    assert.equal(action.shootItemIndex, 0);
    assert.equal(policy.getDecisionSnapshot().mode, 'HUNT');
});

test('HeuristicBotPolicy steers arcade bots toward the next checkpoint target', () => {
    const policy = new HeuristicBotPolicy();
    const player = createHeuristicPlayer();
    const observation = createHeuristicObservation({
        [WALL_DISTANCE_FRONT]: 0.92,
        [LOCAL_OPENNESS_RATIO]: 0.86,
        [PRESSURE_LEVEL]: 0.1,
    });

    const action = policy.update(1 / 60, player, {
        mode: 'ARCADE',
        observation,
        routeSnapshot: {
            enabled: true,
            totalCheckpoints: 2,
            checkpoints: [
                { id: 'cp-1', routeIndex: 0, pos: [20, 0, 0] },
                { id: 'cp-2', routeIndex: 1, pos: [40, 0, 0] },
            ],
            finish: { id: 'finish', pos: [60, 0, 0] },
        },
        progressSnapshot: {
            nextCheckpointIndex: 0,
        },
        rules: { huntEnabled: false },
    });

    assert.equal(action.yawLeft, true);
    assert.equal(action.yawRight, false);
    assert.equal(action.shootMG, false);
    assert.equal(policy.getDecisionSnapshot().intent, 'parcours-target');
});

test('HeuristicBotPolicy profiles alter retreat thresholds predictably', () => {
    const defensive = new HeuristicBotPolicy({ profile: 'defensive' });
    const aggressive = new HeuristicBotPolicy({ profile: 'aggressive' });
    const enemy = createHeuristicPlayer({
        index: 2,
        position: new THREE.Vector3(0, 0, 32),
    });
    const observation = createHeuristicObservation({
        [MODE_ID]: 1,
        [TARGET_DISTANCE_RATIO]: 0.34,
        [PRESSURE_LEVEL]: 0.24,
    });
    const player = createHeuristicPlayer({
        hp: 34,
        shieldHP: 20,
    });
    const context = {
        mode: 'HUNT',
        observation,
        players: [player, enemy],
        rules: { huntEnabled: true },
    };

    defensive.update(1 / 60, player, context);
    aggressive.update(1 / 60, player, context);

    assert.equal(defensive.getDecisionSnapshot().profile, 'defensive');
    assert.equal(defensive.getDecisionSnapshot().intent, 'retreat');
    assert.equal(defensive.getDecisionSnapshot().retreatReason, 'low-vitality');
    assert.equal(aggressive.getDecisionSnapshot().profile, 'aggressive');
    assert.notEqual(aggressive.getDecisionSnapshot().intent, 'retreat');
});
