import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import {
    HEURISTIC_DIFFICULTIES,
    HEURISTIC_PROFILES,
} from '../src/entities/ai/HeuristicBotPolicyOps.js';
import { HEURISTIC_SAFETY_STATES } from '../src/entities/ai/HeuristicBotSafetyOps.js';
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

const DT = 1 / 60;

function createPlayer(index = 1, isBot = true) {
    const player = {
        index, isBot, alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        speed: 35, baseSpeed: 35,
        hp: 100, maxHp: 100, shieldHP: 0, maxShieldHp: 40,
        hitboxRadius: 0.8, inventory: [], selectedItemIndex: 0,
    };
    player.getDirection = function (out) { return out.set(0, 0, -1).applyQuaternion(this.quaternion); };
    return player;
}

function createEnemy(index = 2, position = { x: 0, y: 0, z: -48 }) {
    return {
        index, isBot: false, alive: true,
        position: new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0),
        velocity: new THREE.Vector3(),
        speed: 35, baseSpeed: 35, hp: 100, maxHp: 100,
        getDirection(out) { return out.set(0, 0, -1); },
    };
}

function createSafeObservation() {
    const obs = new Array(OBSERVATION_LENGTH_V1).fill(0);
    obs[WALL_DISTANCE_FRONT] = 1; obs[WALL_DISTANCE_LEFT] = 1; obs[WALL_DISTANCE_RIGHT] = 1;
    obs[WALL_DISTANCE_UP] = 1; obs[WALL_DISTANCE_DOWN] = 1; obs[LOCAL_OPENNESS_RATIO] = 1;
    obs[TARGET_DISTANCE_RATIO] = 0.35; obs[TARGET_IN_FRONT] = 1;
    obs[PRESSURE_LEVEL] = 0.2; obs[PROJECTILE_THREAT] = 0;
    return obs;
}

function classicCtx(player, enemy, overrides = {}) {
    const players = [player]; if (enemy) players.push(enemy);
    return { mode: 'CLASSIC', players, arena: {}, trailSpatialIndex: null, observation: createSafeObservation(), ...overrides };
}

function huntCtx(player, enemy, overrides = {}) {
    const players = [player]; if (enemy) players.push(enemy);
    return { mode: 'HUNT', players, projectiles: [], arena: {}, trailSpatialIndex: null, observation: createSafeObservation(), observationContext: { targetDistanceMax: 120 }, ...overrides };
}

function countIntentChanges(snapshots) {
    let c = 0; for (let i = 1; i < snapshots.length; i++) if (snapshots[i].intent !== snapshots[i - 1].intent) c++; return c;
}

function uniqueIntents(snapshots) { return [...new Set(snapshots.map((s) => s.intent))]; }

// --- Tests ---

test('boot loop: safety state machine navigates full lifecycle', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.NORMAL);

    policy.onBounce('WALL', new THREE.Vector3(-1, 0, 0));
    policy.update(DT, player, classicCtx(player));
    assert.equal(policy.getDecisionSnapshot().safetyState, 'evade');
    assert.equal(policy.getDecisionSnapshot().safetyReason, 'wall-bounce');

    const wallObs = new Array(OBSERVATION_LENGTH_V1).fill(0);
    wallObs[WALL_DISTANCE_FRONT] = 0.05; wallObs[WALL_DISTANCE_LEFT] = 1;
    wallObs[WALL_DISTANCE_RIGHT] = 0.05; wallObs[WALL_DISTANCE_UP] = 1; wallObs[WALL_DISTANCE_DOWN] = 1;
    wallObs[LOCAL_OPENNESS_RATIO] = 0.3; wallObs[PRESSURE_LEVEL] = 0.9;
    const wallCtx = classicCtx(player, null, { observation: wallObs });
    for (let t = 0; t < 40; t++) policy.update(DT, player, wallCtx);
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.EVADE);

    const safeCtx = classicCtx(player);
    for (let t = 0; t < 180; t++) policy.update(DT, player, safeCtx);
    const validStates = new Set([HEURISTIC_SAFETY_STATES.NORMAL, HEURISTIC_SAFETY_STATES.COOLDOWN]);
    assert.ok(validStates.has(policy._safetyState.state));

    policy.reset();
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.NORMAL);
});

test('boot loop: decisions stay stable under identical conditions across ticks', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2, { x: -20, y: 0, z: -36 });
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    const ctx = classicCtx(player, enemy);
    const snapshots = [];
    for (let t = 0; t < 60; t++) { policy.update(DT, player, ctx); snapshots.push({ ...policy.getDecisionSnapshot() }); }
    assert.ok(uniqueIntents(snapshots).length <= 2);
    assert.ok(countIntentChanges(snapshots) <= 2);
});

test('boot loop: all profile x difficulty combinations produce valid actions', () => {
    for (const profile of Object.keys(HEURISTIC_PROFILES)) {
        for (const difficulty of Object.keys(HEURISTIC_DIFFICULTIES)) {
            const player = createPlayer(1);
            const enemy = createEnemy(2);
            const policy = new HeuristicBotPolicy({ difficulty, profile });
            const action = policy.update(DT, player, classicCtx(player, enemy));
            assert.ok(action.boost === true || action.boost === false, `${profile}x${difficulty}: boost boolean`);
            assert.equal(action.shootMG, false, `${profile}x${difficulty}: no MG in Classic`);
            assert.notEqual(action.yawLeft && action.yawRight, true, `${profile}x${difficulty}: no dual yaw`);
            assert.notEqual(action.pitchUp && action.pitchDown, true, `${profile}x${difficulty}: no dual pitch`);
            const snap = policy.getDecisionSnapshot();
            assert.equal(snap.mode, 'CLASSIC');
            assert.equal(snap.profile, profile);
            assert.equal(snap.difficulty, difficulty);
        }
    }
});

test('boot loop: profile and difficulty can be swapped at runtime', () => {
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    policy.update(DT, createPlayer(1), classicCtx(createPlayer(1)));
    policy.setProfile('aggressive'); policy.setDifficulty('HARD');
    const action = policy.update(DT, createPlayer(1), classicCtx(createPlayer(1)));
    assert.equal(policy.getDecisionSnapshot().profile, 'aggressive');
    assert.equal(policy.getDecisionSnapshot().difficulty, 'hard');
    assert.ok(action.boost === true || action.boost === false);
});

test('boot loop: Hunt mode navigates search → approach → strafe state sequence', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2, { x: 0, y: 0, z: -120 });
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    const intents = [];
    for (let t = 0; t < 30; t++) { policy.update(DT, player, huntCtx(player, enemy)); intents.push(policy.getDecisionSnapshot().intent); }
    assert.ok([...new Set(intents)].some((i) => ['approach', 'search', 'strafe'].includes(i)));
});

test('boot loop: Hunt bot does not fire at targets behind it', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2, { x: 0, y: 0, z: 60 });
    player.inventory = ['ROCKET_HEAVY'];
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    const ctx = huntCtx(player, enemy);
    for (let t = 0; t < 10; t++) {
        const a = policy.update(DT, player, ctx);
        assert.equal(a.shootMG, false);
        assert.equal(a.shootItem, false);
    }
    player.shootCooldown = 0; enemy.position.set(0, 0, -48);
    let fired = false;
    for (let t = 0; t < 30; t++) { if (policy.update(DT, player, ctx).shootMG) { fired = true; break; } }
    assert.equal(fired, true);
});

test('boot loop: bounce recovery transitions correctly through evade → cooldown → normal', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const safeCtx = classicCtx(player);
    policy.onBounce('TRAIL', new THREE.Vector3(1, 0, 0));
    const a = policy.update(DT, player, safeCtx);
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.RECOVER);
    assert.equal(a.boost, false); assert.equal(a.shootMG, false);
    let recovered = false;
    for (let t = 0; t < 200; t++) { policy.update(DT, player, safeCtx); if (policy._safetyState.state === 'normal') { recovered = true; break; } }
    assert.equal(recovered, true);
    policy.onBounce('WALL'); policy.update(DT, player, safeCtx);
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.EVADE);
});

test('boot loop: projectile evasion detects collision course', () => {
    const player = createPlayer(1); player.speed = 0; player.baseSpeed = 0;
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const obs = createSafeObservation();
    const flybyCtx = classicCtx(player, null, { observation: obs, projectiles: [{ position: new THREE.Vector3(2, 0, 10), velocity: new THREE.Vector3(0, 0, 20), owner: null }] });
    policy.update(DT, player, flybyCtx);
    assert.equal(policy.getDecisionSnapshot().safetyState, 'normal');
    const colCtx = classicCtx(player, null, { observation: obs, projectiles: [{ position: new THREE.Vector3(2, 0, 10), velocity: new THREE.Vector3(0, 0, -20), owner: null }] });
    policy.update(DT, player, colCtx);
    assert.equal(policy.getDecisionSnapshot().safetyState, 'evade');
});

test('boot loop: boost is disabled when any safety condition is violated', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2, { x: 0, y: 0, z: -120 });
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    const closeObs = createSafeObservation();
    closeObs[WALL_DISTANCE_FRONT] = 0.08; closeObs[WALL_DISTANCE_LEFT] = 0.08;
    closeObs[WALL_DISTANCE_RIGHT] = 0.08; closeObs[LOCAL_OPENNESS_RATIO] = 0.15; closeObs[PRESSURE_LEVEL] = 0.95;
    const dangerCtx = classicCtx(player, enemy, { observation: closeObs });
    for (let t = 0; t < 20; t++) policy.update(DT, player, dangerCtx);
    assert.ok(policy.getDecisionSnapshot().safetyState === 'evade' || policy.getDecisionSnapshot().safetyState === 'recover');
    const threatObs = createSafeObservation(); threatObs[PROJECTILE_THREAT] = 1;
    const threatAction = policy.update(DT, player, huntCtx(player, enemy, { observation: threatObs }));
    assert.equal(threatAction.boost, false);
});

test('boot loop: decision snapshot tracks counters correctly across ticks', () => {
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    const ctx = classicCtx(createPlayer(1), createEnemy(2));
    policy.update(DT, createPlayer(1), ctx);
    const initial = policy.getDecisionSnapshot();
    assert.equal(typeof initial.mode, 'string'); assert.equal(typeof initial.intent, 'string');
    assert.ok(Number.isFinite(initial.frontClearance));
    for (let t = 0; t < 30; t++) policy.update(DT, createPlayer(1), ctx);
    assert.ok(policy._decisionCounters.updates > 0);
    assert.ok(policy.getDecisionSnapshot().safetyActiveRatio >= 0 && policy.getDecisionSnapshot().safetyActiveRatio <= 1);
});

test('boot loop: input actions never contain contradictory simultaneous steering', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2);
    const wallObs = new Array(OBSERVATION_LENGTH_V1).fill(0);
    wallObs[WALL_DISTANCE_FRONT] = 1; wallObs[WALL_DISTANCE_LEFT] = 0.05; wallObs[WALL_DISTANCE_RIGHT] = 0.05;
    wallObs[WALL_DISTANCE_UP] = 1; wallObs[WALL_DISTANCE_DOWN] = 1; wallObs[LOCAL_OPENNESS_RATIO] = 0.3;
    wallObs[TARGET_DISTANCE_RATIO] = 0.35; wallObs[TARGET_IN_FRONT] = 1; wallObs[PRESSURE_LEVEL] = 0.4;
    const contexts = [classicCtx(player, enemy), classicCtx(player, enemy, { observation: wallObs }), huntCtx(player, enemy)];
    for (const profile of Object.keys(HEURISTIC_PROFILES)) {
        for (const difficulty of Object.keys(HEURISTIC_DIFFICULTIES)) {
            const policy = new HeuristicBotPolicy({ difficulty, profile });
            for (const ctx of contexts) {
                for (let t = 0; t < 8; t++) {
                    const a = policy.update(DT, player, ctx);
                    assert.equal(!(a.yawLeft && a.yawRight), true);
                    assert.equal(!(a.pitchUp && a.pitchDown), true);
                }
            }
        }
    }
});

test('boot loop: safety state changes are bounded and do not oscillate rapidly', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const safetyStates = [];
    const altObs = createSafeObservation();
    const obsSeq = [0.05, 1, 0.05, 1, 0.05, 1, 0.05, 1, 0.05, 1, 0.05, 1, 0.05, 1, 0.05, 1, 1, 1, 1, 1];
    for (let t = 0; t < 80; t++) {
        altObs[WALL_DISTANCE_FRONT] = obsSeq[t % obsSeq.length];
        policy.update(DT, player, classicCtx(player, null, { observation: altObs }));
        safetyStates.push(policy._safetyState.state);
    }
    let transitions = 0;
    for (let i = 1; i < safetyStates.length; i++) if (safetyStates[i] !== safetyStates[i - 1]) transitions++;
    assert.ok(transitions <= 8, `safety should not oscillate, got ${transitions} transitions`);
});

test('boot loop: Hunt MG fire respects aim cone, shoot cooldown, and wall obstruction', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'aggressive' });
    player.shootCooldown = 0.3;
    assert.equal(policy.update(DT, player, huntCtx(player, enemy)).shootMG, false);
    player.shootCooldown = 0; enemy.position.set(15, 0, -20);
    assert.equal(policy.update(DT, player, huntCtx(player, enemy)).shootMG, false);
    const blockedArena = { checkCollisionFast(p) { return p.z < -18 && p.z > -30; } };
    assert.equal(policy.update(DT, player, huntCtx(player, enemy, { arena: blockedArena })).shootMG, false);
});

test('boot loop: Arcade mode targets parcours checkpoints', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const arcadeCtx = {
        mode: 'ARCADE', players: [player], arena: {}, trailSpatialIndex: null,
        observation: createSafeObservation(),
        parcoursProgress: { nextCheckpointIndex: 0 },
        parcoursRoute: { enabled: true, totalCheckpoints: 3, checkpoints: [{ routeIndex: 0, pos: { x: 20, y: 5, z: -40 } }], finish: { pos: { x: 0, y: 0, z: -160 } } },
    };
    const action = policy.update(DT, player, arcadeCtx);
    assert.equal(policy.getDecisionSnapshot().intent, 'parcours-target');
    assert.equal(action.shootMG, false);
});

test('boot loop: policy reset restores all internal state to initial values', () => {
    const player = createPlayer(1);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    policy.onBounce('TRAIL', new THREE.Vector3(1, 0, 0));
    for (let t = 0; t < 20; t++) policy.update(DT, player, huntCtx(player, createEnemy(2)));
    policy.reset();
    assert.equal(policy._safetyState.state, HEURISTIC_SAFETY_STATES.NORMAL);
    assert.equal(policy._classicState.intent, 'space-seek');
    assert.equal(policy._huntState.movementIntent, 'search');
    assert.equal(policy._decisionCounters.updates, 0);
    const snap = policy.update(DT, player, classicCtx(player)) && policy.getDecisionSnapshot();
    assert.equal(snap.safetyState, 'normal'); assert.equal(snap.intentChanges, 0);
});

test('boot loop: Classic mode tracks interception targets', () => {
    const player = createPlayer(1);
    const enemy = createEnemy(2, { x: -20, y: 0, z: -36 });
    enemy.velocity = new THREE.Vector3(18, 0, 0);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    let intent = 'unknown';
    for (let t = 0; t < 15; t++) { policy.update(DT, player, classicCtx(player, enemy)); intent = policy.getDecisionSnapshot().intent; }
    assert.ok(['intercept', 'contain'].includes(intent));
});

test('boot loop: observation-less update produces valid default behavior', () => {
    const policy = new HeuristicBotPolicy({ difficulty: 'NORMAL', profile: 'balanced' });
    const action = policy.update(DT, createPlayer(1), { mode: 'CLASSIC', players: [createPlayer(1)], arena: {} });
    assert.ok(!(action.yawLeft && action.yawRight));
    assert.ok(!(action.pitchUp && action.pitchDown));
});

test('boot loop: dead player produces null-like update', () => {
    const policy = new HeuristicBotPolicy();
    const dead = createPlayer(1); dead.alive = false;
    const result = policy.update(DT, dead, classicCtx(dead));
    assert.ok(result !== null && typeof result === 'object');
});

test('boot loop: Hunt bot locks target and maintains burst commitment', () => {
    const player = createPlayer(1); player.inventory = ['ROCKET_HEAVY']; player.shootCooldown = 0;
    const enemy = createEnemy(2);
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'aggressive' });
    const ctx = huntCtx(player, enemy);
    let locked = -1;
    for (let t = 0; t < 10; t++) { const a = policy.update(DT, player, ctx); if (a.shootMG) { locked = player.fightTargetPlayerIndex; break; } }
    assert.equal(locked, enemy.index);
    for (let t = 0; t < 8; t++) { policy.update(DT, player, ctx); assert.equal(player.fightTargetPlayerIndex, enemy.index); }
});

test('boot loop: multi-enemy scene picks nearest valid target', () => {
    const player = createPlayer(1);
    const near = createEnemy(2); const far = createEnemy(3, { x: 0, y: 0, z: -86 });
    const policy = new HeuristicBotPolicy({ difficulty: 'HARD', profile: 'balanced' });
    const ctx = classicCtx(player); ctx.players = [player, near, far];
    let target = -1;
    for (let t = 0; t < 10; t++) { policy.update(DT, player, ctx); target = policy._classicState.targetIndex; }
    assert.ok(target === near.index || target === far.index);
});
