import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { MapSandstormSystem } from '../src/entities/systems/MapSandstormSystem.js';
import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createMapSandstormState, normalizeMapSandstorm } from '../src/shared/contracts/MapSandstormContract.js';

function makePlayer(wind = {}) {
    const windState = {
        directionX: 1,
        directionZ: 0,
        intensity: 1,
        exposure: 1,
        ...wind,
    };
    const manager = {
        _simulationClockMs: 0,
        _mapSandstormSystem: {
            getVehicleWindState(_position, out) {
                Object.assign(out, windState);
                return out;
            },
        },
    };
    const player = {
        entityManager: manager,
        entityRuntimeConfig: DEFAULT_ENTITY_RUNTIME_CONFIG,
        index: 0,
        turnSpeed: 0,
        rollSpeed: 0,
        baseSpeed: 35,
        speed: 35,
        boostCharge: 0,
        boostTimer: 0,
        boostCooldown: 1,
        manualBoostActive: false,
        isBoosting: false,
        isBot: false,
        boostPortalTimer: 0,
        slingshotTimer: 0,
        waterTurnMultiplier: 1,
        waterSpeedMultiplier: 1,
        waterSubmerged: false,
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
        _sandstormDriftVelocity: new THREE.Vector3(),
        _sandstormWindSample: { directionX: 0, directionZ: 0, intensity: 0, exposure: 0 },
        altitudeSpeedFactor: 1,
    };
    return { player, manager, windState };
}

function step(player, manager, dt) {
    manager._simulationClockMs += dt * 1000;
    updatePlayerMotion(player, dt, null, 1, dt);
}

test('active side wind gives a small, bounded lateral drift that eases in over time', () => {
    const { player, manager } = makePlayer();
    for (let index = 0; index < 120; index += 1) step(player, manager, 1 / 60);

    assert.ok(player.position.x > 1, `lateral displacement ${player.position.x}`);
    assert.ok(player.velocity.x > 0, `lateral velocity ${player.velocity.x}`);
    assert.ok(player._sandstormDriftVelocity.length() <= player.baseSpeed * 0.055 + 1e-9);
    assert.equal(player.sandstormVisualIntensity, 1);
});

test('sandstorm wind strength setting scales vehicle drift and zero disables its vehicle effect', () => {
    const normal = makePlayer();
    const stronger = makePlayer();
    stronger.manager.runtimeConfig = { gameplay: { sandstormWindStrength: 2 } };
    const disabled = makePlayer();
    disabled.manager.runtimeConfig = { gameplay: { sandstormWindStrength: 0 } };

    for (let index = 0; index < 120; index += 1) {
        step(normal.player, normal.manager, 1 / 60);
        step(stronger.player, stronger.manager, 1 / 60);
        step(disabled.player, disabled.manager, 1 / 60);
    }

    assert.ok(stronger.player._sandstormDriftVelocity.length() > normal.player._sandstormDriftVelocity.length());
    assert.ok(stronger.player._sandstormDriftVelocity.length() <= stronger.player.baseSpeed * 0.11 + 1e-9);
    assert.equal(disabled.player._sandstormDriftVelocity.lengthSq(), 0);
    assert.equal(disabled.player.sandstormVisualIntensity, 0);
});

test('a fully blocked wind leaves no force and quickly damps previously accumulated drift', () => {
    const { player, manager, windState } = makePlayer();
    for (let index = 0; index < 120; index += 1) step(player, manager, 1 / 60);
    const driftBeforeBlock = player._sandstormDriftVelocity.length();

    windState.exposure = 0;
    for (let index = 0; index < 30; index += 1) step(player, manager, 1 / 60);

    assert.ok(player._sandstormDriftVelocity.length() < driftBeforeBlock * 0.003);
    assert.equal(player.sandstormVisualIntensity, 0);
});

test('submerged vehicles do not retain sandstorm drift', () => {
    const { player, manager } = makePlayer();
    player._sandstormDriftVelocity.set(2, 0, 0);
    player.waterSubmerged = true;

    step(player, manager, 1 / 60);

    assert.equal(player._sandstormDriftVelocity.lengthSq(), 0);
    assert.equal(player.sandstormVisualIntensity, 0);
});

test('the live sandstorm supplies wind direction and intensity while authored shelter volumes block it', () => {
    let raycasts = 0;
    const entityManager = {
        arena: {
            currentMapDefinition: {
                sandstorm: {
                    enabled: true,
                    shelterVolumes: [{ id: 'room', min: [-2, 0, -2], max: [2, 8, 2] }],
                },
            },
            raycast() {
                raycasts += 1;
                return { hit: false };
            },
        },
        renderer: null,
    };
    const system = new MapSandstormSystem(entityManager);
    system.config = normalizeMapSandstorm(entityManager.arena.currentMapDefinition.sandstorm);
    system.state = createMapSandstormState({
        enabled: true,
        phase: 'ACTIVE',
        remainingSeconds: 20,
        directionIndex: 1,
        intensity: 0.75,
    });
    const wind = {};

    system.getVehicleWindState(new THREE.Vector3(5, 4, 0), wind);
    assert.equal(wind.directionX, 1);
    assert.equal(wind.directionZ, 0);
    assert.equal(wind.intensity, 0.75);
    assert.equal(wind.exposure, 1);
    assert.equal(raycasts, 3);

    system.getVehicleWindState(new THREE.Vector3(5.5, 4, 0), wind);
    assert.equal(raycasts, 3, 'nearby positions reuse the recent visibility sample');
    entityManager._simulationClockMs = 101;
    system.getVehicleWindState(new THREE.Vector3(5.5, 4, 0), wind);
    assert.equal(raycasts, 6, 'the sample refreshes after one tenth of a second');

    system.getVehicleWindState(new THREE.Vector3(0, 4, 0), wind);
    assert.equal(wind.directionX, 0);
    assert.equal(wind.directionZ, 0);
    assert.equal(wind.intensity, 0);
    assert.equal(wind.exposure, 0);
    assert.equal(raycasts, 6, 'a point in an authored shelter skips wind raycasts');
    system.dispose();
});
