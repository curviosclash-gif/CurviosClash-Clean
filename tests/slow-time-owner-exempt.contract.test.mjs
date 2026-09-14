import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { getPickupDefinition } from '../src/shared/contracts/PickupRegistryContract.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import {
    resolveGlobalSlowTimeScale,
    resolveOwnerTimeCompensation,
} from '../src/entities/player/PlayerTimeScaleOps.js';
import { Player } from '../src/entities/Player.js';
import { PlayerLifecycleSystem } from '../src/entities/systems/PlayerLifecycleSystem.js';

const CLASSIC_CONFIG = createEntityRuntimeConfig(null, {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
});

function createEffectPlayer(index, entityManager) {
    return {
        index,
        alive: true,
        entityManager,
        entityRuntimeConfig: CLASSIC_CONFIG,
        activeEffects: [],
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
        shootCooldown: 0,
        hasSlowTime: false,
        slowTimeExemptsOwner: false,
    };
}

function createRoster() {
    const entityManager = { players: [], entityRuntimeConfig: CLASSIC_CONFIG };
    const owner = createEffectPlayer(0, entityManager);
    const other = createEffectPlayer(1, entityManager);
    entityManager.players.push(owner, other);
    return { entityManager, owner, other };
}

test('slow time: the definition marks its owner as exempt from the slowdown', () => {
    assert.equal(getPickupDefinition('SLOW_TIME').timeScaleExemptsOwner, true);
    assert.equal(getPickupDefinition('SLOW_TIME').timeScale, 0.4);
    // Only an explicit true exempts; every other definition stays a plain slowdown.
    assert.notEqual(getPickupDefinition('SLOW_DOWN').timeScaleExemptsOwner, true);
    assert.notEqual(getPickupDefinition('SPEED_UP').timeScaleExemptsOwner, true);
});

test('slow time: applying the pickup flags only the owner as exempt', () => {
    const { owner, other } = createRoster();
    applyPlayerPowerup(owner, 'SLOW_TIME');

    assert.equal(owner.hasSlowTime, true);
    assert.equal(owner.slowTimeScale, 0.4);
    assert.equal(owner.slowTimeExemptsOwner, true);
    assert.equal(other.hasSlowTime, false);
    assert.equal(other.slowTimeExemptsOwner, false);
});

test('slow time: the owner gets the inverse of the global scale, everyone else keeps 1', () => {
    const { entityManager, owner, other } = createRoster();
    assert.equal(resolveGlobalSlowTimeScale(entityManager.players), 1);
    assert.equal(resolveOwnerTimeCompensation(owner), 1);

    applyPlayerPowerup(owner, 'SLOW_TIME');
    assert.equal(resolveGlobalSlowTimeScale(entityManager.players), 0.4);
    assert.equal(resolveOwnerTimeCompensation(owner), 2.5);
    assert.equal(resolveOwnerTimeCompensation(other), 1, 'the slowed player is not compensated');

    // A slow-time owner whose definition does not exempt them stays slowed like everyone else.
    owner.slowTimeExemptsOwner = false;
    assert.equal(resolveOwnerTimeCompensation(owner), 1);
});

test('slow time: the shoot cooldown of the owner runs in real time', () => {
    const { entityManager, owner, other } = createRoster();
    applyPlayerPowerup(owner, 'SLOW_TIME');
    owner.shootCooldown = 1;
    other.shootCooldown = 1;
    const lifecycle = new PlayerLifecycleSystem(entityManager);

    // The loop hands over a slowed step: 0.4 of a 0.1 s frame.
    lifecycle.updateShootCooldown(owner, 0.04);
    lifecycle.updateShootCooldown(other, 0.04);

    assert.ok(Math.abs(owner.shootCooldown - 0.9) < 1e-9, `owner cooldown ${owner.shootCooldown}`);
    assert.ok(Math.abs(other.shootCooldown - 0.96) < 1e-9, `other cooldown ${other.shootCooldown}`);
});

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

function flyStraight(motionScale) {
    const entityManager = { players: [], entityRuntimeConfig: CLASSIC_CONFIG, getTrailSpatialIndex() { return null; } };
    const player = new Player(createRenderer(), 0, 0x33aaff, true, { entityManager });
    entityManager.players.push(player);
    player.spawn(new THREE.Vector3(0, 5, 0));
    const start = player.position.clone();
    const slowedStep = 0.4 / 60;
    for (let i = 0; i < 60; i += 1) {
        player.update(slowedStep, null, i + 1, null, motionScale);
    }
    return player.position.distanceTo(start);
}

test('slow time: a compensated motion scale moves the owner in real time on a slowed loop', () => {
    const slowed = flyStraight(1);
    const compensated = flyStraight(2.5);
    assert.ok(slowed > 0, 'the player has to move at all');
    const ratio = compensated / slowed;
    assert.ok(Math.abs(ratio - 2.5) < 0.01, `expected 2.5x distance, got ${ratio.toFixed(3)}x`);
    // 60 slowed steps of 0.4/60 s compensated by 2.5 equal one real second at base speed.
    assert.ok(Math.abs(compensated - CONFIG_BASE.PLAYER.SPEED) < 0.05, `expected ~${CONFIG_BASE.PLAYER.SPEED}, got ${compensated.toFixed(3)}`);
});
