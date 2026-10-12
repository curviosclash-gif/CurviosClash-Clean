import * as THREE from 'three';
import { CONFIG_SECTIONS } from '../../src/core/config/ConfigSections.js';
import { getCustomMapConversionScale } from '../../src/entities/CustomMapLoader.js';
import { getRuntimeMapScale } from '../../src/shared/contracts/RuntimeMapCatalogContract.js';
import {
    DEFAULT_AXIS_ATTACK_RATE,
    DEFAULT_AXIS_RELEASE_RATE,
    advanceSteeringAxis,
    applySteeringReleaseDeadzone,
    createSteeringRampState,
    digitalAxisInput,
} from '../../src/shared/input/SteeringRampOps.js';

// Ship flight for the map editor. It uses the match's steering ramp and repeats the
// per-frame rotation of updatePlayerMotion (PlayerMotionOps.js), so a gap that feels
// flyable here is flyable in a match; editor-ship-flight.contract.test.mjs compares
// both. Pure: keys, mouse deltas and dt are handed in, nothing reads a clock or the DOM.

export const SHIP_FLIGHT_MAX_STEP_SECONDS = 0.1;
export const SHIP_FLIGHT_MOUSE_RADIANS_PER_PIXEL = 0.0022;
export const SHIP_FLIGHT_SPEED_FACTORS = Object.freeze([0.25, 0.5, 1, 2, 4]);

const RAMP_RATES = Object.freeze({ attackRate: DEFAULT_AXIS_ATTACK_RATE, releaseRate: DEFAULT_AXIS_RELEASE_RATE });
const HOVER_CODES = Object.freeze(['Space']);
const BOOST_CODES = Object.freeze(['ShiftLeft', 'ShiftRight']);

function positive(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * Editor units per match world unit: the export divides by the conversion scale,
 * the match multiplies map units by MAP_SCALE.
 * @param {{width?: number, height?: number, depth?: number}} arenaSize
 */
export function resolveEditorUnitsPerWorldUnit(arenaSize) {
    const conversion = getCustomMapConversionScale({ arenaSize }).scale;
    return positive(conversion, 1) / positive(getRuntimeMapScale(1), 1);
}

export function createShipFlightParams({ unitsPerWorldUnit = 1, player = CONFIG_SECTIONS.PLAYER } = {}) {
    const units = positive(unitsPerWorldUnit, 1);
    return {
        speed: positive(player?.SPEED, 45) * units,
        turnSpeed: positive(player?.TURN_SPEED, 3.4),
        rollSpeed: positive(player?.ROLL_SPEED, 3),
        boostMultiplier: positive(player?.BOOST_MULTIPLIER, 2.3),
        hitboxRadius: positive(player?.HITBOX_RADIUS, 0.8) * units,
        unitsPerWorldUnit: units,
    };
}

export function createShipFlightState() {
    return {
        ramp: createSteeringRampState(),
        speedFactor: 1,
        euler: new THREE.Euler(0, 0, 0, 'YXZ'),
        turn: new THREE.Quaternion(),
        forward: new THREE.Vector3(),
    };
}

/**
 * Maps held KeyboardEvent.code values to flight input with the match key map of player one.
 * Codes name physical keys, so W/A/S/D stay in place on any keyboard layout.
 * @param {Set<string>} pressedCodes
 * @param {Record<string, string>} [keyMap]
 */
export function resolveShipFlightInput(pressedCodes, keyMap = CONFIG_SECTIONS.KEYS.PLAYER_1) {
    const has = (code) => !!code && pressedCodes.has(code);
    return {
        pitchUp: has(keyMap.UP),
        pitchDown: has(keyMap.DOWN),
        yawLeft: has(keyMap.LEFT),
        yawRight: has(keyMap.RIGHT),
        rollLeft: has(keyMap.ROLL_LEFT),
        rollRight: has(keyMap.ROLL_RIGHT),
        boost: has(keyMap.BOOST) || BOOST_CODES.some(has),
        hover: HOVER_CODES.some(has),
        lookX: 0,
        lookY: 0,
    };
}

/**
 * Advances the pose by one frame. The pose looks down its local -Z axis, like a
 * match ship and like a three.js camera, so a camera can be flown directly.
 */
export function stepShipFlight(state, pose, input, params, dt) {
    const step = Math.min(SHIP_FLIGHT_MAX_STEP_SECONDS, Number.isFinite(dt) && dt > 0 ? dt : 0);
    if (step <= 0) return pose;

    const pitch = applySteeringReleaseDeadzone(advanceSteeringAxis(
        state.ramp, 'pitch', digitalAxisInput(input?.pitchUp, input?.pitchDown), Number.NaN, RAMP_RATES, step));
    const yaw = applySteeringReleaseDeadzone(advanceSteeringAxis(
        state.ramp, 'yaw', digitalAxisInput(input?.yawLeft, input?.yawRight), Number.NaN, RAMP_RATES, step));
    const roll = applySteeringReleaseDeadzone(advanceSteeringAxis(
        state.ramp, 'roll', digitalAxisInput(input?.rollLeft, input?.rollRight), Number.NaN, RAMP_RATES, step));

    const turnStep = params.turnSpeed * step;
    state.euler.set(pitch * turnStep, yaw * turnStep, roll * params.rollSpeed * step, 'YXZ');
    pose.quaternion.multiply(state.turn.setFromEuler(state.euler));

    // Mouse look turns directly, without the ramp, so the crosshair stays on the mouse.
    const lookX = Number(input?.lookX) || 0;
    const lookY = Number(input?.lookY) || 0;
    if (lookX !== 0 || lookY !== 0) {
        state.euler.set(
            -lookY * SHIP_FLIGHT_MOUSE_RADIANS_PER_PIXEL,
            -lookX * SHIP_FLIGHT_MOUSE_RADIANS_PER_PIXEL,
            0,
            'YXZ'
        );
        pose.quaternion.multiply(state.turn.setFromEuler(state.euler));
    }
    pose.quaternion.normalize();

    if (input?.hover) return pose;
    const speed = params.speed * positive(state.speedFactor, 1) * (input?.boost ? params.boostMultiplier : 1);
    state.forward.set(0, 0, -1).applyQuaternion(pose.quaternion);
    pose.position.addScaledVector(state.forward, speed * step);
    return pose;
}
