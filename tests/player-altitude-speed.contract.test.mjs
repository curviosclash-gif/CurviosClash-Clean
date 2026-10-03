import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { applyPlayerPowerup, recomputePlayerEffectState } from '../src/entities/player/PlayerEffectOps.js';
import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { normalizeAltitudeSpeedFactor } from '../src/shared/contracts/AltitudeSpeedContract.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import {
    FOUR_PLAYER_PLANAR_VIEWPORT_LAYOUT,
    SPLIT_SCREEN_VARIANTS,
} from '../src/four-player-planar/FourPlayerPlanarContract.js';

const FORWARD = new THREE.Vector3(0, 0, -1);

function makePlayer(overrides = {}) {
    return {
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, PLAYER: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER, GRAVITY_STRENGTH: 10 } },
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
        activeEffects: [],
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        _tmpEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpEuler2: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpQuat: new THREE.Quaternion(),
        _tmpVec: new THREE.Vector3(),
        _tmpDir: new THREE.Vector3(),
        boostPortalDir: new THREE.Vector3(),
        slingshotForward: new THREE.Vector3(),
        slingshotUp: new THREE.Vector3(),
        altitudeSpeedFactor: 1,
        ...overrides,
    };
}

function pointForward(player, direction) {
    player.quaternion.setFromUnitVectors(FORWARD, direction.clone().normalize());
}

function step(player, dt, motionDt = dt, control = null) {
    updatePlayerMotion(player, dt, control, 1, motionDt);
}

test('altitude speed reaches the ±10% endpoints and stays at normal speed horizontally', () => {
    const horizontal = makePlayer();
    const dive = makePlayer();
    const climb = makePlayer();
    pointForward(dive, new THREE.Vector3(0, -1, 0));
    pointForward(climb, new THREE.Vector3(0, 1, 0));

    step(horizontal, 4);
    step(dive, 4);
    step(climb, 4);

    assert.equal(horizontal.speed, 10);
    assert.ok(Math.abs(dive.speed - 11) < 1e-5, `dive speed ${dive.speed}`);
    assert.ok(Math.abs(climb.speed - 9) < 1e-5, `climb speed ${climb.speed}`);
    assert.ok(dive.altitudeSpeedFactor <= 1.1 && dive.altitudeSpeedFactor >= 0.9);
    assert.ok(climb.altitudeSpeedFactor <= 1.1 && climb.altitudeSpeedFactor >= 0.9);
});

test('gravity strength supports off, default 20%, and maximum 50% without changing steering', () => {
    for (const [strength, change] of [[0, 0], [20, 0.2], [50, 0.5]]) {
        for (const vertical of [-1, 1]) {
            const player = makePlayer({
                entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, PLAYER: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER, GRAVITY_STRENGTH: strength } },
                altitudeSpeedFactor: 1.1,
            });
            pointForward(player, new THREE.Vector3(0, vertical, 0));
            const orientation = player.quaternion.clone();
            for (let frame = 0; frame < 240; frame += 1) step(player, 1 / 60);
            assert.ok(Math.abs(player.speed / player.baseSpeed - (1 - vertical * change)) < 1e-5);
            assert.ok(player.quaternion.angleTo(orientation) < 1e-7);
            if (strength === 0) assert.equal(player.altitudeSpeedFactor, 1);
        }
    }
});

test('a 30 degree climb applies a 5% target and smoothly returns to level speed', () => {
    const player = makePlayer();
    const climb30 = new THREE.Vector3(0, 0.5, -Math.sqrt(0.75));
    pointForward(player, climb30);
    for (let i = 0; i < 40; i += 1) step(player, 0.1);
    assert.ok(Math.abs(player.altitudeSpeedFactor - 0.95) < 1e-5);

    pointForward(player, new THREE.Vector3(0, 0, -1));
    for (let i = 0; i < 40; i += 1) step(player, 0.1);
    assert.ok(Math.abs(player.altitudeSpeedFactor - 1) < 1e-5);
});

test('a dive factor returns to horizontal speed without a snap or overshoot', () => {
    const player = makePlayer({ altitudeSpeedFactor: 1.1 });
    pointForward(player, new THREE.Vector3(0, 0, -1));

    step(player, 0.1);
    assert.ok(player.altitudeSpeedFactor < 1.1 && player.altitudeSpeedFactor > 1);
    for (let i = 1; i < 10; i += 1) step(player, 0.1);
    assert.ok(Math.abs(player.altitudeSpeedFactor - 1.005) < 1e-10);
    for (let i = 0; i < 30; i += 1) {
        const previous = player.altitudeSpeedFactor;
        step(player, 0.1);
        assert.ok(player.altitudeSpeedFactor <= previous && player.altitudeSpeedFactor >= 1);
    }
    assert.ok(Math.abs(player.altitudeSpeedFactor - 1) < 1e-5);
});

test('altitude speed smoothing is frame-rate independent and uses motion time', () => {
    const oneStep = makePlayer();
    const manySteps = makePlayer();
    const slowMotion = makePlayer();
    const dive = new THREE.Vector3(0, -1, 0);
    pointForward(oneStep, dive);
    pointForward(manySteps, dive);
    pointForward(slowMotion, dive);

    step(oneStep, 1, 1);
    for (let i = 0; i < 10; i += 1) step(manySteps, 0.1, 0.1);
    step(slowMotion, 2.5, 1);

    assert.ok(Math.abs(oneStep.altitudeSpeedFactor - 1.095) < 1e-10);
    assert.ok(Math.abs(manySteps.altitudeSpeedFactor - oneStep.altitudeSpeedFactor) < 1e-10);
    assert.ok(Math.abs(slowMotion.altitudeSpeedFactor - oneStep.altitudeSpeedFactor) < 1e-10);
});

test('altitude speed applies with boost and SPEED_UP while outside water', () => {
    const player = makePlayer({ boostCharge: 1 });
    pointForward(player, new THREE.Vector3(0, -1, 0));
    applyPlayerPowerup(player, 'SPEED_UP');
    step(player, 1 / 60, 4, { boostPressed: true });

    assert.equal(player.isBoosting, true);
    const boostMultiplier = resolveEntityRuntimeConfig(player).PLAYER.BOOST_MULTIPLIER;
    assert.ok(Math.abs(player.speed - player.baseSpeed * boostMultiplier * player.altitudeSpeedFactor) < 1e-9);

    const factor = player.altitudeSpeedFactor;
    recomputePlayerEffectState(player);
    assert.equal(player.altitudeSpeedFactor, factor, 'effect recomputation does not erase altitude state');
    player.manualBoostActive = false;
    step(player, 1 / 60, 1 / 60);
    assert.ok(player.baseSpeed > 10, 'SPEED_UP is folded into the permanent base speed');
    assert.ok(Math.abs(player.speed - player.baseSpeed * player.altitudeSpeedFactor) < 1e-9);
});

test('altitude speed is neutral in water, planar mode, and four-player planar runtime', () => {
    const underwater = makePlayer({ waterSubmerged: true, waterSpeedMultiplier: 0.6, altitudeSpeedFactor: 1.08 });
    const planar = makePlayer({
        entityRuntimeConfig: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG,
            GAMEPLAY: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.GAMEPLAY, PLANAR_MODE: true },
        },
        altitudeSpeedFactor: 1.08,
    });
    const fourPlayer = makePlayer({
        entityManager: {
            runtimeConfig: {
                session: {
                    splitScreenVariant: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR,
                    viewportLayout: FOUR_PLAYER_PLANAR_VIEWPORT_LAYOUT,
                },
            },
        },
        altitudeSpeedFactor: 1.08,
    });
    for (const player of [underwater, planar, fourPlayer]) pointForward(player, new THREE.Vector3(0, -1, 0));

    step(underwater, 0.25);
    step(planar, 0.25);
    step(fourPlayer, 0.25);

    assert.equal(underwater.altitudeSpeedFactor, 1);
    assert.equal(underwater.speed, 6, 'underwater retains its existing water speed multiplier');
    assert.equal(planar.altitudeSpeedFactor, 1);
    assert.equal(planar.speed, 10);
    assert.equal(fourPlayer.altitudeSpeedFactor, 1);
    assert.equal(fourPlayer.speed, 10);
});

test('altitude speed leaves steering rotation unchanged', () => {
    const altitudeEnabled = makePlayer();
    const altitudeNeutral = makePlayer({ waterSubmerged: true, waterSpeedMultiplier: 1 });
    const diveDirection = new THREE.Vector3(0, -1, 0);
    pointForward(altitudeEnabled, diveDirection);
    pointForward(altitudeNeutral, diveDirection);

    step(altitudeEnabled, 0.2, 0.2, { yawInput: 1 });
    step(altitudeNeutral, 0.2, 0.2, { yawInput: 1 });

    assert.ok(altitudeEnabled.quaternion.angleTo(altitudeNeutral.quaternion) < 1e-12);
});

test('network snapshots preserve and clamp altitude speed state while accepting legacy snapshots', () => {
    const host = {
        index: 0,
        alive: true,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        altitudeSpeedFactor: 1.075,
    };
    const snapshot = serializePlayer(host);
    assert.equal(snapshot.altitudeSpeedFactor, 1.075);
    assert.equal(serializePlayer({ ...host, altitudeSpeedFactor: 3 }).altitudeSpeedFactor, 1.5);
    for (const invalid of [null, '', undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(normalizeAltitudeSpeedFactor(invalid), 1);
    }

    const replica = {
        index: 0,
        alive: true,
        hp: 100,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        inventory: [],
        rocketInventory: [],
        activeEffects: [],
        altitudeSpeedFactor: 1,
    };
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: { players: [snapshot] } });
    reconciler.reconcile([replica]);
    assert.equal(replica.altitudeSpeedFactor, 1.075);

    replica.altitudeSpeedFactor = 1.04;
    const legacySnapshot = { ...snapshot };
    delete legacySnapshot.altitudeSpeedFactor;
    reconciler.receiveServerState({ state: { players: [legacySnapshot] } });
    reconciler.reconcile([replica]);
    assert.equal(replica.altitudeSpeedFactor, 1.04, 'older hosts leave client altitude state intact');
});
