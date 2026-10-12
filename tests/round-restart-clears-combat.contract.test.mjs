import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// A new round starts from nothing: a mine or rocket of the old round must not hit the new
// one, and the machine gun heat/lockout of the old round must not mute the first shots.
function createRoundOwner() {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const shooter = {
        index: 0,
        alive: true,
        // Inactive slot: spawnAll skips it, so the test needs no spawn geometry.
        entitySlotActive: false,
        position: new THREE.Vector3(),
        shootCooldown: 0,
        getAimDirection(out) { return out.set(1, 0, 0); },
        getDirection(out) { return out.set(1, 0, 0); },
    };
    const players = [shooter];
    const projectileSystem = new ProjectileSystem({
        entityRuntimeConfig,
        players,
        arena: null,
        peekInventoryItem: () => ({ ok: true, type: 'ROCKET_MEDIUM' }),
        takeInventoryItem: () => ({ ok: true, type: 'ROCKET_MEDIUM' }),
        resolveLockOn: () => null,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    const noop = { reset() {} };
    const owner = {
        players,
        bots: [],
        _projectileSystem: projectileSystem,
        _overheatGunSystem: new OverheatGunSystem({ players }),
        _respawnSystem: noop,
        _huntScoring: noop,
        _roundOutcomeSystem: noop,
    };
    return { owner, shooter, projectileSystem };
}

test('a round restart removes mines and rockets of the previous round', () => {
    const { owner, shooter, projectileSystem } = createRoundOwner();
    assert.equal(projectileSystem.deployMine(shooter), true);
    assert.equal(projectileSystem.shootItemProjectile(shooter, 0).ok, true);
    assert.equal(projectileSystem.projectiles.length, 2, 'precondition: a mine and a rocket are out');

    new EntitySpawnOps(owner).spawnAll();

    assert.equal(projectileSystem.projectiles.length, 0, 'no projectile may survive into the next round');
    projectileSystem.dispose();
});

test('a round restart cools the machine gun and ends its lockout', () => {
    const { owner, shooter, projectileSystem } = createRoundOwner();
    const gun = owner._overheatGunSystem;
    gun._state.setOverheatValue(shooter.index, 95.3);
    gun._state.lockoutByPlayer[shooter.index] = 0.67;
    assert.ok(gun.getOverheatValue(shooter.index) > 0, 'precondition: the gun is hot');

    new EntitySpawnOps(owner).spawnAll();

    assert.equal(gun.getOverheatValue(shooter.index), 0);
    assert.ok(!(gun._state.lockoutByPlayer[shooter.index] > 0), 'the lockout must not outlive the round');
    projectileSystem.dispose();
});
