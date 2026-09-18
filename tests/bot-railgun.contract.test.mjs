import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { applyBotRailgunInput, findRailgunArmIndex } from '../src/hunt/HuntBotRailgunOps.js';

const policy = () => ({ _tmpFlameAim: new THREE.Vector3(), _tmpFlameOffset: new THREE.Vector3() });
const at = (index, z, extra = {}) => ({ index, alive: true, spawnProtectionTimer: 0, position: new THREE.Vector3(0, 10, z), ...extra });
const bot = (extra = {}) => at(1, 0, { inventory: [], getAimDirection: (out) => out.set(0, 0, -1), ...extra });

test('the item is armed once an enemy comes within 150 units', () => {
    assert.equal(findRailgunArmIndex(bot({ inventory: ['SHIELD', 'RAILGUN'] }), [at(0, -120)]), 1);
    assert.equal(findRailgunArmIndex(bot({ inventory: ['RAILGUN'] }), [at(0, -200)]), -1, 'too far');
    assert.equal(findRailgunArmIndex(bot({ inventory: ['RAILGUN'], hasRailgun: true }), [at(0, -20)]), -1, 'already armed');
    assert.equal(findRailgunArmIndex(bot({ inventory: ['RAILGUN'], hasFlamethrower: true }), [at(0, -20)]), -1, 'the flame owns the key');
    const input = { useItem: -1 };
    const player = bot({ inventory: ['RAILGUN'] });
    applyBotRailgunInput(policy(), input, player, { players: [player, at(0, -50)] });
    assert.equal(input.useItem, 0);
});

test('an armed bot charges to 70 % and releases only with a target on its line', () => {
    const player = bot({ hasRailgun: true, railCharge: 0.5 });
    const enemy = at(0, -80);
    const input = { shootMG: false };
    applyBotRailgunInput(policy(), input, player, { players: [player, enemy] });
    assert.equal(input.shootMG, true, 'still charging');

    player.railCharge = 1.1;
    applyBotRailgunInput(policy(), input, player, { players: [player, enemy] });
    assert.equal(input.shootMG, false, 'released: the enemy is on the line');

    const aside = at(0, -80);
    aside.position.x = 40;
    applyBotRailgunInput(policy(), input, player, { players: [player, aside] });
    assert.equal(input.shootMG, true, 'no one on the line: the charge is kept');

    const tank = { hp: 150, ownerIndex: -1, position: new THREE.Vector3(0, 10, -150) };
    applyBotRailgunInput(policy(), input, player, { players: [player, aside], entityManager: { _targetableRegistry: { collect: () => [tank] } } });
    assert.equal(input.shootMG, false, 'a tank on the line is worth the shot');
});

test('review fix: a retreating bot keeps a started charge instead of wasting it', async () => {
    const { holdsRailgunCharge } = await import('../src/hunt/HuntBotRailgunOps.js');
    assert.equal(holdsRailgunCharge({ hasRailgun: true, railCharge: 0.4 }), true);
    assert.equal(holdsRailgunCharge({ hasRailgun: true, railCharge: 0 }), false);
    assert.equal(holdsRailgunCharge({ hasRailgun: false, railCharge: 0.4 }), false);
});
