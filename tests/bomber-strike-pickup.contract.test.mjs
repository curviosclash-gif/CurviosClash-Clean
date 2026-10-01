import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { usePlayerInventoryItem } from '../src/entities/player/PlayerInventoryOps.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import {
    BOMBER_STRIKE_PICKUP_DEFINITIONS,
} from '../src/shared/contracts/BomberStrikePickupDefinitionsContract.js';
import { getPickupDefinition } from '../src/entities/PickupRegistry.js';

function createPlayer(index, x = 0) {
    return {
        index, alive: true, hp: 100, maxHp: 100, spawnProtectionTimer: 0,
        position: new THREE.Vector3(x, 0, 0), activeEffects: [], inventory: ['BOMBER_STRIKE'], selectedItemIndex: 0,
        takeDamage(amount) {
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
        applyPowerup(type) { applyPlayerPowerup(this, type); },
    };
}

function createWorld() {
    const caller = createPlayer(0);
    const enemy = createPlayer(1);
    const manager = {
        huntEnabled: true,
        isFightOutcomeAuthority: true,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            bounds: { min: { x: -45, y: 0, z: -45 }, max: { x: 45, y: 60, z: 45 } },
            currentMapDefinition: { mapUnits: [] },
        },
        players: [caller, enemy], humanPlayers: [caller],
        particles: { spawnExplosion() {}, spawnHit() {} },
        _emitHuntDamageEvent() {}, _killPlayer() {}, _notifyPlayerFeedback() {},
    };
    caller.entityManager = manager;
    enemy.entityManager = manager;
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { manager, system, caller, enemy };
}

test('the bomber strike is a rare combat pickup', () => {
    assert.deepEqual(BOMBER_STRIKE_PICKUP_DEFINITIONS.BOMBER_STRIKE.allowedModes, ['ARCADE', 'HUNT']);
    const definition = getPickupDefinition('BOMBER_STRIKE');
    assert.equal(definition.selfUsable, true);
    assert.equal(definition.spawnWeights.CLASSIC, 0);
    assert.equal(definition.spawnWeights.HUNT, 0.225);
});

test('using the item calls one bomber that hurts enemies but never its caller', () => {
    const { system, caller, enemy } = createWorld();
    const result = usePlayerInventoryItem(caller, 'HUNT');
    assert.equal(result.ok, true);
    assert.deepEqual(caller.inventory, [], 'one use consumes the item');
    assert.equal(system.units.length, 1);
    const bomber = system.units[0];
    assert.equal(bomber.summoned, true);
    assert.equal(bomber.calledByIndex, caller.index);

    system.update(1.5);
    assert.equal(caller.hp, 100);
    assert.equal(enemy.hp, 50);
    assert.equal(bomber.bombsFired, 1);

    system.update(4);
    assert.equal(bomber.alive, false, 'the one-way overflight ends at the far edge');
    assert.equal(bomber.root?.visible ?? false, false);
    assert.equal(system.units.length, 0, 'the host retires a called bomber after its one-way flight');
    assert.equal(system.serializeNetworkState(), null, 'the expired bomber is absent from the next snapshot');
});

test('a late client creates the summoned bomber and never drops its own bombs', () => {
    const host = createWorld();
    const client = createWorld();
    applyPlayerPowerup(host.caller, 'BOMBER_STRIKE');
    host.system.update(0.5);

    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.system.units.length, 1);
    assert.equal(client.system.units[0].summoned, true);
    const enemyHp = client.enemy.hp;
    client.system.update(2);
    assert.equal(client.enemy.hp, enemyHp);
});

test('the client retires a called bomber only on an explicit empty map-unit snapshot', () => {
    const host = createWorld();
    const client = createWorld();
    assert.equal(host.system.callBomberStrike(host.caller), true);
    const liveFight = createHuntNetworkState(host.manager);
    applyHuntNetworkState(client.manager, liveFight);
    const bomber = client.system.units.find((unit) => unit.summoned);
    assert.ok(bomber, 'the client creates the called bomber from the host snapshot');

    const detached = [];
    const explosions = [];
    const root = { userData: {} };
    bomber.root = root;
    bomber.crashing = true;
    client.manager.renderer = { removeFromScene: (removedRoot) => detached.push(removedRoot) };
    client.manager.particles = { spawnExplosion: (...args) => explosions.push(args) };

    applyHuntNetworkState(client.manager, { ...liveFight, mapUnits: undefined });
    assert.equal(client.system.units.includes(bomber), true, 'undefined is not an authoritative empty snapshot');
    const legacyFight = { ...liveFight };
    delete legacyFight.mapUnits;
    applyHuntNetworkState(client.manager, legacyFight);
    assert.equal(client.system.units.includes(bomber), true, 'a missing legacy field does not delete a live unit');

    applyHuntNetworkState(client.manager, { ...liveFight, mapUnits: null });
    assert.equal(client.system.units.includes(bomber), false, 'explicit null means the host has no map units');
    assert.equal(bomber.root, null, 'the stale client visual is detached');
    assert.deepEqual(detached, [root]);
    assert.equal(explosions.length, 1, 'the client plays the final crash effect when the terminal snapshot omits the bomber');
});
