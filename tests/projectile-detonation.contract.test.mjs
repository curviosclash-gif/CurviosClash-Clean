import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createShooter() {
    return {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        shootCooldown: 0,
        getAimDirection(out) {
            return out.set(1, 0, 0);
        },
    };
}

function createProjectileSystem({ type = 'ROCKET_MEDIUM', onProjectileHit = () => {} } = {}) {
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
        onProjectileHit,
    });
    return { entityRuntimeConfig, owner, players, system };
}

test('hunt rockets receive three times the projectile lifetime and distance', () => {
    const { entityRuntimeConfig, owner, system } = createProjectileSystem();

    const shot = system.shootItemProjectile(owner, 0);

    assert.equal(shot.ok, true);
    assert.equal(system.projectiles.length, 1);
    assert.equal(system.projectiles[0].ttl, entityRuntimeConfig.PROJECTILE.LIFE_TIME * 3);
    assert.equal(system.projectiles[0].maxDistance, entityRuntimeConfig.PROJECTILE.MAX_DISTANCE * 3);
    system.update(entityRuntimeConfig.PROJECTILE.LIFE_TIME + 0.2);
    assert.equal(system.projectiles.length, 1);
    system.dispose();
});

test('non-rocket hunt projectiles keep the configured lifetime and distance', () => {
    const { entityRuntimeConfig, owner, system } = createProjectileSystem({ type: 'SLOW_DOWN' });

    const shot = system.shootItemProjectile(owner, 0);

    assert.equal(shot.ok, true);
    assert.equal(system.projectiles.length, 1);
    assert.equal(system.projectiles[0].ttl, entityRuntimeConfig.PROJECTILE.LIFE_TIME);
    assert.equal(system.projectiles[0].maxDistance, entityRuntimeConfig.PROJECTILE.MAX_DISTANCE);
    system.dispose();
});

test('terminal rocket outcomes emit one detonation before removal', () => {
    const detonations = [];
    const { owner, system } = createProjectileSystem({
        onProjectileHit(position, color, projectileOwner, projectile) {
            detonations.push({ position: position.clone(), color, projectileOwner, type: projectile.type });
        },
    });
    system.applyNetworkSnapshot([{
        id: 'rocket:1',
        pos: [12, 4, -3],
        vel: [1, 0, 0],
        owner: owner.index,
        type: 'ROCKET_HEAVY',
        ttl: 2,
        radius: 1,
    }], [owner]);

    system.applyNetworkSnapshot([]);

    assert.equal(system.projectiles.length, 0);
    assert.equal(detonations.length, 1);
    assert.deepEqual(detonations[0].position.toArray(), [12, 4, -3]);
    assert.equal(detonations[0].projectileOwner, owner);
    assert.equal(detonations[0].type, 'ROCKET_HEAVY');
    system.dispose();
});

test('player impacts detonate before applying their hit outcome', () => {
    const events = [];
    const { owner, players, system } = createProjectileSystem({
        onProjectileHit() {
            events.push('detonation');
        },
    });
    players.push({
        index: 1,
        alive: true,
        position: new THREE.Vector3(3, 0, 0),
        hitboxRadius: 1,
        isSphereInOBB() {
            return true;
        },
        takeDamage() {
            events.push('hit-outcome');
            return { isDead: false };
        },
    });

    system.shootItemProjectile(owner, 0);
    system.update(1 / 60);

    assert.deepEqual(events, ['detonation', 'hit-outcome']);
    system.dispose();
});

test('fast rockets sweep thin arena geometry and detonate at the impact point', () => {
    const detonations = [];
    const { owner, system } = createProjectileSystem({
        onProjectileHit(position) {
            detonations.push(position.clone());
        },
    });
    system.getArena = () => ({
        getCollisionInfo(position) {
            return position.x >= 5 && position.x <= 5.2
                ? { hit: true, kind: 'wall', normal: new THREE.Vector3(-1, 0, 0) }
                : null;
        },
    });

    system.shootItemProjectile(owner, 0);
    system.update(0.1);

    assert.equal(system.projectiles.length, 0);
    assert.equal(detonations.length, 1);
    assert.ok(detonations[0].x >= 5 && detonations[0].x <= 5.2);
    system.dispose();
});

test('network rocket replacement detonates the removed projectile', () => {
    const detonations = [];
    const { owner, system } = createProjectileSystem({
        onProjectileHit(position, color, projectileOwner, projectile) {
            detonations.push(projectile.type);
        },
    });
    system.applyNetworkSnapshot([{
        id: 'rocket:replace',
        pos: [6, 2, 1],
        vel: [1, 0, 0],
        owner: owner.index,
        type: 'ROCKET_WEAK',
        ttl: 2,
        radius: 1,
    }], [owner]);

    system.applyNetworkSnapshot([{
        id: 'rocket:replace',
        pos: [7, 2, 1],
        vel: [1, 0, 0],
        owner: owner.index,
        type: 'ROCKET_HEAVY',
        ttl: 2,
        radius: 1,
    }], [owner]);

    assert.deepEqual(detonations, ['ROCKET_WEAK']);
    assert.equal(system.projectiles[0].type, 'ROCKET_HEAVY');
    system.dispose();
});
