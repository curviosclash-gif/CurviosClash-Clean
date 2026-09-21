import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    FLAG_BOT_ROLES,
    applyFlagBotMovement,
    resolveFlagBotRole,
} from '../src/hunt/HuntBotFlagOps.js';
import { applyHuntBotObjectiveMovement } from '../src/hunt/HuntBotObjectiveOps.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';

function bot(index, teamId, position = new THREE.Vector3()) {
    return {
        index,
        teamId,
        isBot: true,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 100,
        maxShieldHp: 100,
        position,
        inventory: [],
        rocketInventory: [],
        getDirection(out) { return out.set(0, 0, 1); },
        getAimDirection(out) { return out.set(1, 0, 0); },
    };
}

function flag(id, teamId, x, extra = {}) {
    return {
        id,
        teamId,
        hp: 300,
        maxHp: 300,
        protectionRemaining: 0,
        alive: true,
        position: new THREE.Vector3(x, 0, 0),
        ...extra,
    };
}

function scratchPolicy() {
    return {
        _tmpGate: new THREE.Vector3(),
        _tmpRoleTarget: new THREE.Vector3(),
        _tmpRoleForward: new THREE.Vector3(),
    };
}

function flagContext(players, flags) {
    return {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        players,
        navigationPlayers: players,
        flagObjectives: flags,
    };
}

test('flag roles rotate only across bots on the same team', () => {
    const human = { index: 0, teamId: TEAM_IDS.ALPHA, isBot: false };
    const players = [
        human,
        bot(2, TEAM_IDS.ALPHA),
        bot(4, TEAM_IDS.ALPHA),
        bot(6, TEAM_IDS.ALPHA),
        bot(8, TEAM_IDS.ALPHA),
        bot(3, TEAM_IDS.BRAVO),
    ];
    assert.deepEqual(players.slice(1, 5).map((player) => resolveFlagBotRole(player, players)), [
        FLAG_BOT_ROLES.ATTACKER,
        FLAG_BOT_ROLES.DEFENDER,
        FLAG_BOT_ROLES.SUPPORT,
        FLAG_BOT_ROLES.ATTACKER,
    ]);
});

test('flag attacker chooses an exposed enemy objective, steers to it and opens fire', () => {
    const player = bot(2, TEAM_IDS.ALPHA);
    const players = [player, bot(1, TEAM_IDS.BRAVO, new THREE.Vector3(80, 0, 0))];
    const protectedFlag = flag('protected', TEAM_IDS.BRAVO, 15, { hp: 30, protectionRemaining: 5 });
    const exposedFlag = flag('exposed', TEAM_IDS.BRAVO, 35, { hp: 120 });
    const input = { shootMG: false, boost: false, yawLeft: true };
    let steeringTarget = null;

    const role = applyFlagBotMovement({
        policy: scratchPolicy(),
        input,
        player,
        runtimeContext: flagContext(players, [protectedFlag, exposedFlag]),
        clearSteering(action) { action.yawLeft = false; },
        steerToward(_policy, _input, _player, target) { steeringTarget = target; },
    });

    assert.equal(role, FLAG_BOT_ROLES.ATTACKER);
    assert.equal(player.flagBotTargetId, 'exposed');
    assert.equal(player.botObjectiveType, 'FLAGS');
    assert.equal(steeringTarget, exposedFlag.position);
    assert.equal(input.yawLeft, false);
    assert.equal(input.shootMG, true);
});

test('flag defender intercepts an intruder threatening a damaged allied objective', () => {
    const attacker = bot(2, TEAM_IDS.ALPHA);
    const defender = bot(4, TEAM_IDS.ALPHA, new THREE.Vector3(-40, 0, 0));
    const intruder = bot(1, TEAM_IDS.BRAVO, new THREE.Vector3(8, 0, 0));
    const ownFlag = flag('home', TEAM_IDS.ALPHA, 0, { hp: 180 });
    const enemyFlag = flag('away', TEAM_IDS.BRAVO, 90);
    let steeringTarget = null;

    const role = applyFlagBotMovement({
        policy: scratchPolicy(),
        input: { shootMG: false, boost: false },
        player: defender,
        runtimeContext: flagContext([attacker, defender, intruder], [ownFlag, enemyFlag]),
        clearSteering() {},
        steerToward(_policy, _input, _player, target) { steeringTarget = target; },
    });

    assert.equal(role, FLAG_BOT_ROLES.DEFENDER);
    assert.equal(defender.flagBotTargetId, 'home');
    assert.equal(steeringTarget, intruder.position);
});

test('objective dispatcher preserves escort roles and retreat vetoes flag steering', () => {
    const player = bot(2, TEAM_IDS.ALPHA, new THREE.Vector3(-60, 0, 0));
    const policy = scratchPolicy();
    policy._tmpRoleForward.set(0, 0, 1);
    const input = { boost: false };
    let target = null;
    const escortRole = applyHuntBotObjectiveMovement({
        policy,
        input,
        player,
        runtimeContext: {
            runtimeConfig: { hunt: { teamMode: true, teamObjective: 'ESCORT' } },
            navigationPlayers: [player],
            escortObjective: { active: true, phase: 'MOVING' },
            escortTank: {
                position: new THREE.Vector3(),
                path: [[0, 0, 0], [0, 0, 100]],
                toIndex: 1,
            },
        },
        clearSteering() {},
        steerToward(_policy, _input, _player, value) { target = value.clone(); },
    });
    assert.equal(escortRole, 'ESCORT');
    assert.equal(player.botObjectiveType, 'ESCORT');
    assert.ok(target);

    const flagRole = applyHuntBotObjectiveMovement({
        policy,
        input,
        player,
        runtimeContext: flagContext([player], [flag('away', TEAM_IDS.BRAVO, 20)]),
        shouldRetreat: true,
        clearSteering() { throw new Error('retreat must keep steering ownership'); },
        steerToward() { throw new Error('retreat must keep steering ownership'); },
    });
    assert.equal(flagRole, null);
});

test('Hunt bridge applies flag intent after external inference', () => {
    const player = bot(2, TEAM_IDS.ALPHA);
    player.getAimDirection = (out) => out.set(0, 0, 1);
    const enemy = bot(1, TEAM_IDS.BRAVO, new THREE.Vector3(0, 0, 80));
    const policy = new HuntBridgePolicy({ autoLoadCheckpoint: false });
    policy._resolveInferenceBridgeAction = () => ({
        action: { yawLeft: false, yawRight: true },
        failure: null,
        usedBridge: true,
    });
    const observation = new Array(40).fill(0);
    const action = policy.update(0.016, player, {
        observation,
        observationContext: { targetDistanceMax: 120 },
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        visiblePlayers: [player, enemy],
        players: [player, enemy],
        navigationPlayers: [player, enemy],
        projectiles: [],
        arena: { specialGates: [], portalsEnabled: false, portals: [] },
        flagObjectives: [flag('bridge-target', TEAM_IDS.BRAVO, 45)],
    });

    assert.equal(player.flagBotTargetId, 'bridge-target');
    assert.equal(player.botObjectiveType, 'FLAGS');
    assert.equal(action.yawLeft, true);
    assert.equal(action.yawRight, false);
});
