import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import {
    resolveBoostPressureCeiling,
} from '../src/entities/ai/HeuristicBotSafetyOps.js';
import {
    HEURISTIC_PROFILES,
    resolveStableStrafeRight,
} from '../src/entities/ai/HeuristicBotPolicyOps.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

function createPlayer(index = 1, isBot = true) {
    return {
        index,
        isBot,
        alive: true,
        position: new THREE.Vector3(),
        speed: 18,
        baseSpeed: 18,
        hitboxRadius: 0.8,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        inventory: [],
        selectedItemIndex: 0,
        getDirection(out) {
            return out.set(0, 0, -1);
        },
    };
}

function createSafeObservation() {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[WALL_DISTANCE_FRONT] = 1;
    observation[WALL_DISTANCE_LEFT] = 1;
    observation[WALL_DISTANCE_RIGHT] = 1;
    observation[WALL_DISTANCE_UP] = 1;
    observation[WALL_DISTANCE_DOWN] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 1;
    observation[TARGET_DISTANCE_RATIO] = 0.35;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0.2;
    observation[PROJECTILE_THREAT] = 0;
    return observation;
}

test('difficulty aliases select distinct heuristic profiles and preserve strafe diversity', () => {
    const easy = new HeuristicBotPolicy({ difficulty: 'EASY' });
    const hard = new HeuristicBotPolicy({ difficulty: 'HARD' });
    assert.equal(easy.profileName, 'defensive');
    assert.equal(hard.profileName, 'aggressive');
    easy.setDifficulty('HARD');
    assert.equal(easy.profileName, 'aggressive');
    assert.notEqual(resolveStableStrafeRight({ index: 1 }), resolveStableStrafeRight({ index: 2 }));
    assert.ok(
        resolveBoostPressureCeiling(0.64, HEURISTIC_PROFILES.aggressive)
        > resolveBoostPressureCeiling(0.64, HEURISTIC_PROFILES.defensive)
    );
});

test('runtime context exposes Arcade semantics while retaining the internal CLASSIC session', () => {
    const player = createPlayer();
    const entityManager = {
        activeGameMode: 'CLASSIC',
        huntEnabled: false,
        botDifficulty: 'HARD',
        players: [player],
        projectiles: [],
        runtimeConfig: {
            session: { activeGameMode: 'CLASSIC' },
            arcade: { enabled: true, seed: 7 },
            bot: { activeDifficulty: 'HARD' },
            gameplay: { planarMode: false },
        },
        getTrailSpatialIndex: () => null,
    };

    const context = createBotRuntimeContext(entityManager, player, 1 / 60, {
        includeObservationContext: false,
    });
    assert.equal(context.mode, 'ARCADE');
    assert.equal(context.runtimeConfig.session.activeGameMode, 'CLASSIC');
    assert.equal(context.difficulty, 'HARD');
    assert.equal(context.entityManager, entityManager);
});

test('final safety arbiter vetoes Hunt combat and boost when a trail blocks the look-ahead', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -30);
    player.inventory = ['ROCKET_HEAVY'];
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        arena: {},
        trailSpatialIndex: {
            checkGlobalCollision: () => ({ hit: true }),
        },
        rules: { huntEnabled: true },
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });
    const snapshot = policy.getDecisionSnapshot();

    assert.equal(action.boost, false);
    assert.equal(action.shootMG, false);
    assert.equal(action.shootItem, false);
    assert.equal(snapshot.safetyState, 'evade');
    assert.equal(snapshot.safetyReason, 'trail-ahead');
    assert.ok(snapshot.frontClearance < 1);
});

test('predictive trail probes avoid current-position OBB refinement', () => {
    const player = createPlayer(1);
    let receivedPlayerRef = 'not-called';
    const policy = new HeuristicBotPolicy();
    policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        arena: {},
        trailSpatialIndex: {
            checkGlobalCollision(_position, _radius, _playerIndex, _skipRecent, playerRef) {
                receivedPlayerRef = playerRef;
                return null;
            },
        },
        observation: createSafeObservation(),
    });
    assert.equal(receivedPlayerRef, null);
});

test('projectile pressure vetoes boost even when both side paths are cramped', () => {
    const player = createPlayer(1);
    const observation = createSafeObservation();
    observation[PROJECTILE_THREAT] = 1;
    observation[WALL_DISTANCE_LEFT] = 0.2;
    observation[WALL_DISTANCE_RIGHT] = 0.2;
    const policy = new HeuristicBotPolicy();
    const action = policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        arena: {},
        trailSpatialIndex: null,
        observation,
    });
    assert.equal(action.boost, false);
    assert.equal(policy.getDecisionSnapshot().safetyState, 'evade');
    assert.equal(policy.getDecisionSnapshot().safetyReason, 'projectile');
});

test('Hunt decisions use the selected target distance and keep rockets out of the near blast window', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -12);
    player.inventory = ['ROCKET_HEAVY'];
    const observation = createSafeObservation();
    observation[TARGET_DISTANCE_RATIO] = 0.95;
    const policy = new HeuristicBotPolicy();
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        arena: {},
        trailSpatialIndex: null,
        huntTarget: { playerIndex: enemy.index, distance: 12 },
        rules: { huntEnabled: true },
        observation,
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(policy.getDecisionSnapshot().targetDistanceRatio, 0.1);
    assert.equal(action.shootItem, false);
});

test('trail bounces enter bounded recovery and reset clears safety state', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy();
    policy.onBounce('TRAIL', new THREE.Vector3(1, 0, 0));
    policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        arena: {},
        trailSpatialIndex: null,
        observation: createSafeObservation(),
    });
    assert.equal(policy.getDecisionSnapshot().safetyState, 'recover');
    assert.equal(policy.getDecisionSnapshot().safetyReason, 'trail-bounce');

    policy.reset();
    assert.equal(policy._safetyState.state, 'normal');
    assert.equal(policy._safetyState.reason, '');
});
