import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createPlayer(index, position, hp = 100) {
    return {
        index,
        alive: true,
        isBot: false,
        hp,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(...position),
        taken: [],
        takeDamage(amount) {
            this.taken.push(amount);
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

const TANK = { id: 'tank_a', path: [[0, 0, 0], [0, 0, 400]], speed: 1, weapons: { mg: false, rocket: false } };

function createWorld({ units = [TANK], players = [] } = {}) {
    const kills = [];
    const damageEvents = [];
    const destroyed = [];
    const manager = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { checkCollisionFast: () => false, currentMapDefinition: { mapUnits: units } },
        players,
        humanPlayers: players,
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
        _killPlayer: (player, cause, options) => { player.alive = false; kills.push({ player, cause, options }); },
        _onMapUnitDestroyed: (unit, source) => destroyed.push({ unit, source }),
    };
    const registry = new TargetableRegistry();
    manager._targetableRegistry = registry;
    const system = new MapUnitSystem(manager);
    registry.addProvider(() => system.getTargets());
    system.startRound();
    return { manager, system, registry, kills, damageEvents, destroyed };
}

test('a tank takes damage until its 150 hit points are gone', () => {
    const shooter = createPlayer(0, [0, 2, -60]);
    const { system, destroyed } = createWorld({ players: [shooter] });
    const tank = system.units[0];

    const first = tank.takeDamage(60, { sourcePlayer: shooter, cause: 'ROCKET_MEDIUM' });
    assert.equal(first.remainingHp, 90);
    assert.equal(first.isDead, false);
    const second = tank.takeDamage(120, { sourcePlayer: shooter, cause: 'ROCKET_HEAVY' });
    assert.equal(second.isDead, true, 'a heavy rocket after a medium one finishes it');
    assert.equal(tank.alive, false);
    assert.deepEqual(destroyed.map((entry) => entry.source), [shooter], 'the destroyer is reported');
    assert.equal(tank.takeDamage(50).hpApplied, 0, 'a destroyed tank takes nothing more');
});

test('the blast hurts everyone near, falls off to the edge and credits the destroyer', () => {
    const shooter = createPlayer(0, [0, 2, 25]);
    const near = createPlayer(1, [0, 2.1, 10]);
    const dying = createPlayer(2, [0, 2.1, 0.5], 20);
    const safe = createPlayer(3, [0, 2.1, 5]);
    safe.spawnProtectionTimer = 1;
    const { system, kills, damageEvents } = createWorld({ players: [shooter, near, dying, safe] });
    system.units[0].takeDamage(999, { sourcePlayer: shooter, cause: 'ROCKET_MEGA' });

    assert.equal(shooter.taken.length, 0, 'the shooter stood outside the 20 unit radius');
    assert.equal(Math.round(near.taken[0]), 30, '10 units out: 40 x (1 - 0.5 x 10/20)');
    assert.equal(safe.taken.length, 0, 'spawn protection holds');
    assert.equal(kills.length, 1);
    assert.equal(kills[0].player, dying);
    assert.equal(kills[0].options.killer, shooter);
    assert.equal(kills[0].options.projectileType, 'TANK_EXPLOSION');
    assert.equal(damageEvents.every((event) => event.cause === 'TANK_EXPLOSION'), true);
});

test('a neighbouring tank takes the blast as well', () => {
    const { system } = createWorld({
        units: [TANK, { ...TANK, id: 'tank_b', path: [[15, 0, 0], [15, 0, 400]] }],
    });
    const [first, second] = system.units;
    first.takeDamage(999, { cause: 'ROCKET_MEGA' });
    assert.equal(Math.round(second.hp), 150 - 25, '15 units away: 40 x (1 - 0.5 x 15/20)');
});

test('a destroyed tank returns after 30 s at the start of its path, or never with 0', () => {
    const { system, registry } = createWorld({
        units: [TANK, { ...TANK, id: 'gone', path: [[200, 0, 0], [200, 0, 300]], respawnSeconds: 0 }],
    });
    const [tank, gone] = system.units;
    system.update(10);
    assert.equal(tank.groundPosition.z, 10);
    tank.takeDamage(999);
    gone.takeDamage(999);
    assert.deepEqual(registry.collect(), [], 'destroyed tanks leave the target list');

    system.update(29);
    assert.equal(tank.alive, false);
    system.update(1.5);
    assert.equal(tank.alive, true);
    assert.equal(tank.hp, 150);
    assert.equal(tank.groundPosition.z < 2, true, 'back at the start of the path');
    assert.equal(gone.alive, false, 'respawnSeconds 0 keeps it destroyed');
    assert.deepEqual(registry.collect(), [tank]);
});

test('rockets hit a tank through the target registry, but never the tank that fired them', () => {
    const { system, registry } = createWorld();
    const tank = system.units[0];
    const resolver = new ProjectileHitResolver({
        _tmpVec: new THREE.Vector3(),
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        getTurrets: () => registry.collect(),
        onProjectileHit() {},
    });
    const rocket = (owner) => ({
        type: 'ROCKET_MEDIUM',
        owner,
        radius: 0.5,
        position: tank.position.clone(),
        previousPosition: tank.position.clone(),
    });

    assert.equal(resolver._resolveTurretHit(rocket(tank.source), []), false, 'own rockets fly on');
    assert.equal(tank.hp, 150);
    assert.equal(resolver._resolveTurretHit(rocket(createPlayer(0, [0, 0, -50])), []), true);
    assert.equal(tank.hp, 90, 'a medium rocket takes 60');
});

test('the runtime assembly lists live tanks for every weapon', () => {
    const owner = { players: [], runtimeConfig: {} };
    const systems = createEntityRuntimeSystems(owner, {}, null);
    const tank = { id: 'fake', alive: true };
    systems.mapUnitSystem.units.push(tank);
    assert.equal(owner._targetableRegistry.collect().includes(tank), true);
    tank.alive = false;
    assert.equal(owner._targetableRegistry.collect().includes(tank), false);
});
