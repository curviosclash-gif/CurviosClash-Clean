import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { isPickupTypeAllowedForMode } from '../src/entities/PickupRegistry.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const RUNTIME_CONFIG = createEntityRuntimeConfig(null, CONFIG_BASE);

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

// A real vehicle in a Classic round. Hits break a shield only through hasShield = false and
// leave the SHIELD entry in activeEffects until the next effect tick removes it, so every
// effect recompute in between (a second hit, an item) sees a broken shield with its entry.
function createClassicPlayer(strategy, index, position) {
    const entityManager = {
        entityRuntimeConfig: RUNTIME_CONFIG,
        gameModeStrategy: strategy,
        _simulationClockMs: 0,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), index, 0x33aaff, false, { entityManager });
    player.spawn(position, new THREE.Vector3(1, 0, 0));
    return player;
}

function createClassicProjectileSystem(strategy, players, owner) {
    return new ProjectileSystem({
        entityRuntimeConfig: RUNTIME_CONFIG,
        players,
        getStrategy: () => strategy,
        peekInventoryItem: () => ({ ok: true, type: 'INVERT' }),
        takeInventoryItem: () => ({ ok: true, type: 'INVERT' }),
        resolveLockOn: () => players.find((player) => player !== owner && player.alive) || null,
    });
}

test('a shield broken by the first hit does not come back when a second hit lands before the effect tick', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const owner = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 0));
    const player = createClassicPlayer(strategy, 1, new THREE.Vector3(3, 20, 0));
    const players = [owner, player];
    const projectileSystem = createClassicProjectileSystem(strategy, players, owner);
    assert.equal(isPickupTypeAllowedForMode('INVERT', 'CLASSIC'), true, 'the second projectile carries a Classic item');
    player.applyPowerup('SHIELD');
    assert.equal(player.hasShield, true, 'the picked up shield protects');

    assert.equal(projectileSystem.shootItemProjectile(owner, 0).ok, true);
    projectileSystem.update(0.1);
    assert.equal(player.hasShield, false, 'the first hit breaks the shield');
    owner.shootCooldown = 0;
    assert.equal(projectileSystem.shootItemProjectile(owner, 0).ok, true);
    projectileSystem.update(0.1);

    assert.equal(player.hasShield, false, 'the broken shield stays broken after the second hit');
    assert.equal(player.invertControls, true, 'the second projectile reached the real effect recompute path');
    projectileSystem.dispose();
});

test('a shield broken by a trail does not come back when an item is used in the same frame', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const player = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 0));
    player.applyPowerup('SHIELD');
    player.hasShield = false;

    player.applyPowerup('SPEED_UP');

    assert.equal(player.hasShield, false, 'using an item does not repair a broken shield');
});

test('a fresh shield pickup after a broken one protects again', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const player = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 0));
    player.applyPowerup('SHIELD');
    player.hasShield = false;
    player.applyPowerup('SPEED_UP');

    player.applyPowerup('SHIELD');

    assert.equal(player.hasShield, true, 'a newly collected shield is granted');
});
