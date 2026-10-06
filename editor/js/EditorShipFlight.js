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

// Hovering is an editor action, so it takes the first of these keys the player's game
// bindings leave free.
const HOVER_CANDIDATES = Object.freeze(['Space', 'KeyH', 'KeyB']);
const KEY_LABELS = Object.freeze({
    Space: 'Leertaste', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Strg', ControlRight: 'Strg',
    AltLeft: 'Alt', AltRight: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Tab: 'Tab', Escape: 'Esc',
});

/**
 * Flight controls from the stored game settings: player one's key map and inverted pitch,
 * read through the game's own normalizer, so unset keys keep the game defaults.
 * @param {unknown} settings stored settings object (any shape)
 * @param {(source: unknown, fallback: Record<string, string>) => Record<string, string>} normalizeBindings
 */
export function resolveShipFlightControls(settings, normalizeBindings) {
    const source = settings && typeof settings === 'object' ? /** @type {Record<string, any>} */ (settings) : {};
    const keyMap = normalizeBindings(source.controls?.PLAYER_1, CONFIG_SECTIONS.KEYS.PLAYER_1);
    const usedCodes = new Set(Object.values(keyMap));
    return {
        keyMap,
        invertPitch: source.invertPitch?.PLAYER_1 === true,
        hoverCode: HOVER_CANDIDATES.find((code) => !usedCodes.has(code)) || HOVER_CANDIDATES[0],
    };
}

export const DEFAULT_SHIP_FLIGHT_CONTROLS = Object.freeze({
    keyMap: CONFIG_SECTIONS.KEYS.PLAYER_1,
    invertPitch: false,
    hoverCode: HOVER_CODES[0],
});

/** Short label of a KeyboardEvent.code for the flight hints. */
export function describeFlightKey(code) {
    const value = String(code || '');
    if (KEY_LABELS[value]) return KEY_LABELS[value];
    if (/^Key[A-Z]$/.test(value)) return value.slice(3);
    if (/^Digit\d$/.test(value)) return value.slice(5);
    if (/^Numpad\d$/.test(value)) return `Num ${value.slice(6)}`;
    return value;
}

/**
 * Maps held KeyboardEvent.code values to flight input. Codes name physical keys, so the
 * bindings stay in place on any keyboard layout.
 * @param {Set<string>} pressedCodes
 * @param {{keyMap: Record<string, string>, invertPitch?: boolean, hoverCode?: string}} [controls]
 */
export function resolveShipFlightInput(pressedCodes, controls = DEFAULT_SHIP_FLIGHT_CONTROLS) {
    const keyMap = controls.keyMap || CONFIG_SECTIONS.KEYS.PLAYER_1;
    const has = (code) => !!code && pressedCodes.has(code);
    const up = has(keyMap.UP);
    const down = has(keyMap.DOWN);
    return {
        // Same as Player.invertPitchBase in a match: the pitch keys swap.
        pitchUp: controls.invertPitch ? down : up,
        pitchDown: controls.invertPitch ? up : down,
        yawLeft: has(keyMap.LEFT),
        yawRight: has(keyMap.RIGHT),
        rollLeft: has(keyMap.ROLL_LEFT),
        rollRight: has(keyMap.ROLL_RIGHT),
        boost: has(keyMap.BOOST) || BOOST_CODES.some((code) => code !== controls.hoverCode && has(code)),
        hover: has(controls.hoverCode || HOVER_CODES[0]),
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
