import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';

test('player motion accepts a primitive turn-rate multiplier on the hot path', () => {
    const player = {
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

    updatePlayerMotion(player, 1, { yawInput: 1 }, 0.5);

    const rotation = new THREE.Euler().setFromQuaternion(player.quaternion, 'YXZ');
    assert.ok(Math.abs(rotation.y - 1) < 1e-9);
});
