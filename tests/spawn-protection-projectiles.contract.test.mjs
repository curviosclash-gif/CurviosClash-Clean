import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// Der Spawnschutz (RespawnSystem: INVULNERABILITY_SECONDS) haelt Spur-, Wand-, Crash-,
// Hazard- und Turret-Treffer ab. Raketen und Minen duerfen ihn nicht umgehen, sonst ist
// ein frisch eingesetzter Spieler tot, bevor er steuern kann.
function createShooter() {
    return {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        shootCooldown: 0,
        getAimDirection(out) { return out.set(1, 0, 0); },
        getDirection(out) { return out.set(1, 0, 0); },
    };
}

function createTarget(index, x, { spawnProtectionTimer = 0 } = {}) {
    const target = {
        index,
        alive: true,
        position: new THREE.Vector3(x, 0, 0),
        hitboxRadius: 1,
        spawnProtectionTimer,
        damageTaken: 0,
        isSphereInOBB: () => true,
        takeDamage(amount) {
            target.damageTaken += amount;
            return { applied: amount, isDead: false };
        },
    };
    return target;
}

function createProjectileSystem(type = 'ROCKET_MEDIUM') {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = createShooter();
    const players = [owner];
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players,
        arena: null,
        peekInventoryItem: () => ({ ok: true, type }),
        takeInventoryItem: () => ({ ok: true, type }),
        resolveLockOn: () => null,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    return { owner, players, system };
}

test('a rocket does not damage a spawn protected player', () => {
    const { owner, players, system } = createProjectileSystem();
    const protectedTarget = createTarget(1, 3, { spawnProtectionTimer: 1.25 });
    players.push(protectedTarget);

    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    system.update(1 / 60);

    assert.equal(protectedTarget.damageTaken, 0, 'spawn protection must absorb the direct rocket hit');
    assert.equal(system.projectiles.length, 1, 'the rocket flies on instead of detonating on a protected player');
    system.dispose();
});

test('the same rocket hits once the spawn protection has run out', () => {
    const { owner, players, system } = createProjectileSystem();
    const target = createTarget(1, 3);
    players.push(target);

    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    system.update(1 / 60);

    assert.ok(target.damageTaken > 0, 'an unprotected player still takes the rocket damage');
    assert.equal(system.projectiles.length, 0);
    system.dispose();
});

test('a rocket explosion spares spawn protected bystanders', () => {
    const { owner, players, system } = createProjectileSystem();
    const directTarget = createTarget(1, 3);
    const protectedBystander = createTarget(2, 5, { spawnProtectionTimer: 1.25 });
    const exposedBystander = createTarget(3, 6);
    exposedBystander.isSphereInOBB = () => false;
    protectedBystander.isSphereInOBB = () => false;
    players.push(directTarget, protectedBystander, exposedBystander);

    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    system.update(1 / 60);

    assert.ok(directTarget.damageTaken > 0, 'the direct hit still lands');
    assert.ok(exposedBystander.damageTaken > 0, 'the splash still reaches an unprotected bystander');
    assert.equal(protectedBystander.damageTaken, 0, 'spawn protection must absorb the splash too');
    system.dispose();
});

test('a mine does not damage a spawn protected player', () => {
    const { owner, players, system } = createProjectileSystem();
    const protectedTarget = createTarget(1, -2, { spawnProtectionTimer: 1.25 });
    players.push(protectedTarget);

    assert.equal(system.deployMine(owner), true);
    system.update(1 / 60);

    assert.equal(protectedTarget.damageTaken, 0, 'a mine must not detonate on a protected player');
    assert.equal(system.projectiles.length, 1, 'the mine stays armed for a player without protection');
    system.dispose();
});
