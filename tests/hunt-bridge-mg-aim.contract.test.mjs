import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { TARGET_DISTANCE_RATIO, TARGET_IN_FRONT } from '../src/entities/ai/observation/ObservationSchemaV1.js';

test('Hunt bridge fires MG only toward an aligned enemy or trail target', () => {
    const player = {
        index: 0, isBot: true, alive: true, teamId: 'alpha', hp: 100, maxHp: 100,
        shieldHP: 40, maxShieldHp: 40, inventory: [],
        entityRuntimeConfig: { HUNT: HUNT_CONFIG },
        position: new THREE.Vector3(),
        getAimDirection(out) { return out.set(0, 0, 1); },
        getDirection(out) { return out.set(0, 0, 1); },
    };
    const enemy = {
        index: 1, alive: true, teamId: 'bravo', hp: 100, maxHp: 100,
        shieldHP: 40, maxShieldHp: 40,
        position: new THREE.Vector3(0, 0, 20),
    };
    const observation = new Array(40).fill(0);
    observation[TARGET_DISTANCE_RATIO] = 0.2;
    observation[TARGET_IN_FRONT] = 1;
    const context = {
        arena: { specialGates: [] }, players: [player, enemy], visiblePlayers: [player, enemy],
        projectiles: [], observation, observationContext: { targetDistanceMax: 120 },
    };
    const policy = new HuntBridgePolicy({
        autoLoadCheckpoint: false,
        fallbackPolicy: { usesRuntimeContext: true, update() { return {}; } },
    });

    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
    player.shootCooldown = 0.04;
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    player.shootCooldown = 0;
    let heat = 90;
    context.entityManager = { getHuntOverheatSnapshot: () => ({ [player.index]: heat }) };
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    player.hasRailgun = true;
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
    player.hasRailgun = false;
    heat = 70;
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
    heat = 86;
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
    player.fightLoadout = { machineGunId: 'raptor_r9' };
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    player.fightLoadout = null;
    delete context.entityManager;
    enemy.position.set(5, 0, 20);
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
    enemy.position.set(6, 0, 20);
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    enemy.position.set(20, 0, 0);
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    enemy.position.set(0, 0, 20);
    enemy.teamId = 'alpha';
    assert.equal(policy.update(1 / 60, player, context).shootMG, false);
    enemy.teamId = 'bravo';
    enemy.position.set(20, 0, 0);
    context.huntTarget = { kind: 'trail', playerIndex: 1, distance: 20, position: new THREE.Vector3(0, 0, 20) };
    assert.equal(policy.update(1 / 60, player, context).shootMG, true);
});

test('3D Hunt bridge pursues a clear enemy corridor and keeps fallback steering near danger', () => {
    const player = {
        index: 0, isBot: true, alive: true, hp: 100, maxHp: 100,
        shieldHP: 40, maxShieldHp: 40, inventory: [],
        entityRuntimeConfig: { HUNT: HUNT_CONFIG },
        position: new THREE.Vector3(),
        getAimDirection(out) { return out.set(0, 0, 1); },
        getDirection(out) { return out.set(0, 0, 1); },
    };
    const enemy = {
        index: 1, alive: true, hp: 100, maxHp: 100,
        shieldHP: 40, maxShieldHp: 40,
        position: new THREE.Vector3(35, 0, 50),
    };
    let blocked = false;
    let danger = false;
    const context = {
        mode: 'HUNT', rules: { planarMode: false },
        arena: { specialGates: [], raycast() { return { hit: blocked }; } },
        players: [player, enemy], visiblePlayers: [player, enemy], projectiles: [],
        observation: new Array(40).fill(0),
    };
    const policy = new HuntBridgePolicy({
        autoLoadCheckpoint: false,
        fallbackPolicy: {
            usesRuntimeContext: true,
            update() { return { yawLeft: true, boost: true }; },
            getSensorSnapshot() { return { immediateDanger: danger, forwardRisk: 0 }; },
        },
    });

    const pursuit = policy.update(1 / 60, player, context);
    assert.ok(pursuit.yawAxis > 0);
    assert.equal(pursuit.boost, false);

    blocked = true;
    assert.equal(policy.update(1 / 60, player, context).yawLeft, true);
    blocked = false;
    enemy.position.set(0, 0, 20);
    assert.equal(policy.update(1 / 60, player, context).yawLeft, true);
    enemy.position.set(35, 0, 50);
    danger = true;
    assert.equal(policy.update(1 / 60, player, context).yawLeft, true);
    danger = false;
    context.rules.planarMode = true;
    assert.equal(policy.update(1 / 60, player, context).yawLeft, true);
    context.rules.planarMode = false;
    context.arena.raycast = null;
    assert.equal(policy.update(1 / 60, player, context).yawLeft, true);
});
