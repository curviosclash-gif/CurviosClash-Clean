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
    assert.equal(system.shootItemProjectile(owner, 0).ok, true);
    owner.alive = false;

    system.update(1 / 60);

    assert.deepEqual(target.position.toArray(), [3, 0, 0], 'the target stays where it was');
    assert.deepEqual(owner.position.toArray(), [0, 0, 0]);
    assert.deepEqual(target.powerups, [], 'a swap without a living owner is not applied as a plain powerup either');
    assert.equal(system.projectiles.length, 0, 'the shot is spent');
    system.dispose();
});
