import { isGamepadInputEnabled, normalizeGamepadControls } from '../contracts/GamepadControlsContract.js';
import { applyAxisDeadzone, applyRadialDeadzone } from '../utils/InputAxisOps.js';
const MAPPING_KEYS = Object.keys(normalizeGamepadControls());
const GAMEPAD_DEADZONE = 0.15;

const INPUT_BOOLEAN_KEYS = Object.freeze([
    'pitchUp', 'pitchDown', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight', 'boost', 'boostPressed',
    'slowMo', 'slowMoPressed', 'cameraSwitch', 'dropItem', 'useItem', 'shootItem', 'shootRocket', 'shootMG', 'nextItem',
]);
const INPUT_AXIS_KEYS = Object.freeze(['pitchAxis', 'yawAxis', 'rollAxis']);

/**
 * One input from a pad and a keyboard that are both live: every boolean is an OR, and a stick
 * axis only counts while it is deflected, so a resting pad hands the axis back to the keys.
 * Chromium announces a pad on its first button press, so replacing the keyboard outright muted
 * a player the moment somebody touched a pad lying around.
 */
export function mergeGamepadWithKeyboard(gamepadInput, keyboardInput, output = {}) {
    for (const key of INPUT_BOOLEAN_KEYS) output[key] = gamepadInput[key] === true || keyboardInput[key] === true;
    for (const key of INPUT_AXIS_KEYS) {
        const value = gamepadInput[key];
        output[key] = typeof value === 'number' && value !== 0 ? value : undefined;
    }
    return output;
}

export function readGamepad(slot) {
    const pads = globalThis.navigator?.getGamepads?.();
    // Keep hardware indices stable when another controller is unplugged.
    return pads?.[slot] || null;
}

export function createGamepadInputSource(gamepadIndex = 0, getSettings = () => null, isEnabled = () => true) {
    const previous = new Uint8Array(16);
    const output = {};
    const stick = { x: 0, y: 0 };
    let settings;
    let mapping = normalizeGamepadControls();
    const updateMapping = () => {
        const next = getSettings();
        let changed = next !== settings;
        if (!changed && next) for (const key of MAPPING_KEYS) {
            if (next[key] !== undefined && next[key] !== mapping[key]) { changed = true; break; }
        }
        if (changed) { settings = next; mapping = normalizeGamepadControls(next); previous.fill(0); }
    };
    const down = (pad, key) => !!pad.buttons?.[mapping[key]]?.pressed;
    const pressed = (pad, key) => {
        const index = mapping[key];
        const held = down(pad, key);
        const edge = held && !previous[index];
        previous[index] = held ? 1 : 0;
        return edge;
    };
    const rawAxis = (pad, key) => pad.axes?.[mapping[key]];
    return {
        type: 'gamepad', playerIndex: -1, active: false, gamepadIndex,
        bind(index) { this.playerIndex = index; this.active = true; },
        unbind() { this.playerIndex = -1; this.active = false; previous.fill(0); },
        // A disabled controller reports as unplugged so every caller falls back to the keyboard.
        isConnected() { return isEnabled() && !!readGamepad(gamepadIndex); },
        clearInputState() {
            updateMapping();
            const pad = readGamepad(gamepadIndex);
            for (let i = 0; i < previous.length; i++) previous[i] = pad?.buttons?.[i]?.pressed ? 1 : 0;
        },
        poll() {
            updateMapping();
            const pad = isEnabled() ? readGamepad(gamepadIndex) : null;
            if (!pad) { previous.fill(0); return null; }
            if (globalThis.document?.hidden === true || globalThis.document?.hasFocus?.() === false) {
                this.clearInputState();
                return null;
            }
            // Yaw and pitch are judged as one stick vector so a diagonal hold keeps its direction,
            // and every axis grows from 0 at the deadzone edge instead of jumping to 0.15.
            applyRadialDeadzone(rawAxis(pad, 'yawAxis'), rawAxis(pad, 'pitchAxis'), GAMEPAD_DEADZONE, stick);
            const pitch = stick.y;
            const yaw = stick.x;
            const roll = applyAxisDeadzone(rawAxis(pad, 'rollAxis'), GAMEPAD_DEADZONE);
            output.pitchAxis = -pitch; output.yawAxis = -yaw; output.rollAxis = -roll;
            output.pitchUp = pitch < 0; output.pitchDown = pitch > 0;
            output.yawLeft = yaw < 0; output.yawRight = yaw > 0;
            output.rollLeft = roll < 0; output.rollRight = roll > 0;
            output.boost = down(pad, 'BOOST'); output.boostPressed = pressed(pad, 'BOOST');
            output.slowMo = down(pad, 'SLOWMO'); output.slowMoPressed = pressed(pad, 'SLOWMO');
            output.cameraSwitch = pressed(pad, 'CAMERA');
            output.useItem = pressed(pad, 'USE_ITEM');
            output.nextItem = pressed(pad, 'NEXT_ITEM');
            output.shootRocket = pressed(pad, 'SHOOT');
            output.shootMG = down(pad, 'SHOOT_MG');
            output.dropItem = false; output.shootItem = false;
            return output;
        },
        dispose() { this.unbind(); },
    };
}

// Read pause separately: gameplay polling stops while the pause overlay is open.
export class GamepadPauseInput {
    constructor() { this.previous = new Uint8Array(4); this.bindings = []; this.enabled = true; }
    setBindings(controls) {
        this.enabled = isGamepadInputEnabled(controls);
        for (let slot = 0; slot < 4; slot++) this.bindings[slot] = normalizeGamepadControls(controls?.[`GAMEPAD_${slot + 1}`]).PAUSE;
        this.clearInputState();
    }
    clearInputState() {
        const pads = globalThis.navigator?.getGamepads?.();
        for (let slot = 0; slot < 4; slot++) this.previous[slot] = pads?.[slot]?.buttons?.[this.bindings[slot]]?.pressed ? 1 : 0;
    }
    wasPressed() {
        if (!this.enabled) return false;
        if (globalThis.document?.hidden === true || globalThis.document?.hasFocus?.() === false) { this.clearInputState(); return false; }
        let pressed = false;
        const pads = globalThis.navigator?.getGamepads?.();
        for (let slot = 0; slot < 4; slot++) {
            const held = !!pads?.[slot]?.buttons?.[this.bindings[slot]]?.pressed;
            pressed ||= held && !this.previous[slot];
            this.previous[slot] = held ? 1 : 0;
        }
        return pressed;
    }
}
