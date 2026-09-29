import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const RUNTIME_CONFIG = createEntityRuntimeConfig(null, CONFIG_BASE);

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

// A real vehicle: the gate timers only tick inside player.update, which stops for a dead
// player, so whatever push is still running at the moment of death survives until spawn.
function createPlayer() {
    const entityManager = {
        entityRuntimeConfig: RUNTIME_CONFIG,
        _simulationClockMs: 0,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), 0, 0x33aaff, false, { entityManager });
    player.spawn(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 0, -1));
    return player;
}

test('a boost gate push does not carry over into the next life', () => {
    const player = createPlayer();
    player.activateBoostPortal({ duration: 1.5, forwardImpulse: 40, bonusSpeed: 50 }, new THREE.Vector3(1, 0, 0));
    player.alive = false;

    player.spawn(new THREE.Vector3(10, 20, 0), new THREE.Vector3(0, 0, 1));

    assert.equal(player.boostPortalTimer, 0, 'the boost gate push ends with the old life');
    assert.equal(player.boostPortalParams, null, 'no boost gate strength is left for the new life');
});

test('a slingshot push does not carry over into the next life', () => {
    const player = createPlayer();
    player.activateSlingshot(
        { duration: 2, forwardImpulse: 25, liftImpulse: 5 },
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1, 0),
    );
    player.alive = false;

    player.spawn(new THREE.Vector3(10, 20, 0), new THREE.Vector3(0, 0, 1));

    assert.equal(player.slingshotTimer, 0, 'the slingshot push ends with the old life');
    assert.equal(player.slingshotParams, null, 'no slingshot strength is left for the new life');
});
