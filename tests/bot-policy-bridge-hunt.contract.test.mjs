import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';

// Moved from tests/physics-policy.spec.js (P3): the players, the special gate and
// the sensor snapshot are all hand-built. In Node `three` resolves from
// node_modules, so the CDN import map that the desktop CSP blocks is irrelevant.

test('T82c: Hunt-Bot nutzt nahe Special Gates als Retreat-Anker', () => {
    const player = {
        id: 'hunt-bot',
        index: 0,
        alive: true,
        hp: 20,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        inventory: [],
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) {
            return out.set(0, 0, 1);
        },
    };
    const enemy = {
        id: 'enemy',
        index: 1,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        position: new THREE.Vector3(0, 0, 18),
    };
    const gate = {
        pos: new THREE.Vector3(-10, 0, 0),
        radius: 3,
        cooldowns: new Map(),
    };
    const policy = new HuntBotPolicy();
    policy._fallbackPolicy.update = () => ({
        yawLeft: false,
        yawRight: false,
        pitchUp: false,
        pitchDown: false,
        boost: false,
        shootMG: true,
        shootItem: false,
        shootItemIndex: -1,
    });
    // The sensors point the retreat to the LEFT while the ready gate sits to the right. Since
    // f7393e5c turned the retreat away from the enemy, a positive yaw sent both branches to the
    // right and the test stayed green without any gate search at all.
    policy._fallbackPolicy.getSensorSnapshot = () => ({
        targetYaw: -0.8,
        targetPitch: 0,
        pressure: 0.92,
        projectileThreat: true,
        targetPlayer: enemy,
        targetInFront: true,
        targetDistanceSq: enemy.position.lengthSq(),
    });

    const action = policy.update(1 / 60, player, {
        arena: { specialGates: [gate] },
        players: [player, enemy],
        projectiles: [],
        huntTarget: null,
    });

    const result = {
        boost: !!action?.boost,
        shootMG: !!action?.shootMG,
        yawLeft: !!action?.yawLeft,
        yawRight: !!action?.yawRight,
        shootItemIndex: Number(action?.shootItemIndex ?? -1),
    };

    assert.ok(result.boost);
    assert.ok(!result.shootMG);
    assert.ok(!result.yawLeft);
    assert.ok(result.yawRight);
    assert.strictEqual(result.shootItemIndex, -1);
});

test('Solo Hunt 2D uses a shorter fallback probe range without changing other modes', () => {
    const player = { alive: true };
    const enemy = { alive: true };
    const profile = { lookAhead: 13 };
    const seen = [];
    const fallbackPolicy = {
        usesRuntimeContext: true,
        _fallbackPolicy: { _botAI: { profile } },
        update() { seen.push(profile.lookAhead); return { yawLeft: true }; },
    };
    const policy = new HuntBridgePolicy({ autoLoadCheckpoint: false, fallbackPolicy });
    const context = {
        mode: 'HUNT', rules: { planarMode: true }, players: [player],
        navigationPlayers: [player, { alive: false }],
    };

    policy._delegateFallbackUpdate(1 / 60, player, context);
    assert.equal(profile.lookAhead, 13, 'the normal profile must be restored after sensing');
    context.navigationPlayers = [player, enemy];
    policy._delegateFallbackUpdate(1 / 60, player, context);
    context.navigationPlayers = [player];
    context.rules.planarMode = false;
    policy._delegateFallbackUpdate(1 / 60, player, context);
    context.rules.planarMode = true;
    context.mode = 'CLASSIC';
    policy._delegateFallbackUpdate(1 / 60, player, context);

    assert.deepEqual(seen, [11, 13, 13, 13]);
});
