import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { sanitizeBotAction } from '../src/entities/ai/actions/BotActionContract.js';
import {
    applyHeuristicSafetyArbiter,
    resolveBoostPressureCeiling,
} from '../src/entities/ai/HeuristicBotSafetyOps.js';
import {
    HEURISTIC_DIFFICULTIES,
    HEURISTIC_PROFILES,
    resolveStableStrafeRight,
} from '../src/entities/ai/HeuristicBotPolicyOps.js';
import { applySteeringTowardPosition } from '../src/hunt/HuntBotPolicy.js';
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

test('difficulty and personality are independent and preserve strafe diversity', () => {
    const easy = new HeuristicBotPolicy({ difficulty: 'EASY', profile: 'aggressive' });
    const hard = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'defensive' });
    assert.equal(easy.profileName, 'aggressive');
    assert.equal(easy.difficultyName, 'easy');
    assert.equal(hard.profileName, 'defensive');
    assert.equal(hard.difficultyName, 'hard');
    easy.setDifficulty('HARD');
    assert.equal(easy.profileName, 'aggressive');
    assert.equal(easy.difficultyName, 'hard');
    assert.notEqual(resolveStableStrafeRight({ index: 1 }), resolveStableStrafeRight({ index: 2 }));
    assert.ok(
        resolveBoostPressureCeiling(0.64, HEURISTIC_PROFILES.aggressive)
        > resolveBoostPressureCeiling(0.64, HEURISTIC_PROFILES.defensive)
    );
    assert.ok(HEURISTIC_PROFILES.aggressive.attackWindow > HEURISTIC_PROFILES.defensive.attackWindow);
    assert.ok(HEURISTIC_DIFFICULTIES.hard.attackWindowScale > HEURISTIC_DIFFICULTIES.easy.attackWindowScale);
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

test('endless bots retain their own difficulty across repeated runtime context updates', () => {
    const easyBot = Object.assign(createPlayer(1), { endlessDifficulty: 'EASY' });
    const hardBot = Object.assign(createPlayer(2), { endlessDifficulty: 'HARD' });
    const entityManager = {
        activeGameMode: 'CLASSIC',
        huntEnabled: true,
        botDifficulty: 'NORMAL',
        players: [easyBot, hardBot],
        projectiles: [],
        runtimeConfig: {
            session: { activeGameMode: 'CLASSIC' },
            arcade: { enabled: true, seed: 17 },
            bot: { activeDifficulty: 'NORMAL' },
            gameplay: { planarMode: false },
        },
        getTrailSpatialIndex: () => null,
    };

    for (const dt of [1 / 60, 1 / 30, 1 / 120]) {
        assert.equal(createBotRuntimeContext(entityManager, easyBot, dt).difficulty, 'EASY');
        assert.equal(createBotRuntimeContext(entityManager, hardBot, dt).difficulty, 'HARD');
    }
});

test('3D target steering pitches toward targets above and below the bot', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy();
    const input = {};

    applySteeringTowardPosition(policy, input, player, new THREE.Vector3(0, 20, -20));
    assert.equal(input.pitchUp, true);
    assert.equal(input.pitchDown, false);

    input.pitchUp = false;
    input.pitchDown = false;
    applySteeringTowardPosition(policy, input, player, new THREE.Vector3(0, -20, -20));
    assert.equal(input.pitchUp, false);
    assert.equal(input.pitchDown, true);
});

test('bot action sanitization preserves bounded analog steering axes', () => {
    const action = sanitizeBotAction({ yawAxis: -0.25, pitchAxis: 2 });
    assert.equal(action.yawAxis, -0.25);
    assert.equal(action.pitchAxis, 1);
    assert.equal(action.rollAxis, undefined);
});

test('final safety arbiter vetoes Hunt combat and boost at the first trail sample for every profile', () => {
    for (const profile of Object.keys(HEURISTIC_PROFILES)) {
        const player = createPlayer(1);
        const enemy = createPlayer(2, false);
        enemy.position.set(0, 0, -30);
        player.inventory = ['ROCKET_HEAVY'];
        const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile });
        policy._huntState.movementIntent = 'strafe';
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

        assert.equal(action.boost, false, profile);
        assert.equal(action.shootMG, false, profile);
        assert.equal(action.shootItem, false, profile);
        assert.equal(player.fightTargetLockRemaining, 0, profile);
        assert.equal(policy._huntState.commitTimer, 0, profile);
        assert.equal(snapshot.safetyState, 'evade', profile);
        assert.equal(snapshot.safetyReason, 'trail-ahead', profile);
        assert.equal(snapshot.frontClearance, 0, profile);
    }
});

test('predictive trail probes match the runtime collision radius and self-trail grace', () => {
    const player = createPlayer(1);
    const calls = [];
    const policy = new HeuristicBotPolicy();
    policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        arena: {},
        entityManager: {
            constructor: {
                deriveSelfTrailSkipRecentSegments: () => 7,
            },
        },
        trailSpatialIndex: {
            checkGlobalCollision(_position, radius, _playerIndex, skipRecent, playerRef) {
                calls.push({ radius, skipRecent, playerRef });
                return null;
            },
        },
        observation: createSafeObservation(),
    });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((call) => call.radius === player.hitboxRadius * 2));
    assert.ok(calls.every((call) => call.skipRecent === 7));
    assert.ok(calls.every((call) => call.playerRef === null));
});

test('predictive safety tuning sees a distant trail while neutral probing remains unchanged', () => {
    const createContext = () => ({
        mode: 'CLASSIC',
        players: [],
        arena: {},
        trailSpatialIndex: {
            checkGlobalCollision(position) {
                return position.z <= -5 ? { hit: true } : null;
            },
        },
        observation: createSafeObservation(),
    });
    const neutralPlayer = createPlayer(1);
    const neutral = new HeuristicBotPolicy({ profile: 'balanced' });
    neutral.update(1 / 60, neutralPlayer, {
        ...createContext(),
        players: [neutralPlayer],
    });
    const predictivePlayer = createPlayer(1);
    const predictive = new HeuristicBotPolicy({ profile: 'balanced' });
    predictive.profile = Object.freeze({ ...predictive.profile, predictiveSafetyBias: 0.6 });
    const predictiveAction = predictive.update(1 / 60, predictivePlayer, {
        ...createContext(),
        players: [predictivePlayer],
    });

    assert.equal(neutral.getDecisionSnapshot().safetyState, 'normal');
    assert.equal(predictive.getDecisionSnapshot().safetyState, 'evade');
    assert.equal(predictive.getDecisionSnapshot().safetyReason, 'trail-ahead');
    assert.equal(predictiveAction.boost, false);
});

test('safety arbiter vetoes a steering command that points into a side trail', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ profile: 'balanced' });
    const input = {
        yawLeft: true,
        yawRight: false,
        pitchUp: false,
        pitchDown: false,
        boost: true,
        shootMG: true,
        shootItem: true,
        shootItemIndex: 0,
    };

    applyHeuristicSafetyArbiter(policy, input, 1 / 60, player, {
        projectiles: [],
        arena: {},
        trailSpatialIndex: {
            checkGlobalCollision(position) {
                return position.x < -0.1 ? { hit: true } : null;
            },
        },
    }, createSafeObservation(), {});

    assert.equal(policy._safetyState.state, 'evade');
    assert.equal(policy._safetyState.reason, 'trail-on-path');
    assert.equal(policy._safetyState.frontTrailClearance, 1);
    assert.equal(policy._safetyState.leftTrailClearance, 0);
    assert.equal(input.yawLeft, false);
    assert.equal(input.yawRight, true);
    assert.equal(input.boost, false);
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
    player.rocketInventory = ['ROCKET_HEAVY'];
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

test('Hunt bot does not fire at a selected target behind it', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, 30);
    player.inventory = ['ROCKET_HEAVY'];
    const observation = createSafeObservation();
    observation[TARGET_IN_FRONT] = 1;
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation,
        huntTarget: { playerIndex: enemy.index, distance: 30 },
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(action.shootMG, false);
    assert.equal(action.shootItem, false);
});

test('queue-only Hunt bot emits the dedicated FIFO rocket action', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -30);
    player.rocketInventory = ['ROCKET_WEAK'];
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        huntTarget: { playerIndex: enemy.index, distance: 30 },
        observationContext: { targetDistanceMax: 120 },
    });
    assert.equal(action.shootRocket, true);
    assert.equal(action.shootItem, false);
});

test('Hunt bot reserves hitscan MG fire for the configured aim cone', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    const context = {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    };

    enemy.position.set(15, 0, -20);
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);

    enemy.position.set(2, 0, -30);
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
});

test('Hunt bot waits for the shared shoot cooldown before firing MG or rockets', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -30);
    player.inventory = ['ROCKET_HEAVY'];
    player.shootCooldown = 0.2;
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    policy._huntState.movementIntent = 'strafe';
    const context = {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    };

    const coolingDown = policy.update(1 / 60, player, context);
    assert.equal(coolingDown.shootMG, false);
    assert.equal(coolingDown.shootItem, false);
    assert.equal(coolingDown.shootRocket, false);
    assert.equal(policy._huntState.commitTimer, 0);

    player.shootCooldown = 0;
    const ready = policy.update(1 / 60, player, context);
    assert.equal(ready.shootMG, true);
    assert.equal(ready.shootRocket, true);
    assert.equal(policy._huntState.commitTimer, 0.24);
});

test('Hunt bot turns toward a target directly behind instead of flying straight', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, 60);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        huntTarget: { playerIndex: enemy.index, distance: 60 },
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(action.yawLeft || action.yawRight || Math.abs(action.yawAxis) > 0, true);
    assert.equal(action.yawLeft !== action.yawRight || Math.abs(action.yawAxis) === 1, true);
});

test('Hunt bot leads a moving target while approaching from outside its attack window', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -108);
    enemy.velocity = new THREE.Vector3(18, 0, 0);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(policy.getDecisionSnapshot().intent, 'approach');
    assert.equal(action.yawRight, true);
});

test('Hunt attack cutoff tactic extends the lead without changing the neutral profile', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -108);
    enemy.velocity = new THREE.Vector3(18, 0, 0);
    const context = {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    };
    const neutral = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    neutral.update(1 / 60, player, context);
    const neutralLeadX = neutral._tmpAimTarget.x;

    const cutoff = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    cutoff.profile = Object.freeze({ ...cutoff.profile, attackCutoffBias: 1 });
    cutoff.update(1 / 60, player, context);

    assert.equal(HEURISTIC_PROFILES.balanced.attackCutoffBias, 0.5);
    assert.ok(cutoff._tmpAimTarget.x > neutralLeadX);
});

test('Hunt escape tactic adds a lateral roll only above the neutral bias', () => {
    const player = createPlayer(1);
    player.hp = 20;
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -30);
    const context = {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    };
    const neutral = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    const neutralAction = neutral.update(1, player, context);
    const evasive = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    evasive.profile = Object.freeze({ ...evasive.profile, escapeLateralBias: 1 });
    const evasiveAction = evasive.update(1, player, context);

    assert.equal(neutral.getDecisionSnapshot().intent, 'retreat');
    assert.equal(neutralAction.rollLeft || neutralAction.rollRight, false);
    assert.equal(evasive.getDecisionSnapshot().intent, 'retreat');
    assert.equal(evasiveAction.rollLeft !== evasiveAction.rollRight, true);
});

test('Hunt finisher keeps firing at a weak target only above the neutral bias', () => {
    const player = createPlayer(1);
    player.hp = 50;
    const enemy = createPlayer(2, false);
    enemy.hp = 20;
    enemy.position.set(0, 0, -30);
    const context = {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    };
    const neutral = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'defensive' });
    const neutralAction = neutral.update(1 / 60, player, context);
    const finisher = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'defensive' });
    finisher.profile = Object.freeze({ ...finisher.profile, finisherBias: 1 });
    const finisherAction = finisher.update(1 / 60, player, context);

    assert.equal(HEURISTIC_PROFILES.defensive.finisherBias, 0.5);
    assert.equal(neutral.getDecisionSnapshot().intent, 'retreat');
    assert.equal(neutralAction.shootMG, false);
    assert.notEqual(finisher.getDecisionSnapshot().intent, 'retreat');
    assert.equal(finisherAction.shootMG, true);
});

test('Hunt safety still vetoes the finisher under projectile threat', () => {
    const player = createPlayer(1);
    player.hp = 50;
    const enemy = createPlayer(2, false);
    enemy.hp = 20;
    enemy.position.set(0, 0, -30);
    const observation = createSafeObservation();
    observation[PROJECTILE_THREAT] = 1;
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'defensive' });
    policy.profile = Object.freeze({ ...policy.profile, finisherBias: 1 });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT', players: [player, enemy], arena: {}, observation,
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(policy.getDecisionSnapshot().intent, 'evade');
    assert.equal(action.shootMG, false);
});

test('Hunt opening fanout separates lanes only above the neutral bias', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(30, 0, -30);
    const context = {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    };
    const neutral = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    const neutralAction = neutral.update(1 / 60, player, context);
    const disengage = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    disengage.profile = Object.freeze({ ...disengage.profile, openingFanoutBias: 1 });
    const disengageAction = disengage.update(1 / 60, player, context);

    assert.equal(HEURISTIC_PROFILES.balanced.openingFanoutBias, 0.5);
    assert.notEqual(neutral.getDecisionSnapshot().intent, 'opening-fanout');
    assert.equal(
        neutralAction.yawLeft || neutralAction.yawRight
            || neutralAction.rollLeft || neutralAction.rollRight,
        true
    );
    assert.equal(disengage.getDecisionSnapshot().intent, 'opening-fanout');
    assert.equal(disengageAction.yawLeft !== disengageAction.yawRight, true);
    assert.equal(disengageAction.boost, false);
});

test('Hunt opportunist steals a vulnerable target without changing the neutral target ring', () => {
    const neutralPlayer = createPlayer(1);
    const opportunistPlayer = createPlayer(1);
    const ringTarget = createPlayer(2, false);
    const weakTarget = createPlayer(3, false);
    ringTarget.position.set(0, 0, -20);
    weakTarget.position.set(0, 0, -35);
    weakTarget.hp = 10;
    const observation = createSafeObservation();
    const neutral = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    neutral.update(1 / 60, neutralPlayer, {
        mode: 'HUNT', players: [neutralPlayer, ringTarget, weakTarget], projectiles: [], arena: {},
        observation, observationContext: { targetDistanceMax: 120 },
    });
    const opportunist = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    opportunist.profile = Object.freeze({ ...opportunist.profile, opportunistBias: 1 });
    opportunist.update(1 / 60, opportunistPlayer, {
        mode: 'HUNT', players: [opportunistPlayer, ringTarget, weakTarget], projectiles: [], arena: {},
        observation, observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(HEURISTIC_PROFILES.balanced.opportunistBias, 0.5);
    assert.equal(neutralPlayer.fightTargetPlayerIndex, ringTarget.index);
    assert.equal(opportunistPlayer.fightTargetPlayerIndex, weakTarget.index);
});

test('Hunt opening hook reverses its fan to lay a crossing trail', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(30, 0, -30);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    policy.profile = Object.freeze({ ...policy.profile, openingHookBias: 1 });
    const context = {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    };
    const first = policy.update(0.1, player, context);
    const firstYawDirection = first.yawRight ? -1 : 1;
    const second = policy.update(0.80, player, context);
    const secondYawDirection = second.yawRight ? -1 : 1;
    const third = policy.update(0.09, player, context);
    const thirdYawDirection = third.yawRight ? -1 : 1;

    assert.equal(HEURISTIC_PROFILES.balanced.openingHookBias, 0.5);
    assert.equal(policy.getDecisionSnapshot().intent, 'opening-hook');
    assert.ok(firstYawDirection * secondYawDirection < 0);
    assert.equal(firstYawDirection, thirdYawDirection);
});

test('Hunt traffic avoidance steers before another flight path crosses', () => {
    const player = createPlayer(1);
    player.velocity = new THREE.Vector3(0, 0, -18);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -10);
    enemy.velocity = new THREE.Vector3(0, 0, 18);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    policy.profile = Object.freeze({ ...policy.profile, trafficAvoidanceBias: 1 });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT', players: [player, enemy], projectiles: [], arena: {},
        observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(HEURISTIC_PROFILES.balanced.trafficAvoidanceBias, 0.5);
    assert.equal(policy.getDecisionSnapshot().intent, 'traffic-avoid');
    assert.equal(action.yawLeft !== action.yawRight, true);
    assert.equal(action.boost, false);
});

test('Hunt bot boosts while safely aligned with a distant target', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -120);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(action.boost, true);
});

test('Hunt bot tracks the current target position inside the hitscan attack window', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -50);
    enemy.velocity = new THREE.Vector3(18, 0, 0);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(action.yawLeft, false);
    assert.equal(action.yawRight, false);
    assert.equal(action.shootMG, true);

    enemy.position.x = 1;
    const fineAim = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });
    assert.ok(fineAim.yawAxis < 0 && fineAim.yawAxis > -1);
    assert.equal(fineAim.yawLeft, false);
    assert.equal(fineAim.yawRight, false);
    assert.equal(sanitizeBotAction(fineAim).yawAxis, fineAim.yawAxis);
});

test('precision Hunt steering converges on a moving target across update ticks', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    player.quaternion = new THREE.Quaternion();
    player.getDirection = (out) => out.set(0, 0, -1).applyQuaternion(player.quaternion);
    enemy.velocity = new THREE.Vector3();
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    let fired = false;

    for (let tick = 0; tick < 240 && !fired; tick += 1) {
        const targetAngle = 0.4 + tick * 0.45 / 60;
        enemy.position.set(Math.sin(targetAngle) * 50, 8, -Math.cos(targetAngle) * 50);
        enemy.velocity.set(Math.cos(targetAngle) * 22.5, 0, Math.sin(targetAngle) * 22.5);
        const action = policy.update(1 / 60, player, {
            mode: 'HUNT',
            players: [player, enemy],
            projectiles: [],
            arena: {},
            observation: createSafeObservation(),
            observationContext: { targetDistanceMax: 120 },
        });
        fired = action.shootMG === true;
        const pitch = Number.isFinite(action.pitchAxis)
            ? action.pitchAxis : ((action.pitchUp ? 1 : 0) - (action.pitchDown ? 1 : 0));
        const yaw = Number.isFinite(action.yawAxis)
            ? action.yawAxis : ((action.yawLeft ? 1 : 0) - (action.yawRight ? 1 : 0));
        rotation.setFromEuler(euler.set(pitch * 3.4 / 60, yaw * 3.4 / 60, 0));
        player.quaternion.multiply(rotation);
    }

    assert.equal(fired, true);
});

test('Hunt burst keeps the target and movement intent stable while a target moves', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    const distractor = createPlayer(3, false);
    enemy.position.set(0, 0, -48);
    distractor.position.set(8, 0, -52);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const context = {
        mode: 'HUNT',
        players: [player, enemy, distractor],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    };

    const first = policy.update(1 / 60, player, context);
    const intent = policy.getDecisionSnapshot().intent;
    assert.equal(first.shootMG, true);
    assert.equal(player.fightTargetPlayerIndex, enemy.index);

    for (let tick = 0; tick < 8; tick += 1) {
        enemy.position.x += 0.35;
        distractor.position.x -= 0.2;
        policy.update(1 / 60, player, context);
        assert.equal(player.fightTargetPlayerIndex, enemy.index);
        assert.equal(policy.getDecisionSnapshot().intent, intent);
    }
});

test('Hunt bot shoots destructible trails but keeps all fire behind walls', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -48);
    player.inventory = ['ROCKET_HEAVY'];
    const blockedArena = {
        checkCollisionFast(position) {
            return position.z < -18 && position.z > -30;
        },
    };
    const arenaPolicy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    arenaPolicy._huntState.movementIntent = 'strafe';
    const arenaAction = arenaPolicy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: blockedArena,
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });
    assert.equal(player.fightTargetLockRemaining, 0);

    const trailPolicy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const trailAction = trailPolicy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        trailSpatialIndex: {
            checkGlobalCollision(position) {
                return position.z < -18 && position.z > -30 ? { hit: true } : null;
            },
        },
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(arenaAction.shootMG, false);
    assert.equal(arenaAction.shootItem, false);
    assert.equal(arenaPolicy._huntState.commitTimer, 0);
    assert.equal(trailAction.shootMG, true);
    assert.equal(trailAction.shootItem, false);
});

test('Hunt movement commits briefly, then uses a lateral close-range breakaway', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -72);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const context = {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    };

    policy.update(0.1, player, context);
    enemy.position.set(0, 0, -12);
    policy.update(0.1, player, context);
    assert.equal(policy.getDecisionSnapshot().intent, 'approach');

    const breakaway = policy.update(1, player, context);
    assert.equal(policy.getDecisionSnapshot().intent, 'breakaway');
    assert.equal(breakaway.yawLeft || breakaway.yawRight, true);
});

test('Hunt movement keeps tracking targets outside the collision breakaway range', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -24);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(policy.getDecisionSnapshot().intent, 'strafe');
    assert.equal(action.boost, false);
});

test('Hunt pursuit bends toward arena center near a boundary', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    player.position.set(90, 0, 0);
    enemy.position.set(90, 0, -72);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: {
            bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 },
        },
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

    assert.equal(action.yawLeft || action.yawAxis > 0, true);
    assert.equal(action.yawRight, false);
});

test('3D safety chooses the open vertical escape when both sides are blocked', () => {
    const player = createPlayer(1);
    const observation = createSafeObservation();
    observation[WALL_DISTANCE_FRONT] = 0.1;
    observation[WALL_DISTANCE_LEFT] = 0.1;
    observation[WALL_DISTANCE_RIGHT] = 0.1;
    observation[WALL_DISTANCE_UP] = 1;
    observation[WALL_DISTANCE_DOWN] = 0.1;
    const policy = new HeuristicBotPolicy();
    const action = policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        projectiles: [],
        arena: {},
        observation,
    });

    assert.equal(action.pitchUp, true);
    assert.equal(action.pitchDown, false);
    assert.equal(action.yawLeft, false);
    assert.equal(action.yawRight, false);
});

test('directional projectile sensing ignores fly-bys and evades an actual collision course', () => {
    const player = createPlayer(1);
    player.speed = 0;
    player.baseSpeed = 0;
    const observation = createSafeObservation();
    observation[PROJECTILE_THREAT] = 1;
    const flyByPolicy = new HeuristicBotPolicy();
    const flyBy = flyByPolicy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        projectiles: [{ position: new THREE.Vector3(2, 0, 10), velocity: new THREE.Vector3(0, 0, 20), owner: null }],
        arena: {},
        observation,
    });
    assert.equal(flyByPolicy.getDecisionSnapshot().safetyState, 'normal');
    assert.equal(flyBy.yawLeft || flyBy.yawRight || flyBy.pitchUp || flyBy.pitchDown, false);

    const collisionPolicy = new HeuristicBotPolicy();
    const collision = collisionPolicy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        projectiles: [{ position: new THREE.Vector3(2, 0, 10), velocity: new THREE.Vector3(0, 0, -20), owner: null }],
        arena: {},
        observation,
    });
    assert.equal(collisionPolicy.getDecisionSnapshot().safetyReason, 'projectile');
    assert.equal(collision.yawLeft, true);
    assert.equal(collision.yawRight, false);
});

test('directional projectile sensing reacts to a collision course 1.5 seconds ahead', () => {
    const player = createPlayer(1);
    player.speed = 0;
    player.baseSpeed = 0;
    const policy = new HeuristicBotPolicy();
    const action = policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player],
        projectiles: [{
            position: new THREE.Vector3(2, 0, 30),
            velocity: new THREE.Vector3(0, 0, -20),
            owner: null,
        }],
        arena: {},
        observation: createSafeObservation(),
    });

    assert.equal(policy.getDecisionSnapshot().safetyReason, 'projectile');
    assert.equal(action.yawLeft || action.yawRight || action.pitchUp || action.pitchDown, true);
    assert.equal(action.boost, false);
});

test('Classic bot commits to an interception target in safe open space', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(-20, 0, -36);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD' });
    const action = policy.update(1 / 60, player, {
        mode: 'CLASSIC',
        players: [player, enemy],
        projectiles: [],
        arena: {},
        observation: createSafeObservation(),
    });

    assert.equal(policy.getDecisionSnapshot().intent, 'intercept');
    assert.equal(action.yawLeft || action.yawRight, true);
    assert.ok(policy._classicState.commitTimer > 0);
});
