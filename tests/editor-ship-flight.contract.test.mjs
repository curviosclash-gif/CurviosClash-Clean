import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { PlayerController } from '../src/entities/player/PlayerController.js';
import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';
import {
    SHIP_FLIGHT_MAX_STEP_SECONDS,
    createShipFlightParams,
    createShipFlightState,
    resolveEditorUnitsPerWorldUnit,
    resolveShipFlightInput,
    stepShipFlight,
} from '../editor/js/EditorShipFlight.js';

const STEP = 1 / 60;

function createMatchPlayer() {
    return {
        entityRuntimeConfig: null,
        turnSpeed: CONFIG_SECTIONS.PLAYER.TURN_SPEED,
        rollSpeed: CONFIG_SECTIONS.PLAYER.ROLL_SPEED,
        baseSpeed: CONFIG_SECTIONS.PLAYER.SPEED,
        speed: CONFIG_SECTIONS.PLAYER.SPEED,
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

function createPose() {
    return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
}

// A sequence that ramps every axis up, holds, flips direction and releases.
const STEERING_SCRIPT = [
    ...Array(20).fill({ pitchUp: true }),
    ...Array(15).fill({ pitchUp: true, yawLeft: true }),
    ...Array(25).fill({ yawRight: true, rollLeft: true }),
    ...Array(10).fill({ pitchDown: true, rollRight: true }),
    ...Array(20).fill({}),
];

test('editor ship turns exactly like the match ship for the same keys', () => {
    const controller = new PlayerController();
    const player = createMatchPlayer();
    const pose = createPose();
    const state = createShipFlightState();
    const params = createShipFlightParams({ unitsPerWorldUnit: 1 });

    for (const keys of STEERING_SCRIPT) {
        const control = controller.resolveControlState(player, keys, false, STEP);
        updatePlayerMotion(player, STEP, control, 1, STEP);
        stepShipFlight(state, pose, keys, params, STEP);
    }

    assert.ok(player.quaternion.angleTo(new THREE.Quaternion()) > 0.5, 'the script must actually turn the ship');
    assert.ok(pose.quaternion.angleTo(player.quaternion) < 1e-9,
        `editor and match orientation differ by ${pose.quaternion.angleTo(player.quaternion)} rad`);
});

test('the ship flies forward at match speed scaled into editor units', () => {
    const pose = createPose();
    const state = createShipFlightState();
    const params = createShipFlightParams({ unitsPerWorldUnit: 10 });

    stepShipFlight(state, pose, {}, params, 0.05);

    assert.ok(Math.abs(pose.position.z + CONFIG_SECTIONS.PLAYER.SPEED * 10 * 0.05) < 1e-9);
    assert.equal(pose.position.x, 0);
    assert.equal(pose.position.y, 0);
});

test('boost multiplies the speed and hover stops the ship while it can still turn', () => {
    const params = createShipFlightParams({ unitsPerWorldUnit: 1 });

    const boosted = createPose();
    stepShipFlight(createShipFlightState(), boosted, { boost: true }, params, 0.05);
    assert.ok(Math.abs(boosted.position.z + CONFIG_SECTIONS.PLAYER.SPEED * CONFIG_SECTIONS.PLAYER.BOOST_MULTIPLIER * 0.05) < 1e-9);

    const hovering = createPose();
    stepShipFlight(createShipFlightState(), hovering, { hover: true, lookX: 40 }, params, 0.05);
    assert.equal(hovering.position.lengthSq(), 0);
    assert.ok(hovering.quaternion.angleTo(new THREE.Quaternion()) > 0.01, 'mouse look still turns while hovering');
});

test('mouse look turns towards the mouse: right turns right, down pitches the nose down', () => {
    const params = createShipFlightParams({ unitsPerWorldUnit: 1 });
    const forward = new THREE.Vector3();

    const right = createPose();
    stepShipFlight(createShipFlightState(), right, { hover: true, lookX: 50 }, params, STEP);
    forward.set(0, 0, -1).applyQuaternion(right.quaternion);
    assert.ok(forward.x > 0.01);

    const down = createPose();
    stepShipFlight(createShipFlightState(), down, { hover: true, lookY: 50 }, params, STEP);
    forward.set(0, 0, -1).applyQuaternion(down.quaternion);
    assert.ok(forward.y < -0.01);
});

test('a long frame after a tab switch moves the ship by at most one capped step', () => {
    const pose = createPose();
    const params = createShipFlightParams({ unitsPerWorldUnit: 1 });

    stepShipFlight(createShipFlightState(), pose, {}, params, 5);

    assert.ok(Math.abs(pose.position.length() - CONFIG_SECTIONS.PLAYER.SPEED * SHIP_FLIGHT_MAX_STEP_SECONDS) < 1e-9);
});

test('the default editor arena converts with the playtest normalisation, small arenas one to one', () => {
    const mapScale = CONFIG_SECTIONS.ARENA.MAP_SCALE;
    assert.ok(Math.abs(resolveEditorUnitsPerWorldUnit({ width: 2800, height: 950, depth: 2400 }) - 35 / mapScale) < 1e-9);
    assert.equal(resolveEditorUnitsPerWorldUnit({ width: 120, height: 40, depth: 120 }), 1);
});

test('flight keys follow the match key map of player one, independent of the keyboard layout', () => {
    const keys = CONFIG_SECTIONS.KEYS.PLAYER_1;
    const input = resolveShipFlightInput(new Set([keys.UP, keys.LEFT, keys.ROLL_RIGHT, 'ShiftRight', 'Space']));
    assert.deepEqual(
        { pitchUp: input.pitchUp, pitchDown: input.pitchDown, yawLeft: input.yawLeft, yawRight: input.yawRight,
            rollLeft: input.rollLeft, rollRight: input.rollRight, boost: input.boost, hover: input.hover },
        { pitchUp: true, pitchDown: false, yawLeft: true, yawRight: false,
            rollLeft: false, rollRight: true, boost: true, hover: true },
    );
});
