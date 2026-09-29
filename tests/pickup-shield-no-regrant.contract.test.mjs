import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
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
function createClassicPlayer(strategy) {
    const entityManager = {
        entityRuntimeConfig: RUNTIME_CONFIG,
        gameModeStrategy: strategy,
        _simulationClockMs: 0,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), 0, 0x33aaff, false, { entityManager });
    player.spawn(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 0, -1));
    return player;
}

test('a shield broken by the first hit does not come back when a second hit lands in the same frame', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const player = createClassicPlayer(strategy);
    assert.equal(isPickupTypeAllowedForMode('INVERT', 'CLASSIC'), true, 'the second projectile carries a Classic item');
    player.applyPowerup('SHIELD');
    assert.equal(player.hasShield, true, 'the picked up shield protects');

    const projectile = { type: 'INVERT', owner: null };
    strategy.resolveProjectileHitOnPlayer(player, projectile, [player], null);
    assert.equal(player.hasShield, false, 'the first hit breaks the shield');
    strategy.resolveProjectileHitOnPlayer(player, projectile, [player], null);

    assert.equal(player.hasShield, false, 'the broken shield stays broken after the second hit');
});

test('a shield broken by a trail does not come back when an item is used in the same frame', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const player = createClassicPlayer(strategy);
    player.applyPowerup('SHIELD');
    player.hasShield = false;

    player.applyPowerup('SPEED_UP');

    assert.equal(player.hasShield, false, 'using an item does not repair a broken shield');
});

test('a fresh shield pickup after a broken one protects again', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 0 });
    const player = createClassicPlayer(strategy);
    player.applyPowerup('SHIELD');
    player.hasShield = false;
    player.applyPowerup('SPEED_UP');

    player.applyPowerup('SHIELD');

    assert.equal(player.hasShield, true, 'a newly collected shield is granted');
});
