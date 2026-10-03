import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const BOUNDS = { minX: -200, maxX: 200, minY: 0, maxY: 80, minZ: -200, maxZ: 200 };

function createPlayer(index, x, z, teamId = null) {
    return {
        index, teamId, alive: true, hp: 100, spawnProtectionTimer: 0,
        position: new THREE.Vector3(x, 0, z),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 }; },
    };
}

function createWorld(players, { replica = false } = {}) {
    const manager = {
        isFightOutcomeAuthority: !replica,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { bounds: BOUNDS, currentMapDefinition: { mapUnits: [] } },
        players, humanPlayers: players.slice(0, 1),
        _emitHuntDamageEvent() {},
        _killPlayer() {},
        _projectileSystem: { spawned: [], spawnBomberBomb(owner, position, velocity, options) {
            this.spawned.push({ owner, position: position.clone(), velocity: velocity.clone(), options });
            return {};
        } },
    };
    const system = new MapUnitSystem(manager);
    manager._mapUnitSystem = system;
    system.startRound();
    return { system, manager };
}

function run(system, seconds, step = 1 / 30, onStep = null) {
    for (let t = 0; t < seconds; t += step) {
        system.update(step);
        onStep?.();
    }
}

const strike = (system) => system.units.filter((unit) => unit.summoned);

test('a called strike stays over the map for 30 seconds and then leaves', () => {
    const caller = createPlayer(0, -150, 0, 'ALPHA');
    const enemies = [createPlayer(1, 100, 120, 'BRAVO'), createPlayer(2, 100, -120, 'BRAVO')];
    const { system } = createWorld([caller, ...enemies]);
    assert.equal(system.callBomberStrike(caller), true);
    run(system, 25);
    assert.equal(strike(system).length, 5, 'after 25 s all five aircraft are still hunting');
    run(system, 6);
    assert.equal(strike(system).length, 0, 'after 31 s the strike has left');
});

test('the aircraft split up over different enemies and pass over each of them', () => {
    const caller = createPlayer(0, -150, 0, 'ALPHA');
    const enemies = [
        createPlayer(1, 120, 140, 'BRAVO'), createPlayer(2, 120, -140, 'BRAVO'),
        createPlayer(3, -60, 150, 'BRAVO'), createPlayer(4, -60, -150, 'BRAVO'),
    ];
    const { system } = createWorld([caller, ...enemies]);
    system.callBomberStrike(caller);
    const closest = new Map(enemies.map((enemy) => [enemy, Infinity]));
    run(system, 24, 1 / 30, () => {
        for (const unit of strike(system)) {
            for (const enemy of enemies) {
                const d = Math.hypot(unit.position.x - enemy.position.x, unit.position.z - enemy.position.z);
                if (d < closest.get(enemy)) closest.set(enemy, d);
            }
        }
    });
    for (const [enemy, distance] of closest) {
        assert.ok(distance < 15, `enemy ${enemy.index} was overflown (closest ${distance.toFixed(1)})`);
    }
});

test('bombs fall only where they reach an enemy, and teammates are never hunted', () => {
    const caller = createPlayer(0, -150, 0, 'ALPHA');
    const ally = createPlayer(1, 60, 0, 'ALPHA');
    const enemy = createPlayer(2, 120, 100, 'BRAVO');
    const { system, manager } = createWorld([caller, ally, enemy]);
    system.callBomberStrike(caller);
    run(system, 20);
    const spawned = manager._projectileSystem.spawned;
    assert.ok(spawned.length > 0, 'the strike bombed the enemy');
    for (const bomb of spawned) {
        const fall = Math.sqrt((2 * (bomb.position.y - enemy.position.y)) / 24);
        const impactX = bomb.position.x + bomb.velocity.x * fall;
        const impactZ = bomb.position.z + bomb.velocity.z * fall;
        const toEnemy = Math.hypot(impactX - enemy.position.x, impactZ - enemy.position.z);
        assert.ok(toEnemy <= 15 * 1.5 + 0.01, `every bomb is aimed at the enemy (missed by ${toEnemy.toFixed(1)})`);
    }
    for (const unit of strike(system)) assert.notEqual(unit.bomberHunt.target, ally);
});

test('with nobody to hunt the strike circles inside the arena and drops nothing', () => {
    const caller = createPlayer(0, 0, 0, 'ALPHA');
    const { system, manager } = createWorld([caller]);
    system.callBomberStrike(caller);
    run(system, 20, 1 / 30, () => {
        for (const unit of strike(system)) {
            assert.ok(unit.position.x >= BOUNDS.minX && unit.position.x <= BOUNDS.maxX);
            assert.ok(unit.position.z >= BOUNDS.minZ && unit.position.z <= BOUNDS.maxZ);
        }
    });
    assert.equal(manager._projectileSystem.spawned.length, 0);
});

test('a replica follows the host pose of a hunting strike instead of its own path', () => {
    const caller = createPlayer(0, -150, 0, 'ALPHA');
    const enemy = createPlayer(1, 100, 150, 'BRAVO');
    const host = createWorld([caller, enemy]);
    host.system.callBomberStrike(caller);
    run(host.system, 5);
    const snapshot = host.system.serializeNetworkState();
    const replicaPlayers = [createPlayer(0, -150, 0, 'ALPHA'), createPlayer(1, 100, 150, 'BRAVO')];
    const replica = createWorld(replicaPlayers, { replica: true });
    replica.system.setNetworkReplica(true);
    replica.system.applyNetworkState(snapshot);
    const hostUnit = strike(host.system)[0];
    const replicaUnit = replica.system.units.find((unit) => unit.id === hostUnit.id);
    assert.ok(replicaUnit, 'the replica builds the called aircraft');
    assert.ok(replicaUnit.position.distanceTo(hostUnit.position) < 0.5, 'same pose as the host');
    replica.system.update(0.5);
    assert.ok(replicaUnit.position.distanceTo(hostUnit.position) < 0.5, 'a replica does not run off along the old path');
});
