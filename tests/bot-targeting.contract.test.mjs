import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { selectTarget } from '../src/entities/ai/BotTargetingOps.js';

function createPlayer({
    position = [0, 0, 0],
    forward = [1, 0, 0],
    hp = 100,
    maxHp = 100,
    alive = true,
} = {}) {
    const forwardVector = new THREE.Vector3(...forward).normalize();
    return {
        position: new THREE.Vector3(...position),
        forward: forwardVector,
        hp,
        maxHp,
        alive,
        getDirection(out) {
            return out.copy(this.forward);
        },
    };
}

function createBot(previousTarget = null, profile = {}) {
    return {
        profile,
        state: { targetPlayer: previousTarget },
        sense: { targetDistanceSq: Infinity, targetInFront: false },
        _tmpForward: new THREE.Vector3(),
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpVec3: new THREE.Vector3(),
    };
}

test('Bot targeting prioritizes vulnerable targets when threat geometry is similar', () => {
    const botPlayer = createPlayer({ position: [0, 0, 0], forward: [1, 0, 0] });
    const healthyTarget = createPlayer({ position: [12, 0, 0.4], forward: [-1, 0, 0], hp: 100 });
    const vulnerableTarget = createPlayer({ position: [12.7, 0, 0.4], forward: [-1, 0, 0], hp: 8 });
    const bot = createBot();

    selectTarget(bot, botPlayer, [botPlayer, healthyTarget, vulnerableTarget]);

    assert.equal(bot.state.targetPlayer, vulnerableTarget);
    assert.equal(bot.sense.targetInFront, true);
});

test('Bot targeting keeps its previous target when a challenger is only marginally better', () => {
    const botPlayer = createPlayer();
    const previousTarget = createPlayer({ position: [10, 0, 0], forward: [-1, 0, 0] });
    const challenger = createPlayer({ position: [9.6, 0, 0], forward: [-1, 0, 0] });
    const bot = createBot(previousTarget, {
        targetRetainBonus: 0,
        targetSwitchMargin: 0.08,
        targetRetainDistance: 90,
    });

    selectTarget(bot, botPlayer, [botPlayer, previousTarget, challenger]);

    assert.equal(bot.state.targetPlayer, previousTarget);
});

test('Bot targeting switches when the new candidate is clearly better', () => {
    const botPlayer = createPlayer();
    const previousTarget = createPlayer({ position: [18, 0, 0], forward: [-1, 0, 0] });
    const closeTarget = createPlayer({ position: [6, 0, 0], forward: [-1, 0, 0] });
    const bot = createBot(previousTarget);

    selectTarget(bot, botPlayer, [botPlayer, previousTarget, closeTarget]);

    assert.equal(bot.state.targetPlayer, closeTarget);
});
