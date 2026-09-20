import assert from 'node:assert/strict';
import test from 'node:test';
import { InputManager } from '../src/core/InputManager.js';
import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import { createGamepadControlsSnapshot, normalizeSplitscreenInputLayout } from '../src/shared/contracts/GamepadControlsContract.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';
import { createControlBindingsSnapshot } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { applyAxisDeadzone } from '../src/shared/utils/InputAxisOps.js';

// Controller axes grow from 0 at the 0.15 deadzone edge instead of passing the raw value on.
const stickAxis = (value) => applyAxisDeadzone(value, 0.15);

function setup(t, layout) {
    const pads = Array.from({ length: 2 }, () => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }));
    const state = { pads };
    const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
    for (const [key, value] of Object.entries({ document: doc, window: { document: doc, addEventListener() {}, removeEventListener() {} }, navigator: { getGamepads: () => state.pads, maxTouchPoints: 0 } })) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
    }
    const input = new InputManager();
    const controls = { ...input.getBindings(), ...createGamepadControlsSnapshot({ SPLITSCREEN: { layout } }) };
    const game = { settings: { controls, localSettings: { mouseSteering: true } } };
    input.setBindings(controls);
    for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
        input.setPlayerSource(playerIndex, createPreferredMatchInputSource({ inputManager: input, playerIndex, localHumanCount: 2, game }));
    }
    return { input, controls, state, pads };
}

for (const layout of ['controller-keyboard', 'keyboard-controller']) {
    test(`${layout}: simultaneous steering reaches separate players, even with mouse steering enabled`, (t) => {
        const { input, controls, state, pads } = setup(t, layout);
        const controllerPlayer = layout === 'controller-keyboard' ? 0 : 1;
        const keyboardPlayer = 1 - controllerPlayer;
        const keys = controls[`PLAYER_${keyboardPlayer + 1}`];
        pads[0].axes[0] = -0.7; pads[0].buttons[0].pressed = true;
        input.keys[keys.RIGHT] = true;
        const controller = { ...input.getPlayerInput(controllerPlayer) };
        const keyboard = { ...input.getPlayerInput(keyboardPlayer) };
        assert.equal(controller.yawAxis, stickAxis(0.7)); assert.equal(controller.boost, true);
        assert.equal(keyboard.yawRight, true); assert.equal(keyboard.boost, false);
        assert.equal(input.getPlayerSource(controllerPlayer).gamepadIndex, 0);
        state.pads = [];
        input.keys[controls[`PLAYER_${controllerPlayer + 1}`].LEFT] = true;
        assert.equal(input.getPlayerInput(controllerPlayer).yawLeft, false, 'unplugging must not give the controller player keyboard input');
        assert.equal(input.getPlayerInput(keyboardPlayer).yawRight, true);
        state.pads = pads;
        assert.equal(input.getPlayerInput(controllerPlayer).yawAxis, stickAxis(0.7));
        input.dispose();
    });
}

test('two keyboard players use independent bindings and ignore attached controllers', (t) => {
    const { input, controls, pads } = setup(t, 'keyboard-keyboard');
    pads[0].buttons[0].pressed = true; pads[1].buttons[0].pressed = true;
    input.keys[controls.PLAYER_1.LEFT] = true; input.keys[controls.PLAYER_2.RIGHT] = true;
    const p1 = { ...input.getPlayerInput(0) }; const p2 = { ...input.getPlayerInput(1) };
    assert.equal(p1.yawLeft, true); assert.equal(p1.yawRight, false); assert.equal(p1.boost, false);
    assert.equal(p2.yawLeft, false); assert.equal(p2.yawRight, true); assert.equal(p2.boost, false);
    input.dispose();
});

test('the third keyboard player uses a dedicated full binding set', (t) => {
    const { input, controls } = setup(t, 'keyboard-keyboard');
    input.setPlayerSource(2, createPreferredMatchInputSource({
        inputManager: input,
        playerIndex: 2,
        localHumanCount: 3,
        assignedInputDevice: { type: 'keyboard', gamepadIndex: -1 },
        game: { settings: { controls, localSettings: {} } },
    }));
    input.keys[controls.PLAYER_3.LEFT] = true;
    input.keys[controls.PLAYER_3.BOOST] = true;

    const p1 = { ...input.getPlayerInput(0) };
    const p2 = { ...input.getPlayerInput(1) };
    const p3 = { ...input.getPlayerInput(2) };

    assert.equal(p1.yawLeft, false);
    assert.equal(p2.yawLeft, false);
    assert.equal(p3.yawLeft, true);
    assert.equal(p3.boost, true);
    input.dispose();
});

test('two controllers use separate hardware indices and do not fall back to keyboard', (t) => {
    const { input, controls, state, pads } = setup(t, 'controller-controller');
    pads[0].axes[0] = -1; pads[1].axes[0] = 0.5;
    input.keys[controls.PLAYER_1.BOOST] = true; input.keys[controls.PLAYER_2.BOOST] = true;
    assert.equal(input.getPlayerInput(0).yawAxis, 1); assert.equal(input.getPlayerInput(1).yawAxis, -stickAxis(0.5));
    assert.equal(input.getPlayerInput(0).boost, false); assert.equal(input.getPlayerInput(1).boost, false);
    state.pads = [null, pads[1]];
    assert.equal(input.getPlayerInput(0).yawAxis, 0); assert.equal(input.getPlayerInput(1).yawAxis, -stickAxis(0.5));
    input.dispose();
});

test('all layouts persist through settings save and runtime projection; old settings remain automatic', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    for (const layout of ['auto', 'controller-keyboard', 'keyboard-controller', 'keyboard-keyboard', 'controller-controller']) {
        const settings = manager.createDefaultSettings(); settings.controls.SPLITSCREEN.layout = layout;
        assert.equal(manager.saveSettings(settings).success, true);
        assert.equal(manager.loadSettings().controls.SPLITSCREEN.layout, layout);
        assert.equal(createControlBindingsSnapshot(settings.controls).SPLITSCREEN.layout, layout);
    }
    assert.equal(createGamepadControlsSnapshot().SPLITSCREEN.layout, 'auto');
    assert.equal(normalizeSplitscreenInputLayout('invalid'), 'auto');
});
