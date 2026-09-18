import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { RailgunSystem, resolveRailgunDamage } from '../src/hunt/RailgunSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { getPickupDefinition, isPickupTypeAllowedForMode } from '../src/entities/PickupRegistry.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';
import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createPlayer(index, position) {
    return {
        index,
        alive: true,
        isBot: index > 0,
        hp: 100,
        shieldHP: 0,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(...position),
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        taken: [],
        getAimDirection: (out) => out.set(0, 0, -1),
        takeDamage(amount) {
            this.taken.push(Math.round(amount * 100) / 100);
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

function createWorld({ targets = [], wallAt = null } = {}) {
    const shooter = createPlayer(0, [0, 10, 0]);
    const registry = new TargetableRegistry();
    const tanks = [];
    registry.addProvider(() => tanks);
    const kills = [];
    const events = [];
    const manager = {
        players: [shooter, ...targets],
        isFightOutcomeAuthority: true,
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        _targetableRegistry: registry,
        _emitHuntDamageEvent: (event) => events.push(event),
        _killPlayer: (player, cause, options) => { player.alive = false; kills.push({ player, options }); },
        arena: wallAt === null ? null : {
            raycast: (origin, direction, maxDistance) => (wallAt < maxDistance
                ? { hit: true, distance: wallAt, sourceName: 'Wall', point: { x: 0, y: 10, z: -wallAt } }
                : { hit: false }),
        },
    };
    shooter.entityManager = manager;
    applyPlayerPowerup(shooter, 'RAILGUN');
    return { manager, shooter, tanks, kills, events, system: new RailgunSystem(manager) };
}

function charge(system, player, seconds) {
    for (let t = 0; t < seconds - 1e-9; t += 0.1) system.fire(player, 0.1, true);
    return system.fire(player, 0.016, false);
}

test('the item arms a five shot railgun where hit points exist', () => {
    const definition = getPickupDefinition('RAILGUN');
    assert.equal(definition.duration, 30);
    assert.equal(isPickupTypeAllowedForMode('RAILGUN', 'CLASSIC'), false);
    assert.equal(isPickupTypeAllowedForMode('RAILGUN', 'HUNT'), true);
    const { shooter } = createWorld();
    assert.equal(shooter.hasRailgun, true);
    assert.equal(shooter.railShots, 5);
});

test('the damage rises from 20 when tapped to 70 after 1.5 s of charge (E81)', () => {
    const config = CONFIG_BASE.HUNT.RAILGUN;
    assert.equal(resolveRailgunDamage(0, config), 20);
    assert.equal(resolveRailgunDamage(0.75, config), 45);
    assert.equal(resolveRailgunDamage(1.5, config), 70);
    assert.equal(resolveRailgunDamage(5, config), 70, 'more charge adds nothing');
});

test('holding charges, the release fires through up to three targets in beam order', () => {
    const targets = [-20, -40, -60, -80].map((z, i) => createPlayer(i + 1, [0, 10, z]));
    const { system, shooter, events } = createWorld({ targets });
    assert.equal(system.fire(shooter, 0.5, true), true, 'the key belongs to the railgun');
    assert.equal(targets[0].taken.length, 0, 'nothing while charging');
    assert.equal(system.fire(shooter, 0.016, false), true);
    assert.deepEqual(targets.map((t) => t.taken), [[36.67], [36.67], [36.67], []], 'half a second is a third of the way to 70');
    assert.equal(events.every((event) => event.cause === 'RAILGUN' && event.sourcePlayer === shooter), true);
    assert.equal(shooter.railShots, 4);
    assert.equal(shooter.railCharge, 0);
    assert.deepEqual(system.lastBeam.to, [0, 10, -250], 'no wall: the full 250 units');
});

test('walls stop the beam, trails do not, and tanks in the line are hit too', () => {
    const near = createPlayer(1, [0, 10, -30]);
    const behindWall = createPlayer(2, [0, 10, -90]);
    const { system, shooter, tanks } = createWorld({ targets: [near, behindWall], wallAt: 60 });
    const tank = { hp: 150, hitboxRadius: 3.5, ownerIndex: -1, position: new THREE.Vector3(1, 10, -45), taken: [] };
    tank.takeDamage = (amount, options) => { tank.taken.push({ amount, cause: options.cause }); };
    tanks.push(tank);
    charge(system, shooter, 1.5);
    assert.deepEqual(near.taken, [70]);
    assert.deepEqual(tank.taken, [{ amount: 70, cause: 'RAILGUN' }]);
    assert.deepEqual(behindWall.taken, [], 'the wall at 60 stopped the beam');
    assert.deepEqual(system.lastBeam.to, [0, 10, -60]);
});

test('a kill is credited, protected and off-line players are missed, five shots empty it', () => {
    const weak = createPlayer(1, [0, 10, -30]);
    weak.hp = 15;
    const aside = createPlayer(2, [5, 10, -30]);
    const shielded = createPlayer(3, [0, 10, -50]);
    shielded.spawnProtectionTimer = 1;
    const { system, shooter, kills } = createWorld({ targets: [weak, aside, shielded] });
    charge(system, shooter, 0);
    system.fire(shooter, 0.1, true);
    system.fire(shooter, 0.016, false);
    assert.equal(kills.length, 1);
    assert.equal(kills[0].options.killer, shooter);
    assert.deepEqual(aside.taken, []);
    assert.deepEqual(shielded.taken, []);
    for (let i = 0; i < 4; i += 1) charge(system, shooter, 0.2);
    assert.equal(shooter.hasRailgun, false, 'the fifth shot ends the effect');
    assert.equal(system.fire(shooter, 0.1, true), false, 'the key goes back to the machine gun');
});

test('a replica swallows the key and never shoots', () => {
    const target = createPlayer(1, [0, 10, -30]);
    const { system, shooter, manager } = createWorld({ targets: [target] });
    manager.isFightOutcomeAuthority = false;
    assert.equal(system.fire(shooter, 0.5, true), true);
    assert.equal(system.fire(shooter, 0.016, false), false);
    assert.deepEqual(target.taken, []);
    assert.equal(shooter.railShots, 5);
});

test('the action phase gives the key to the railgun before the machine gun', () => {
    const source = PlayerActionPhase.toString();
    assert.match(source, /_railgunSystem\?\.fire\(player, dt, input\.shootMG === true\)/);
    assert.match(source, /!firedFlame && !firedRail && strategy\?\.hasMachineGun\(\)/);
});

test('review fix: no ghost shot after a respawn, and an expiring gun keeps the key until it comes up', () => {
    const target = createPlayer(1, [0, 10, -30]);
    const { system, shooter } = createWorld({ targets: [target] });
    system.fire(shooter, 1.2, true);
    // Respawn: the effects are gone, but the cached flag still says armed until player.update runs.
    shooter.activeEffects.length = 0;
    shooter.hasRailgun = true;
    assert.equal(system.fire(shooter, 0.016, false), false, 'the release fires nothing');
    assert.deepEqual(target.taken, []);
    assert.equal(shooter.railCharge, 0);

    const again = createWorld({ targets: [createPlayer(1, [0, 10, -30])] });
    again.system.fire(again.shooter, 0.8, true);
    again.shooter.activeEffects.length = 0; // the 30 seconds ran out while charging
    assert.equal(again.system.fire(again.shooter, 0.1, true), true, 'the held key stays with the dead gun');
    assert.equal(again.system.fire(again.shooter, 0.016, false), false, 'the release fires nothing');
    assert.equal(again.system.fire(again.shooter, 0.1, true), false, 'a fresh press goes to the machine gun');
});

test('review fix: a shot without a beam is not spent', () => {
    const { system, shooter } = createWorld();
    shooter.getAimDirection = (out) => out.set(0, 0, 0);
    system.fire(shooter, 0.5, true);
    system.fire(shooter, 0.016, false);
    assert.equal(shooter.railShots, 5);
});

test('the railgun has its own icon, not the lightning bolt', () => {
    assert.notEqual(getPickupDefinition('RAILGUN').icon, getPickupDefinition('LIGHTNING').icon);
});
