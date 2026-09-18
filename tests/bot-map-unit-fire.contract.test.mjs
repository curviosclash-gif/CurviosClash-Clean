import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { applyBotMapUnitFire } from '../src/hunt/HuntBotMapUnitOps.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';

function setup(targets, playerOverrides = {}) {
    const registry = new TargetableRegistry();
    registry.addProvider(() => targets);
    const player = {
        index: 2,
        isBot: true,
        position: new THREE.Vector3(0, 10, 0),
        getAimDirection: (out) => out.set(0, 0, 1),
        ...playerOverrides,
    };
    const policy = { _tmpFlameAim: new THREE.Vector3(), _tmpFlameOffset: new THREE.Vector3() };
    const input = { shootMG: false };
    const context = { entityManager: { _targetableRegistry: registry } };
    return { player, policy, input, context };
}

const tankAt = (z, extra = {}) => ({ hp: 150, position: new THREE.Vector3(0, 10, z), ownerIndex: -1, ...extra });

test('a bot fires at a tank in front of its nose and inside machine gun range', () => {
    const { player, policy, input, context } = setup([tankAt(60)]);
    assert.equal(applyBotMapUnitFire(policy, input, player, context), true);
    assert.equal(input.shootMG, true);
});

test('no shot at targets behind, beside, out of range, destroyed or its own', () => {
    for (const target of [
        tankAt(-60),
        { hp: 150, position: new THREE.Vector3(60, 10, 10), ownerIndex: -1 },
        tankAt(400),
        tankAt(60, { hp: 0 }),
        tankAt(60, { ownerIndex: 2 }),
    ]) {
        const { player, policy, input, context } = setup([target]);
        applyBotMapUnitFire(policy, input, player, context);
        assert.equal(input.shootMG, false);
    }
    const own = tankAt(60);
    const { player, policy, input, context } = setup([own]);
    own.ownerPlayer = player;
    applyBotMapUnitFire(policy, input, player, context);
    assert.equal(input.shootMG, false, 'its own deployed turret');
});

test('a player shot or a lit flamethrower keeps the key as it is', () => {
    const busy = setup([tankAt(60)]);
    busy.input.shootMG = true;
    assert.equal(applyBotMapUnitFire(busy.policy, busy.input, busy.player, busy.context), false);
    assert.equal(busy.input.shootMG, true);

    const flame = setup([tankAt(60)], { hasFlamethrower: true });
    applyBotMapUnitFire(flame.policy, flame.input, flame.player, flame.context);
    assert.equal(flame.input.shootMG, false, 'the flamethrower tactics own the key');

    const empty = setup([]);
    assert.equal(applyBotMapUnitFire(empty.policy, empty.input, empty.player, {}), false);
});
