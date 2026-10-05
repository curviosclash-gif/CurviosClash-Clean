import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { BotAI } from '../src/entities/Bot.js';

test('a bot fires its item decision once and keeps only steering during the reaction window', () => {
    const bot = new BotAI();
    const player = { position: new THREE.Vector3(), alive: true };
    // State right after a decision that used item 1, fired a rocket and turned left.
    bot.reactionTimer = 0.2;
    bot._hasPositionSample = true;
    bot._checkStuckTimer = 10;
    Object.assign(bot.currentInput, {
        useItem: 1,
        shootItem: true,
        shootItemIndex: 1,
        shootRocket: true,
        nextItem: true,
        dropItem: true,
        yawLeft: true,
        boost: true,
    });

    for (let frame = 0; frame < 8; frame++) {
        const input = bot.update(1 / 60, player, null, [], []);
        assert.equal(input.useItem, -1, `frame ${frame}: use-item must not repeat and drain the inventory`);
        assert.equal(input.shootItem, false, `frame ${frame}: item shot must not repeat`);
        assert.equal(input.shootItemIndex, -1);
        assert.equal(input.shootRocket, false, `frame ${frame}: rocket must not repeat`);
        assert.equal(input.nextItem, false);
        assert.equal(input.dropItem, false);
        assert.equal(input.yawLeft, true, `frame ${frame}: steering stays held`);
        assert.equal(input.boost, true, `frame ${frame}: boost stays held`);
    }
});
