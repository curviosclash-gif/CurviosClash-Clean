import assert from 'node:assert/strict';
import test from 'node:test';
import { InputManager } from '../src/core/InputManager.js';
import { GamepadPauseInput } from '../src/shared/input/GamepadInputSource.js';
import { resolvePlayerGamepadIndex } from '../src/core/input/GamepadRumble.js';
import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import { createFourPlayerPlanarInputSource } from '../src/four-player-planar/FourPlayerPlanarInputSource.js';
import { createGamepadControlsSnapshot, isGamepadInputEnabled } from '../src/shared/contracts/GamepadControlsContract.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createControlBindingsSnapshot } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function setup(t, { layout = 'auto', localHumanCount = 1 } = {}) {
    const pads = Array.from({ length: 2 }, () => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }));
    const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    const restores = [];
    for (const [key, value] of Object.entries({ document: doc, window: { document: doc, addEventListener() {}, removeEventListener() {} }, navigator: { getGamepads: () => pads, maxTouchPoints: 0 } })) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        restores.push(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
    }
    const input = new InputManager();
    // Dispose needs the fake window, so it runs before the globals are restored.
    t.after(() => { input.dispose(); restores.forEach((restore) => restore()); });
    const controls = { ...input.getBindings(), ...createGamepadControlsSnapshot({ SPLITSCREEN: { layout } }) };
    const game = { settings: { controls, localSettings: {} } };
    input.setBindings(controls);
    for (let playerIndex = 0; playerIndex < localHumanCount; playerIndex++) {
        input.setPlayerSource(playerIndex, createPreferredMatchInputSource({ inputManager: input, playerIndex, localHumanCount, game }));
    }
    // Mirrors the menu toggle: write the flag, then re-apply bindings like actionApplyPauseBindings.
    const setEnabled = (enabled) => { controls.GAMEPAD.enabled = enabled; input.setBindings(controls); };
    return { input, controls, pads, setEnabled };
}

test('a disabled controller hands a single player back to the keyboard and resumes live when re-enabled', (t) => {
    const { input, controls, pads, setEnabled } = setup(t);
    pads[0].axes[0] = -0.7; pads[0].buttons[0].pressed = true;
    input.keys[controls.PLAYER_1.LEFT] = true;
    assert.equal(input.getPlayerInput(0).yawAxis, 0.7, 'enabled controller steers');
    assert.equal(input.getPlayerSource(0).type, 'gamepad');
    assert.equal(resolvePlayerGamepadIndex(input.getPlayerSource(0)), 0, 'rumble finds the steering controller');

    setEnabled(false);
    const keyboard = { ...input.getPlayerInput(0) };
    assert.equal(keyboard.yawLeft, true, 'keyboard steers while the controller stays plugged in');
    assert.equal(keyboard.boost, false, 'controller buttons are ignored');
    assert.equal(input.getPlayerSource(0).type, 'keyboard');
    assert.equal(resolvePlayerGamepadIndex(input.getPlayerSource(0)), null, 'a disabled controller never rumbles');

    setEnabled(true);
    assert.equal(input.getPlayerInput(0).yawAxis, 0.7, 'controller takes over again without a new round');
});

test('a fixed splitscreen controller seat falls back to that player\'s keys when controllers are disabled', (t) => {
    const { input, controls, pads, setEnabled } = setup(t, { layout: 'controller-keyboard', localHumanCount: 2 });
    pads[0].axes[0] = -1;
    input.keys[controls.PLAYER_1.RIGHT] = true;
    input.keys[controls.PLAYER_2.LEFT] = true;
    assert.equal(input.getPlayerInput(0).yawAxis, 1);
    assert.equal(input.getPlayerInput(0).yawRight, false);

    setEnabled(false);
    assert.equal(input.getPlayerInput(0).yawRight, true, 'player 1 steers with PLAYER_1 keys');
    assert.equal(input.getPlayerInput(0).yawAxis || 0, 0, 'the stick no longer steers');
    assert.equal(input.getPlayerInput(1).yawLeft, true, 'player 2 keeps its own keys');
});

test('the controller pause button is ignored while controllers are disabled', (t) => {
    const { pads } = setup(t);
    const pause = new GamepadPauseInput();
    pause.setBindings({ GAMEPAD: { enabled: false } });
    pads[0].buttons[9].pressed = true;
    assert.equal(pause.wasPressed(), false);
    pause.setBindings({ GAMEPAD: { enabled: true } });
    assert.equal(pause.wasPressed(), false, 're-enabling must not fire the still-held button');
    pads[0].buttons[9].pressed = false; pause.wasPressed();
    pads[0].buttons[9].pressed = true;
    assert.equal(pause.wasPressed(), true);
});

test('the four-player adapter ignores a disabled controller', (t) => {
    const { pads } = setup(t);
    const inputManager = { isDown: () => false, wasPressed: () => false, gamepadControls: { GAMEPAD: { enabled: false } } };
    const source = createFourPlayerPlanarInputSource({ inputManager, playerIndex: 0 });
    source.bind(0); pads[0].axes[0] = -1;
    assert.equal(source.poll().yawAxis, 0);
    inputManager.gamepadControls.GAMEPAD.enabled = true;
    assert.equal(source.poll().yawAxis, 1);
    source.dispose();
});

test('the switch persists through save, reload and runtime projection; old saves stay enabled', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    assert.equal(settings.controls.GAMEPAD.enabled, true);
    settings.controls.GAMEPAD.enabled = false;
    assert.equal(manager.saveSettings(settings).success, true);
    assert.equal(manager.loadSettings().controls.GAMEPAD.enabled, false);
    assert.equal(createControlBindingsSnapshot(settings.controls).GAMEPAD.enabled, false);
    assert.equal(isGamepadInputEnabled({}), true, 'saves without the field keep controllers on');
    assert.equal(createGamepadControlsSnapshot({ GAMEPAD: { enabled: 'no' } }).GAMEPAD.enabled, true);
});
