import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';
import { FlamethrowerSystem } from '../src/hunt/FlamethrowerSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';
import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createTarget(id, position) {
    const target = {
        id,
        destructible: true,
        hp: 45,
        maxHp: 45,
        ownerIndex: -1,
        hitboxRadius: 2.2,
        position: new THREE.Vector3(...position),
        damage: [],
        takeDamage(amount, options = {}) {
            this.damage.push({ amount, cause: options.cause });
            this.hp = Math.max(0, this.hp - amount);
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
    return target;
}

test('the registry joins every provider into one list in registration order', () => {
    const registry = new TargetableRegistry();
    const turret = createTarget('turret', [0, 0, 0]);
    const tank = createTarget('tank', [5, 0, 0]);
    registry.addProvider(() => [turret]);
    registry.addProvider(() => [tank, null]);
    registry.addProvider(() => null);

    assert.deepEqual(registry.collect().map((entry) => entry.id), ['turret', 'tank']);
});

test('the same provider registers only once and the list is rebuilt on every call', () => {
    const registry = new TargetableRegistry();
    let targets = [createTarget('a', [0, 0, 0])];
    const provider = () => targets;
    registry.addProvider(provider);
    registry.addProvider(provider);
    registry.addProvider('not a function');

    const first = registry.collect();
    assert.equal(first.length, 1, 'a provider registered twice still counts once');
    targets = [];
    assert.equal(registry.collect().length, 0, 'a target that left its provider leaves the list');
    assert.equal(registry.collect(), first, 'the list object is reused between ticks');
});

test('the flamethrower burns a target that only the registry knows', () => {
    const registry = new TargetableRegistry();
    const tank = createTarget('tank', [0, 0, -6]);
    registry.addProvider(() => [tank]);
    const shooter = {
        index: 0,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(0, 0, 0),
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        getAimDirection: (out) => out.set(0, 0, -1),
    };
    const entityManager = {
        players: [shooter],
        arena: null,
        isFightOutcomeAuthority: true,
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        _targetableRegistry: registry,
    };
    shooter.entityManager = entityManager;
    applyPlayerPowerup(shooter, 'FLAMETHROWER');

    new FlamethrowerSystem(entityManager).fire(shooter, 0.1, true);

    assert.equal(tank.damage.length, 1, 'the target in the cone takes the flame');
    assert.equal(tank.damage[0].cause, 'FLAMETHROWER');
});

test('the runtime assembly hands static turrets to every weapon through the registry', () => {
    const owner = { players: [], runtimeConfig: {}, entityRuntimeConfig: HUNT_MODE_CONFIG };
    const support = createEntityRuntimeSupport(owner, {});
    const systems = createEntityRuntimeSystems(owner, {}, support);
    const turret = createTarget('map-turret', [0, 0, 0]);
    systems.staticTurretSystem.turrets.push(turret);

    assert.equal(owner._targetableRegistry.collect().includes(turret), true, 'the registry lists map turrets');
    assert.equal(support.projectileSystem.getTurrets().includes(turret), true, 'rockets ask the registry');
});
