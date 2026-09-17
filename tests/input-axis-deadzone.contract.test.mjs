import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAxisDeadzone, applyRadialDeadzone } from '../src/shared/utils/InputAxisOps.js';
import { createGamepadInputSource } from '../src/shared/input/GamepadInputSource.js';
import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import { TOUCH_CONTROL_MODES, TouchInputSource } from '../src/ui/TouchInputSource.js';

function assertClose(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${message}: expected ${expected}, got ${actual}`
    );
}

function withFakeGamepad(axes, run) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const gamepad = {
        axes,
        buttons: Array.from({ length: 12 }, () => ({ pressed: false })),
    };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { getGamepads: () => [gamepad] },
    });
    try {
        return run();
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete globalThis.navigator;
    }
}

function pollGamepadSource(axes) {
    return withFakeGamepad(axes, () => {
        // The desktop match merges this source with the keyboard (gamepad-enabled-toggle
        // covers that); the deadzone itself lives in the plain gamepad source.
        const source = createGamepadInputSource(0);
        source.bind(0);
        const polled = { ...source.poll() };
        source.dispose();
        return polled;
    });
}

test('the desktop match pairs the keyboard with a hot-pluggable gamepad', () => {
    withFakeGamepad([0, 0, 0], () => {
        const source = createPreferredMatchInputSource({
            inputManager: { getKeyboardInput: () => ({}) },
            playerIndex: 0,
            localHumanCount: 1,
            inputDeviceIndex: 0,
        });
        assert.equal(source.type, 'gamepad');
        source.dispose();
    });
});

test('applyAxisDeadzone keeps the rest position and the full deflection', () => {
    assert.equal(applyAxisDeadzone(0, 0.15), 0);
    assert.equal(applyAxisDeadzone(1, 0.15), 1);
    assert.equal(applyAxisDeadzone(-1, 0.15), -1);
});

test('applyAxisDeadzone silences everything up to the deadzone', () => {
    assert.equal(applyAxisDeadzone(0.15, 0.15), 0);
    assert.equal(applyAxisDeadzone(-0.15, 0.15), 0);
    assert.equal(applyAxisDeadzone(0.149, 0.15), 0);
});

test('applyAxisDeadzone rescales the remaining travel to the full range', () => {
    assertClose(applyAxisDeadzone(0.575, 0.15), 0.5, 'half travel above the deadzone');
    assertClose(applyAxisDeadzone(-0.575, 0.15), -0.5, 'half travel below the deadzone');
});

test('applyAxisDeadzone clamps out of range values and rejects garbage', () => {
    assert.equal(applyAxisDeadzone(1.7, 0.15), 1);
    assert.equal(applyAxisDeadzone(-4, 0.15), -1);
    assert.equal(applyAxisDeadzone(Number.NaN, 0.15), 0);
    assert.equal(applyAxisDeadzone('left', 0.15), 0);
    assert.equal(applyAxisDeadzone(0.4, 0), 0.4);
});

test('applyRadialDeadzone judges the stick by its vector length, not per axis', () => {
    // Length 0.141 stays inside the rest zone even though a per axis rule would
    // measure the same 0.1 on both axes.
    const inside = applyRadialDeadzone(0.1, 0.1, 0.15);
    assert.equal(inside.x, 0);
    assert.equal(inside.y, 0);

    // Length 0.156 is a real diagonal hold, while a per axis rule would silence
    // it because neither 0.11 alone reaches the deadzone.
    const diagonal = applyRadialDeadzone(0.11, -0.11, 0.15);
    assert.ok(diagonal.x > 0);
    assert.ok(diagonal.y < 0);
    assertClose(diagonal.x, -diagonal.y, 'diagonal stays symmetric');
});

test('applyRadialDeadzone rescales the magnitude and keeps the direction', () => {
    const scaled = applyRadialDeadzone(0, -0.5, 0.15);
    assert.equal(scaled.x, 0);
    assertClose(scaled.y, -(0.35 / 0.85), 'rescaled magnitude on the y axis');

    const diagonal = applyRadialDeadzone(0.6, 0.8, 0.15);
    const magnitude = Math.hypot(diagonal.x, diagonal.y);
    assertClose(magnitude, 1, 'full deflection stays full');
    assertClose(diagonal.x / diagonal.y, 0.6 / 0.8, 'direction is preserved');
});

test('applyRadialDeadzone clamps magnitudes beyond one', () => {
    const clamped = applyRadialDeadzone(3, 4, 0.15);
    assertClose(Math.hypot(clamped.x, clamped.y), 1, 'magnitude clamped to one');
    assertClose(clamped.x, 0.6, 'x clamped');
    assertClose(clamped.y, 0.8, 'y clamped');
});

test('applyRadialDeadzone reuses the output object without allocating', () => {
    const out = { x: 0, y: 0 };
    const returned = applyRadialDeadzone(0.5, 0, 0.15, out);
    assert.equal(returned, out);
    assertClose(out.x, 0.35 / 0.85, 'rescaled x written into the reused object');
    assert.equal(out.y, 0);
});

test('applyRadialDeadzone rejects non numeric components', () => {
    const result = applyRadialDeadzone(Number.NaN, 'up', 0.15);
    assert.equal(result.x, 0);
    assert.equal(result.y, 0);
});

test('gamepad stick deflection grows from zero instead of jumping', () => {
    const polled = pollGamepadSource([0.5, 0, 0]);
    assertClose(polled.yawAxis, -(0.35 / 0.85), 'yaw axis rescaled above the deadzone');
    assertClose(polled.pitchAxis, 0, 'untouched pitch axis stays at rest');
    assert.equal(polled.yawRight, true);
    assert.equal(polled.yawLeft, false);
});

test('gamepad roll axis uses the same rescaling', () => {
    const polled = pollGamepadSource([0, 0, 0.575]);
    assertClose(polled.rollAxis, -0.5, 'roll axis rescaled above the deadzone');
    assert.equal(polled.rollRight, true);
    assert.equal(polled.rollLeft, false);
});

test('gamepad booleans agree with the scaled axis exactly at the deadzone', () => {
    const polled = pollGamepadSource([0.15, 0, 0.15]);
    assertClose(polled.yawAxis, 0, 'yaw axis stays silent at the deadzone');
    assertClose(polled.rollAxis, 0, 'roll axis stays silent at the deadzone');
    assert.equal(polled.yawLeft, false);
    assert.equal(polled.yawRight, false);
    assert.equal(polled.rollLeft, false);
    assert.equal(polled.rollRight, false);
});

test('touch joystick deflection is rescaled above the deadzone', () => {
    const source = new TouchInputSource({ controlMode: TOUCH_CONTROL_MODES.JOYSTICK });
    source._joystickDelta = { x: 0, y: -0.5 };

    const polled = source.poll();

    assertClose(polled.pitchAxis, 0.35 / 0.85, 'touch pitch axis rescaled');
    assert.equal(polled.pitchUp, true);
    assertClose(polled.yawAxis, 0, 'untouched yaw axis stays at rest');
});
