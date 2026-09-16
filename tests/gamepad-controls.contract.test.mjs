import assert from 'node:assert/strict';
import test from 'node:test';
import { createGamepadInputSource, GamepadPauseInput } from '../src/shared/input/GamepadInputSource.js';
import { normalizeGamepadControls } from '../src/shared/contracts/GamepadControlsContract.js';
import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import { createFourPlayerPlanarInputSource } from '../src/four-player-planar/FourPlayerPlanarInputSource.js';
import { PlayerController } from '../src/entities/player/PlayerController.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createControlBindingsSnapshot } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function hardware(t) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
    const state = { pads: [pad], pad };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => state.pads, maxTouchPoints: 0 } });
    t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
    return state;
}

test('controller axes reach PlayerController with keyboard-equivalent signs and deadzone', (t) => {
    const { pad } = hardware(t);
    const source = createGamepadInputSource();
    const controller = new PlayerController();
    for (const [index, key] of [[0, 'yawInput'], [1, 'pitchInput'], [2, 'rollInput']]) {
        for (const value of [-1, -0.5, 0.1, 0.5, 1]) {
            pad.axes[index] = value;
            const output = controller.resolveControlState({ controlRampEnabled: false }, source.poll());
            assert.equal(output[key] || 0, Math.abs(value) > 0.15 ? -value : 0);
        }
        pad.axes[index] = 0;
    }
});

test('all gameplay buttons distinguish held actions from press edges, including slow motion', (t) => {
    const { pad } = hardware(t);
    const source = createGamepadInputSource();
    for (const [button, action, held] of [[0, 'boost', true], [4, 'slowMo', true], [1, 'cameraSwitch', false], [2, 'useItem', false], [3, 'nextItem', false], [6, 'shootMG', true], [7, 'shootRocket', false]]) {
        pad.buttons[button].pressed = true;
        assert.equal(source.poll()[action], true, action);
        assert.equal(source.poll()[action], held, action);
        pad.buttons[button].pressed = false; source.poll();
    }
    pad.buttons[4].pressed = true;
    assert.equal(source.poll().slowMoPressed, true);
    assert.equal(source.poll().slowMoPressed, false);
    source.clearInputState();
    assert.equal(source.poll().slowMoPressed, false);
});

test('bindings can change during a match and malformed imports retain complete mappings', (t) => {
    const { pad } = hardware(t);
    const mapping = normalizeGamepadControls();
    const source = createGamepadInputSource(0, () => mapping);
    source.poll(); mapping.BOOST = 5; mapping.yawAxis = 3;
    pad.buttons[5].pressed = true; pad.axes[3] = 0.7;
    assert.equal(source.poll().boost, true);
    assert.equal(source.poll().yawAxis, -0.7);
    assert.deepEqual(normalizeGamepadControls({ BOOST: -1, PAUSE: 99 }), normalizeGamepadControls());
    assert.deepEqual(normalizeGamepadControls({ BOOST: 4 }), normalizeGamepadControls());
});

test('late connection, disconnection and reconnection switch between controller and keyboard', (t) => {
    const state = hardware(t); state.pads = [];
    const source = createPreferredMatchInputSource({ inputManager: { getKeyboardInput: () => ({ keyboard: true }) }, playerIndex: 0, localHumanCount: 1 });
    source.bind(0); assert.equal(source.poll().keyboard, true);
    state.pads = [state.pad]; state.pad.buttons[7].pressed = true;
    assert.equal(source.poll().shootRocket, true);
    state.pads = []; assert.equal(source.poll().keyboard, true);
    state.pads = [state.pad]; assert.equal(source.poll().shootRocket, true);
    source.dispose(); assert.equal(source.active, false);
});

test('pause works without gameplay polling and requires release before resuming', (t) => {
    const { pad } = hardware(t);
    const pause = new GamepadPauseInput(); pause.setBindings();
    pad.buttons[9].pressed = true;
    assert.equal(pause.wasPressed(), true); assert.equal(pause.wasPressed(), false);
    pause.clearInputState(); assert.equal(pause.wasPressed(), false);
    pad.buttons[9].pressed = false; assert.equal(pause.wasPressed(), false);
    pad.buttons[9].pressed = true; assert.equal(pause.wasPressed(), true);
    pause.setBindings({ GAMEPAD_1: { PAUSE: 8 } });
    pad.buttons[8].pressed = true; assert.equal(pause.wasPressed(), true);
});

test('four-player adapter accepts steering while preserving its restricted action set', (t) => {
    const { pad } = hardware(t);
    const source = createFourPlayerPlanarInputSource({ inputManager: { isDown: () => false, wasPressed: () => false }, playerIndex: 0 });
    source.bind(0); pad.axes[0] = -1; pad.axes[2] = 0.5; pad.buttons[0].pressed = true; pad.buttons[4].pressed = true;
    assert.equal(source.poll().yawAxis, 1); assert.equal(source.poll().rollAxis, -0.5);
    assert.equal(source.poll().boost, false); assert.equal(source.poll().slowMo, false);
    source.dispose();
});

test('custom mappings for all four controllers survive save, reload and runtime projection', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    for (let i = 1; i <= 4; i++) {
        const mapping = settings.controls[`GAMEPAD_${i}`];
        mapping.BOOST = 5; mapping.PAUSE = 8; mapping.yawAxis = 3;
    }
    assert.equal(manager.saveSettings(settings).success, true);
    const loaded = manager.loadSettings();
    for (let i = 1; i <= 4; i++) {
        assert.deepEqual(loaded.controls[`GAMEPAD_${i}`], settings.controls[`GAMEPAD_${i}`]);
        assert.deepEqual(createControlBindingsSnapshot(loaded.controls)[`GAMEPAD_${i}`], settings.controls[`GAMEPAD_${i}`]);
    }
});
