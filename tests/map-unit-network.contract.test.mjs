import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';

const TANK = { id: 'tank_a', path: [[0, 0, 0], [0, 0, 100], [100, 0, 100]], speed: 10, weapons: { rocket: false } };

function createSide({ authority = true } = {}) {
    const human = {
        index: 0,
        alive: true,
        isBot: false,
        hp: 100,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(0, 2.1, 40),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    };
    const manager = {
        huntEnabled: true,
        isFightOutcomeAuthority: authority,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { checkCollisionFast: () => false, currentMapDefinition: { mapUnits: [TANK] } },
        players: [human],
        humanPlayers: [human],
        _emitHuntDamageEvent() {},
        _killPlayer() {},
    };
    manager._staticTurretSystem = new StaticTurretSystem(manager);
    manager._mapUnitSystem = new MapUnitSystem(manager);
    manager._mapUnitSystem.startRound();
    return { manager, system: manager._mapUnitSystem, tank: manager._mapUnitSystem.units[0], human };
}

test('a map without tanks sends no tank block', () => {
    const manager = { huntEnabled: true, _mapUnitSystem: new MapUnitSystem({}) };
    assert.equal(createHuntNetworkState(manager).mapUnits, null);
});

test('the client takes position, hit points and aim of every tank from the host', () => {
    const host = createSide();
    const client = createSide({ authority: false });
    client.system.setNetworkReplica(true);

    for (let i = 0; i < 25; i += 1) host.system.update(0.5);
    host.tank.takeDamage(40);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));

    assert.equal(client.tank.fromIndex, host.tank.fromIndex);
    assert.equal(client.tank.toIndex, host.tank.toIndex);
    assert.deepEqual(client.tank.groundPosition.toArray().map(Math.round), host.tank.groundPosition.toArray().map(Math.round));
    assert.equal(client.tank.hp, 110);
    assert.deepEqual(
        client.tank.mounts[0].aimDirection.toArray().map((value) => Math.round(value * 100)),
        host.tank.mounts[0].aimDirection.toArray().map((value) => Math.round(value * 100)),
    );
});

test('a client never hurts anyone, but shows the host shots and the explosion', () => {
    const host = createSide();
    const client = createSide({ authority: false });
    client.system.setNetworkReplica(true);
    const tracers = [];
    client.manager._staticTurretSystem._playReplicatedShot = (mount) => tracers.push(mount.id);
    const explosions = [];
    client.manager.particles = { spawnExplosion: (position) => explosions.push(position.clone()) };

    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    for (let i = 0; i < 40; i += 1) {
        host.system.update(0.05);
        client.system.update(0.05);
    }
    assert.equal(client.human.hp, 100, 'the client tank never fires itself');
    assert.ok(host.tank.mounts[0].shotsFired > 0, 'the host tank did fire');

    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(tracers.length, 1, 'new host shots show up as a tracer');
    assert.equal(client.tank.takeDamage(999).hpApplied, 0, 'a replica tank cannot be damaged locally');

    host.tank.takeDamage(999);
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(client.tank.alive, false);
    assert.equal(client.tank.root, null, 'no renderer in this test, so no model');
    assert.equal(explosions.length, 1, 'the client sees the explosion once');
    applyHuntNetworkState(client.manager, createHuntNetworkState(host.manager));
    assert.equal(explosions.length, 1);

    client.system.update(40);
    assert.equal(client.tank.alive, false, 'a client does not bring the tank back on its own');
});

test('entity manager replica mode reaches the tanks', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/entities/EntityManager.js', import.meta.url), 'utf8'));
    assert.match(source, /_mapUnitSystem\?\.setNetworkReplica\?\.\(enabled\)/);
});
