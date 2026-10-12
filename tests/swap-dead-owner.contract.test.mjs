import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createSwapScene() {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        shootCooldown: 0,
        getAimDirection(out) { return out.set(1, 0, 0); },
        getDirection(out) { return out.set(1, 0, 0); },
    };
    const target = {
        index: 1,
        alive: true,
        position: new THREE.Vector3(3, 0, 0),
        hitboxRadius: 1,
        hasShield: false,
        powerups: [],
        isSphereInOBB: () => true,
        applyPowerup(type) { target.powerups.push(type); },
    };
    const players = [owner, target];
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players,
        arena: null,
        peekInventoryItem: () => ({ ok: true, type: 'SWAP' }),
        takeInventoryItem: () => ({ ok: true, type: 'SWAP' }),
        resolveLockOn: (_player, profile) => (profile === 'item' ? target : null),
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    return { owner, target, system };
}

test('a swap shot whose owner died in flight does not pull the target to the corpse', () => {
    const { owner, target, system } = createSwapScene();
    target.hasShield = true;
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    owner.alive = false;

    system.update(1 / 60);

    assert.deepEqual(target.position.toArray(), [3, 0, 0], 'the target stays where it was');
    assert.deepEqual(owner.position.toArray(), [0, 0, 0]);
    assert.equal(target.hasShield, true, 'a stale shot does not consume the target shield');
    assert.deepEqual(target.powerups, [], 'a swap without a living owner is not applied as a plain powerup either');
    assert.equal(system.projectiles.length, 0, 'the shot is spent');
    system.dispose();
});

test('a swap shot from an earlier life cannot pull a target to its respawned owner', () => {
    const { owner, target, system } = createSwapScene();
    target.hasShield = true;
    owner.fightSpawnedAtSeconds = 0;
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);

    owner.alive = false;
    owner.position.set(20, 0, 0);
    owner.fightSpawnedAtSeconds = 5;
    owner.alive = true;
    system.update(1 / 60);

    assert.deepEqual(target.position.toArray(), [3, 0, 0], 'the target keeps its position from the old life');
    assert.deepEqual(owner.position.toArray(), [20, 0, 0], 'the new life is not pulled back to the old target');
    assert.equal(target.hasShield, true, 'a prior-life shot does not consume the target shield');
    assert.deepEqual(target.powerups, [], 'an old-life SWAP is not applied as another powerup');
    assert.equal(system.projectiles.length, 0, 'the stale shot is spent on contact');
    system.dispose();
});

test('zero is a valid owner life marker and a same-life swap still works', () => {
    const { owner, target, system } = createSwapScene();
    owner.fightSpawnedAtSeconds = 0;

    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    const projectile = system.projectiles[0];
    assert.equal(projectile.ownerLifeSpawnedAtSeconds, 0, 'zero is captured at fire time');
    system.update(1 / 60);

    assert.deepEqual(owner.position.toArray(), [3, 0, 0]);
    assert.deepEqual(target.position.toArray(), [0, 0, 0]);
    system.dispose();
});

test('a current-life swap still consumes a target shield without exchanging positions', () => {
    const { owner, target, system } = createSwapScene();
    owner.fightSpawnedAtSeconds = 0;
    target.hasShield = true;

    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    system.update(1 / 60);

    assert.deepEqual(owner.position.toArray(), [0, 0, 0]);
    assert.deepEqual(target.position.toArray(), [3, 0, 0]);
    assert.equal(target.hasShield, false, 'a valid SWAP retains existing shield-hit behavior');
    assert.deepEqual(target.powerups, []);
    assert.equal(system.projectiles.length, 0, 'the shot is spent');
    system.dispose();
});

test('a recycled projectile captures the new life marker and legacy owners without one still swap', () => {
    const { owner, target, system } = createSwapScene();
    owner.fightSpawnedAtSeconds = 0;
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    const firstProjectile = system.projectiles[0];

    owner.alive = false;
    owner.position.set(20, 0, 0);
    owner.fightSpawnedAtSeconds = 5;
    owner.alive = true;
    system.update(1 / 60);

    assert.ok(system._projectileStatePool.includes(firstProjectile), 'the hit shot is returned to the state pool');
    assert.equal(firstProjectile.ownerLifeSpawnedAtSeconds, null, 'release clears the previous life marker');

    target.position.set(23, 0, 0);
    owner.shootCooldown = 0;
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    const recycledProjectile = system.projectiles[0];
    assert.equal(recycledProjectile, firstProjectile, 'the released state is reused');
    assert.equal(recycledProjectile.ownerLifeSpawnedAtSeconds, 5, 'the new shot captures the respawn life');
    system.update(1 / 60);
    assert.deepEqual(owner.position.toArray(), [23, 0, 0], 'a new-life swap remains effective');
    assert.deepEqual(target.position.toArray(), [20, 0, 0]);

    delete owner.fightSpawnedAtSeconds;
    owner.position.set(30, 0, 0);
    target.position.set(33, 0, 0);
    owner.shootCooldown = 0;
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    const legacyProjectile = system.projectiles[0];
    assert.equal(legacyProjectile.ownerLifeSpawnedAtSeconds, null, 'legacy callers have no life marker');
    system.update(1 / 60);
    assert.deepEqual(owner.position.toArray(), [33, 0, 0], 'legacy callers retain their prior swap behavior');
    assert.deepEqual(target.position.toArray(), [30, 0, 0]);
    system.dispose();
});
