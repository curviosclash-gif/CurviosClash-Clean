import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { getPickupDefinition, isPickupTypeAllowedForMode } from '../src/shared/contracts/PickupRegistryContract.js';
import { resolveRocketTierDamage, resolveRocketTrailBlastMeters } from '../src/hunt/RocketPickupSystem.js';
import { resolveBlenderPickupModel } from '../src/entities/powerup/PowerupVisualCatalog.js';

test('guided rocket is a HUNT and ARCADE pickup with the XL blast', () => {
    const pickup = getPickupDefinition('ROCKET_GUIDED');
    assert.equal(pickup?.rocketTier, 'MEGA');
    assert.equal(isPickupTypeAllowedForMode('ROCKET_GUIDED', 'HUNT'), true);
    assert.equal(isPickupTypeAllowedForMode('ROCKET_GUIDED', 'ARCADE'), true);
    assert.equal(isPickupTypeAllowedForMode('ROCKET_GUIDED', 'CLASSIC'), false);
    assert.equal(resolveRocketTierDamage('ROCKET_GUIDED'), resolveRocketTierDamage('ROCKET_MEGA'));
    assert.equal(resolveRocketTrailBlastMeters('ROCKET_GUIDED'), resolveRocketTrailBlastMeters('ROCKET_MEGA'));
    assert.equal(resolveBlenderPickupModel('ROCKET_GUIDED'), 'pickup_ROCKET_GUIDED');
});

test('guided rocket starts with a fifteen second lifetime and can hit trails', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const strategy = new HuntModeStrategy({ entityRuntimeConfig });
    const owner = {
        index: 0, alive: true, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
        shootCooldown: 0, activeEffects: [], inventory: [], rocketInventory: ['ROCKET_GUIDED'],
        getAimDirection(out) { return out.set(1, 0, 0); },
    };
    const system = new ProjectileSystem({
        entityRuntimeConfig, players: [owner], arena: { getCollisionInfo: () => null },
        getStrategy: () => strategy,
    });
    const shot = system.shootItemProjectile(owner, -1, true);
    assert.equal(shot.ok, true);
    const projectile = system.projectiles[0];
    assert.equal(projectile.ttl, 15);
    assert.equal(projectile.ignoresTrails, false);
    assert.equal(projectile.huntRocket, true);
    assert.deepEqual(owner.rocketInventory, []);
    system.dispose();
});

test('ordinary ARCADE can launch the guided rocket as a damaging rocket', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const strategy = new ArcadeModeStrategy({ entityRuntimeConfig });
    assert.equal(strategy.getPickupModeType(), 'ARCADE');
    assert.ok(strategy.resolveRocketProjectileParams('ROCKET_GUIDED', entityRuntimeConfig));
    const owner = {
        index: 0, alive: true, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
        shootCooldown: 0, activeEffects: [], inventory: [], rocketInventory: ['ROCKET_GUIDED'],
        getAimDirection(out) { return out.set(1, 0, 0); },
    };
    const system = new ProjectileSystem({ entityRuntimeConfig, players: [owner], getStrategy: () => strategy });
    assert.equal(system.shootItemProjectile(owner, -1, true).ok, true);
    assert.equal(system.projectiles[0].huntRocket, true);
    system.dispose();
});
