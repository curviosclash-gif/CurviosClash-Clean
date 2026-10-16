import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';

function createPlayer() {
    return {
        entityRuntimeConfig: null,
        turnSpeed: 2,
        rollSpeed: 2,
        baseSpeed: 10,
        speed: 10,
        boostCharge: 1,
        boostTimer: 1,
        boostCooldown: 0,
        manualBoostActive: false,
        isBoosting: false,
        isBot: false,
        boostPortalTimer: 0,
        boostPortalParams: null,
        slingshotTimer: 0,
        slingshotParams: null,
        currentPlanarY: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        _tmpEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpEuler2: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpQuat: new THREE.Quaternion(),
        _tmpVec: new THREE.Vector3(),
        boostPortalDir: new THREE.Vector3(),
        slingshotForward: new THREE.Vector3(),
        slingshotUp: new THREE.Vector3(),
    };
}

test('player motion accepts a primitive turn-rate multiplier on the hot path', () => {
    const player = createPlayer();
    updatePlayerMotion(player, 1, { yawInput: 1 }, 0.5);

    const rotation = new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ');
    assert.ok(Math.abs(rotation.y - 1) < 1e-9);
});


for (const sign of [-1, 1]) {
    test(`pitch rate is independent in direction ${sign}, with shared mode, water and slow-motion factors`, () => {
        const player = createPlayer();
        player.pitchTurnSpeed = 4.5;
        player.turnSpeed = 3;
        player.waterTurnMultiplier = 0.8;
        const dt = 0.02;
        updatePlayerMotion(player, dt, { pitchInput: sign, yawInput: sign, rollInput: sign }, 0.5, dt / 0.4);
        const scale = 0.8 * 0.5 * dt / 0.4;
        const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            sign * 4.5 * scale, sign * 3 * scale, sign * 2 * 0.8 * dt / 0.4, 'YXZ'));
        assert.ok(player.quaternion.angleTo(expected) < 1e-7);
    });
}

test('legacy actors keep equal-axis rotation and a pitch change leaves yaw unchanged', () => {
    const legacy = createPlayer();
    updatePlayerMotion(legacy, 0.1, { pitchInput: 1 });
    assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(legacy.quaternion, 'YXZ').x - 0.2) < 1e-9);
    for (const pitchTurnSpeed of [0.8, 4.5, 5]) {
        const player = createPlayer();
        player.pitchTurnSpeed = pitchTurnSpeed;
        updatePlayerMotion(player, 0.1, { yawInput: 1 });
        assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ').y - 0.2) < 1e-9);
    }
});
