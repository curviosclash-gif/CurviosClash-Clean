import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { RepairDroneSystem } from '../src/entities/systems/RepairDroneSystem.js';

function createSide({ authority = true, withEffect = true } = {}) {
    const player = {
        index: 0,
        alive: true,
        hp: 50,
        maxHp: 100,
        position: new THREE.Vector3(5, 2, 9),
        quaternion: new THREE.Quaternion(),
        activeEffects: withEffect ? [{ type: 'REPAIR_DRONE', remaining: 12.5 }] : [],
    };
    const tank = {
        kind: 'tank', alive: true, hp: 80, maxHp: 150,
        position: new THREE.Vector3(8, 2, 9),
    };
    const manager = {
        players: [player],
        projectiles: [],
        isFightOutcomeAuthority: authority,
        gameModeStrategy: {
            applyHealing(target, amount) {
                const before = target.hp;
                target.hp = Math.min(target.maxHp, target.hp + amount);
                return { healed: target.hp - before, hp: target.hp };
            },
        },
        _mapUnitSystem: { units: [tank] },
    };
    const system = new RepairDroneSystem(manager);
    manager._repairDroneSystem = system;
    return { manager, system, player, tank };
}

test('the host snapshot carries repair-drone owner, pose, health and remaining time', () => {
    const host = createSide();
    host.system.update(0);
    const drone = host.system.drones[0];
    drone.takeDamage(6);
    drone.position.set(11, 4, 15);

    const snapshot = createGameStateSnapshot(host.manager, { frame: 7 });

    assert.deepEqual(snapshot.repairDrones, [{
        ownerIndex: 0,
        pos: [11, 4, 15],
        hp: 14,
        remaining: 12.5,
    }]);
});

test('a replica renders host state without healing or deciding damage', () => {
    const host = createSide();
    host.system.update(0);
    const hostDrone = host.system.drones[0];
    hostDrone.takeDamage(5);
    hostDrone.position.set(15, 6, 20);

    const client = createSide({ authority: false, withEffect: false });
    client.system.setNetworkReplica(true);
    client.system.applyNetworkState(host.system.serializeNetworkState());

    assert.equal(client.system.drones.length, 1, 'late join builds the current drone');
    const replica = client.system.drones[0];
    assert.deepEqual(replica.position.toArray(), [15, 6, 20]);
    assert.equal(replica.hp, 15);
    assert.equal(replica.remaining, 12.5);
    assert.equal(replica.takeDamage(99).hpApplied, 0, 'the client cannot damage host state');

    client.system.update(2);
    assert.equal(client.player.hp, 50, 'the client never heals its player');
    assert.equal(client.tank.hp, 80, 'the client never repairs tanks');
    assert.deepEqual(replica.position.toArray(), [15, 6, 20], 'host position remains authoritative');

    client.system.applyNetworkState([]);
    assert.equal(client.system.drones.length, 0, 'the next empty snapshot removes an expired drone');
});

test('entity manager network paths include repair drones', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(
        new URL('../src/entities/EntityManager.js', import.meta.url), 'utf8',
    ));
    assert.match(source, /_repairDroneSystem\?\.setNetworkReplica\?\.\(enabled\)/);
    assert.match(source, /_repairDroneSystem\?\.applyNetworkState\?\.\(snapshot\?\.repairDrones\)/);
});
