import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ClassicBridgePolicy,
    resolveClassicBridgeAction,
} from '../src/entities/ai/ClassicBridgePolicy.js';
import * as ObservationSchemaV1 from '../src/entities/ai/observation/ObservationSchemaV1.js';

// Moved from tests/physics-policy.spec.js (P3): both tests feed a hand-built bot
// and a hand-built runtime context into the policy, so no match is required.

const schema = ObservationSchemaV1;

test('T75: ClassicBridgePolicy leitet Kern-Action aus Observation-Vektor ab', () => {
    const bot = {
        index: 0,
        inventory: ['SHIELD'],
        selectedItemIndex: 0,
    };
    const context = {
        players: [],
        projectiles: [],
        observation: null,
    };
    context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    context.observation[schema.WALL_DISTANCE_FRONT] = 0.18;
    context.observation[schema.WALL_DISTANCE_LEFT] = 0.14;
    context.observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    context.observation[schema.TARGET_DISTANCE_RATIO] = 0.2;
    context.observation[schema.TARGET_ALIGNMENT] = 0.94;
    context.observation[schema.TARGET_IN_FRONT] = 1;
    context.observation[schema.PRESSURE_LEVEL] = 0.84;
    context.observation[schema.PROJECTILE_THREAT] = 1;
    context.observation[schema.LOCAL_OPENNESS_RATIO] = 0.7;
    context.observation[schema.INVENTORY_COUNT_RATIO] = 0.1;
    context.observation[schema.SELECTED_ITEM_SLOT] = 0;

    const policy = new ClassicBridgePolicy({
        fallbackPolicy: {
            type: 'rule-based',
            update() {
                return { yawRight: true, boost: true };
            },
        },
    });
    const action = policy.update(1 / 60, bot, context);

    const result = {
        error: null,
        type: policy.type,
        yawRight: !!action?.yawRight,
        shootMG: !!action?.shootMG,
        shootItem: !!action?.shootItem,
        shootItemIndex: Number(action?.shootItemIndex),
        boost: !!action?.boost,
    };

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.type, 'classic-bridge');
    assert.ok(result.yawRight);
    assert.ok(result.shootMG);
    assert.ok(result.shootItem);
    assert.strictEqual(result.shootItemIndex, 0);
    assert.ok(result.boost);
});

test('T76: ClassicBridgePolicy routed Action-Failures kontrolliert auf RuleBased-Fallback', () => {
    const bot = {
        index: 0,
        inventory: [],
        selectedItemIndex: 0,
    };
    const context = {
        players: [],
        projectiles: [],
        observation: null,
    };
    context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    context.observation[schema.WALL_DISTANCE_FRONT] = 0.65;

    const policy = new ClassicBridgePolicy({
        resolveAction: () => {
            throw new Error('simulated-classic-bridge-action-failure');
        },
    });

    const fallbackType = policy._fallbackPolicy?.type;
    const originalFallbackUpdate = policy._fallbackPolicy?.update;
    let fallbackCalled = false;
    let action = null;
    try {
        policy._fallbackPolicy.update = function fallbackUpdate() {
            fallbackCalled = true;
            return { yawLeft: true };
        };
        action = policy.update(1 / 60, bot, context);
    } finally {
        policy._fallbackPolicy.update = originalFallbackUpdate;
    }

    const result = {
        error: null,
        fallbackType,
        fallbackCalled,
        yawLeft: !!action?.yawLeft,
    };

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.fallbackType, 'rule-based');
    assert.ok(result.fallbackCalled);
    assert.ok(result.yawLeft);
});

test('T77: ClassicBridgePolicy leaves movement to its trail-aware fallback on dense maps', () => {
    const observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    observation[schema.WALL_DISTANCE_FRONT] = 0.12;
    observation[schema.WALL_DISTANCE_LEFT] = 0.1;
    observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    observation[schema.TARGET_DISTANCE_RATIO] = 0.9;
    observation[schema.TARGET_ALIGNMENT] = 1;
    observation[schema.TARGET_IN_FRONT] = 1;
    observation[schema.LOCAL_OPENNESS_RATIO] = 1;

    for (const mapKey of ['core_fusion', 'eiffel_tower_arena', 'standard']) {
        const action = resolveClassicBridgeAction({
            observation,
            arena: { currentMapKey: mapKey },
        });

        assert.equal(action.yawLeft, undefined, mapKey);
        assert.equal(action.yawRight, undefined, mapKey);
        assert.equal(action.pitchUp, undefined, mapKey);
        assert.equal(action.pitchDown, undefined, mapKey);
        assert.equal(action.boost, undefined, mapKey);
    }
});

test('T78: ClassicBridgePolicy preserves legacy movement on reference maps', () => {
    const observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    observation[schema.WALL_DISTANCE_FRONT] = 0.12;
    observation[schema.WALL_DISTANCE_LEFT] = 0.1;
    observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    observation[schema.TARGET_DISTANCE_RATIO] = 0.9;
    observation[schema.LOCAL_OPENNESS_RATIO] = 1;

    for (const mapKey of ['maze', 'complex']) {
        const action = resolveClassicBridgeAction({
            observation,
            arena: { currentMapKey: mapKey },
        });

        assert.equal(action.yawRight, true, mapKey);
        assert.equal(action.yawLeft, false, mapKey);
        assert.equal(action.boost, false, `${mapKey}: an imminent wall still blocks boost`);
    }
});

test('Classic 2D solo steering uses the trail-aware fallback with a longer probe range', () => {
    const player = { index: 0, alive: true, inventory: [] };
    const observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    observation[schema.PLANAR_MODE_ACTIVE] = 1;
    observation[schema.WALL_DISTANCE_FRONT] = 0.12;
    observation[schema.WALL_DISTANCE_LEFT] = 0.1;
    observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    const fallbackPolicy = {
        _botAI: { profile: { lookAhead: 13 } },
        update() {
            assert.equal(this._botAI.profile.lookAhead, 32);
            return { yawLeft: true };
        },
    };
    const policy = new ClassicBridgePolicy({ fallbackPolicy });
    const context = {
        mode: 'CLASSIC', rules: { planarMode: true }, arena: { currentMapKey: 'standard' },
        navigationPlayers: [player, { alive: false }], players: [player], projectiles: [], observation,
    };

    const action = policy.update(1 / 60, player, context);

    assert.equal(action.yawLeft, true);
    assert.equal(action.yawRight, false);
    assert.equal(action.boost, false);
    assert.equal(fallbackPolicy._botAI.profile.lookAhead, 13);
});

test('Classic bridge keeps local steering on maps without fallback delegation', () => {
    const player = { index: 0, alive: true, inventory: [] };
    const opponent = { index: 1, alive: true };
    const observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    observation[schema.PLANAR_MODE_ACTIVE] = 1;
    observation[schema.WALL_DISTANCE_FRONT] = 0.12;
    observation[schema.WALL_DISTANCE_LEFT] = 0.1;
    observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    const context = {
        mode: 'CLASSIC', arena: { currentMapKey: 'maze' },
        navigationPlayers: [player, opponent], observation,
    };

    assert.equal(resolveClassicBridgeAction(context, { player }).yawRight, true);
    opponent.alive = false;
    observation[schema.PLANAR_MODE_ACTIVE] = 0;
    assert.equal(resolveClassicBridgeAction(context, { player }).yawRight, true);
    observation[schema.PLANAR_MODE_ACTIVE] = 1;
    context.mode = 'HUNT';
    assert.equal(resolveClassicBridgeAction(context, { player }).yawRight, true);
});

test('Classic standard map keeps bridge combat while fallback steers away from trails', () => {
    const observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
    observation[schema.WALL_DISTANCE_FRONT] = 0.12;
    observation[schema.WALL_DISTANCE_LEFT] = 0.1;
    observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
    observation[schema.TARGET_IN_FRONT] = 1;
    observation[schema.TARGET_ALIGNMENT] = 1;
    observation[schema.TARGET_DISTANCE_RATIO] = 0.1;
    const policy = new ClassicBridgePolicy({
        autoLoadCheckpoint: false,
        fallbackPolicy: { type: 'rule-based', update: () => ({ yawLeft: true }) },
    });

    const action = policy.update(1 / 60, { inventory: [] }, {
        arena: { currentMapKey: 'standard' }, players: [], projectiles: [], observation,
    });

    assert.equal(action.yawLeft, true);
    assert.equal(action.yawRight, false);
    assert.equal(action.shootMG, true);
});
