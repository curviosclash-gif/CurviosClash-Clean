import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { sanitizeBotAction } from '../src/entities/ai/actions/BotActionContract.js';
import {
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
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);

    enemy.position.set(0.5, 0, -30);
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
});

test('Hunt bot waits for the shared shoot cooldown before firing MG or rockets', () => {
    const player = createPlayer(1);
    const enemy = createPlayer(2, false);
    enemy.position.set(0, 0, -30);
    player.inventory = ['ROCKET_HEAVY'];
    player.shootCooldown = 0.2;
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
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

    player.shootCooldown = 0;
    const ready = policy.update(1 / 60, player, context);
    assert.equal(ready.shootMG, true);
    assert.equal(ready.shootItem, true);
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

test('Hunt bot keeps MG and rockets behind blocked fight corridors', () => {
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
    const arenaAction = arenaPolicy.update(1 / 60, player, {
        mode: 'HUNT',
        players: [player, enemy],
        projectiles: [],
        arena: blockedArena,
        observation: createSafeObservation(),
        observationContext: { targetDistanceMax: 120 },
    });

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
    assert.equal(trailAction.shootMG, false);
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
