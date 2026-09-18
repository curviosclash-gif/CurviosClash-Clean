import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';
import { createDefensiveGuidedPolicy } from '../src/entities/ai/GuidedRocketAutopilotOps.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('defensive policy flies and boosts while suppressing every attack and item action', () => {
    const base = { type: 'heuristic', usesRuntimeContext: true, requiresObservation: true,
        update: () => ({ yawAxis: 0.8, boost: true, shootRocket: true, shootMG: true,
            shootItem: true, useItem: 0, dropItem: true, nextItem: true, cameraSwitch: true }) };
    const policy = createDefensiveGuidedPolicy(base);
    const action = policy.update(0.1, {}, {});
    assert.equal(policy.requiresObservation, true);
    assert.equal(action.yawAxis, 0.8);
    assert.equal(action.boost, true);
    for (const key of ['shootRocket', 'shootMG', 'shootItem', 'dropItem', 'nextItem', 'cameraSwitch']) {
        assert.equal(action[key], false, key);
    }
    assert.equal(action.useItem, -1);
});

test('guided owner remains human and damageable while the bot flies; impact restores control', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = {
        index: 0, alive: true, isBot: false, hp: 100, position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(), shootCooldown: 0, activeEffects: [],
        inventory: [], rocketInventory: ['ROCKET_GUIDED'],
        getAimDirection(out) { return out.set(1, 0, 0); },
        takeDamage(amount) { this.hp -= amount; },
    };
    const manager = {
        players: [owner], humanPlayers: [owner], botByPlayer: new Map(),
        botPolicyType: 'heuristic', entityRuntimeConfig,
        botPolicyRegistry: { create: () => ({ type: 'heuristic', usesRuntimeContext: true,
            update: () => ({ yawAxis: -0.6, boost: true, shootMG: true }) }) },
        createBotRuntimeContext: () => ({}),
    };
    owner.entityManager = manager;
    const system = new ProjectileSystem({ entityRuntimeConfig, players: [owner],
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }) });
    manager._projectileSystem = system;
    assert.equal(system.shootItemProjectile(owner, -1, true).ok, true);
    assert.equal(owner.autopilotActive, true);
    assert.equal(owner.isBot, false);
    owner.takeDamage(25);
    assert.equal(owner.hp, 75);
    const inputSystem = new PlayerInputSystem(manager);
    const planeInput = inputSystem.resolvePlayerInput(owner, 0.1, {
        getPlayerInput: () => ({ yawAxis: 0.7, boostPressed: true, shootRocket: true }),
    });
    assert.equal(system.projectiles[0].steerYaw, 0.7);
    assert.equal(system.projectiles[0].boostRemaining, 2);
    assert.equal(planeInput.yawAxis, -0.6);
    assert.equal(planeInput.shootMG, false);
    system._removeProjectileAt(0);
    assert.equal(owner.autopilotActive, false);
    assert.equal(manager.botByPlayer.has(owner), false);
    system.dispose();
});
