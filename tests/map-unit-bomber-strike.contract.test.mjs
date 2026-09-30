import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const BOMBER = {
    id: 'strike_bomber', kind: 'bomber', path: [[0, 30, 0], [90, 30, 0]], speed: 30,
    weapons: { bomb: { damage: 50, cooldown: 1.5, radius: 15 } },
};

function createPlayer(index, x, protectedSeconds = 0, teamId = null) {
    return {
        index, teamId, alive: true, hp: 100, spawnProtectionTimer: protectedSeconds,
        position: new THREE.Vector3(x, 0, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

function createWorld({ authority = true, mapUnits = [BOMBER] } = {}) {
    const hit = createPlayer(0, 45);
    const safe = createPlayer(1, 45, 2);
    const far = createPlayer(2, 80);
    const events = [];
    const manager = {
        isFightOutcomeAuthority: authority,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits } },
        players: [hit, safe, far], humanPlayers: [hit, safe, far],
        _emitHuntDamageEvent: (event) => events.push(event),
        _killPlayer() {},
    };
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, hit, safe, far, events };
}

test('a called bomber accepts the flat bounds shape used by the desktop arena', () => {
    const { system, hit } = createWorld();
    system.entityManager.arena.bounds = {
        minX: -120, maxX: 120, minY: 0, maxY: 80, minZ: -90, maxZ: 90,
    };
    hit.position.z = 30;

    assert.equal(system.callBomberStrike(hit), true);
    const bomber = system.units.find((unit) => unit.summoned);
    assert.ok(bomber);
    assert.deepEqual(bomber.definition.path, [[-120, 30, 30], [120, 30, 30]]);
});

test('a bomber strikes below its fixed route every one and a half seconds', () => {
    const { system, hit, safe, far, events } = createWorld();

    system.update(1.49);
    assert.equal(hit.hp, 100, 'the first bomb waits for its full cadence');
    system.update(0.01);

    assert.equal(hit.hp, 50);
    assert.equal(safe.hp, 100, 'spawn protection blocks the blast');
    assert.equal(far.hp, 100, 'the fifteen-unit radius is respected');
    assert.equal(events.length, 1);
    assert.equal(events[0].cause, 'BOMBER_BOMB');

    hit.position.x = 90;
    system.update(1.5);
    assert.equal(hit.hp, 0, 'the next cadence drops the second bomb');
});

test('a called bomber spares its caller team but still bombs a nearby enemy', () => {
    const { system, hit: caller } = createWorld({ mapUnits: [] });
    caller.teamId = 'ALPHA';
    caller.position.x = -120;
    const ally = createPlayer(3, -75, 0, 'ALPHA');
    const enemy = createPlayer(4, -75, 0, 'BRAVO');
    system.entityManager.players.push(ally, enemy);
    system.entityManager.arena.bounds = {
        minX: -120, maxX: 120, minY: 0, maxY: 80, minZ: -90, maxZ: 90,
    };

    assert.equal(system.callBomberStrike(caller), true);
    system.update(1.5);

    assert.equal(ally.hp, 100, 'the called bomber does not hit its caller team');
    assert.equal(enemy.hp, 50, 'the same bomb still damages an enemy');
});

test('a network replica never drops authoritative bombs', () => {
    const { system, hit } = createWorld({ authority: false });
    system.setNetworkReplica(true);
    system.update(10);
    assert.equal(hit.hp, 100);
});
