import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { applyBotLightningInput, findLightningCastIndex } from '../src/hunt/HuntBotLightningOps.js';

const at = (index, y, extra = {}) => ({ index, alive: true, spawnProtectionTimer: 0, position: new THREE.Vector3(0, y, 0), ...extra });

test('a bot calls the strike once an enemy flies clearly higher', () => {
    const bot = at(1, 40, { inventory: ['SHIELD', 'LIGHTNING'] });
    assert.equal(findLightningCastIndex(bot, [bot, at(0, 60)]), 1);
    assert.equal(findLightningCastIndex(bot, [bot, at(0, 45)]), -1, 'five units higher is not enough');
    assert.equal(findLightningCastIndex(bot, [bot, at(0, 60, { alive: false })]), -1);
    assert.equal(findLightningCastIndex(bot, [bot, at(0, 60, { spawnProtectionTimer: 1 })]), -1, 'protected players are no target');
    assert.equal(findLightningCastIndex({ ...bot, inventory: ['SHIELD'] }, [bot, at(0, 90)]), -1, 'no item, no strike');
});

test('the input gets the slot unless another item use is already chosen', () => {
    const bot = at(1, 10, { inventory: ['LIGHTNING'] });
    const context = { players: [bot, at(0, 80)] };
    const input = { useItem: -1 };
    applyBotLightningInput(input, bot, context);
    assert.equal(input.useItem, 0);
    const busy = { useItem: 2 };
    applyBotLightningInput(busy, bot, context);
    assert.equal(busy.useItem, 2);
});
