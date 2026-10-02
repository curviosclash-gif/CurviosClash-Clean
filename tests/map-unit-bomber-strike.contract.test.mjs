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
        _projectileSystem: { spawned: [], spawnBomberBomb(owner, position, velocity, options) {
            this.spawned.push({ owner, position: position.clone(), velocity: velocity.clone(), options });
            return {};
        } },
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
    assert.deepEqual(bomber.definition.path, [[-93.25, 60, 30], [113.25, 60, 30]]);
    assert.equal(system.units.filter((unit) => unit.summoned).length, 5);
});

test('an ordinary map bomber keeps its 1.5-second drop cadence and launches a projectile', () => {
    const { system, hit, safe, far, events } = createWorld();

    system.update(1.49);
    assert.equal(hit.hp, 100, 'the first bomb waits for its full cadence');
    system.update(0.01);

    assert.equal(hit.hp, 100, 'the release itself does not cause instant damage');
    assert.equal(system.entityManager._projectileSystem.spawned.length, 1);
    assert.equal(system.entityManager._projectileSystem.spawned[0].options.blastRadius, 15);

    hit.position.x = 90;
    system.update(1.5);
    assert.equal(system.entityManager._projectileSystem.spawned.length, 2, 'the ordinary cadence stays unchanged');
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
    system.update(0.75);
    assert.equal(system.entityManager._projectileSystem.spawned.length, 5);
    assert.equal(ally.hp, 100, 'dropping a bomb does not instantly affect teammates');
    assert.equal(enemy.hp, 100, 'the projectile has not contacted the enemy yet');
});

test('a network replica never drops authoritative bombs', () => {
    const { system, hit } = createWorld({ authority: false });
    system.setNetworkReplica(true);
    system.update(10);
    assert.equal(hit.hp, 100);
});
