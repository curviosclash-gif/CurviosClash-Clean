import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePlayerActionHintBindings } from '../src/shared/contracts/GamepadControlsContract.js';
import { createFourPlayerPlanarRuntimePort } from '../src/four-player-planar/FourPlayerPlanarRuntimePort.js';
import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';

const KEYBOARD = {
    PLAYER_1: { SHOOT: 'KeyF', USE_ITEM: 'KeyG' },
    PLAYER_2: { SHOOT: 'Numpad0', USE_ITEM: 'NumpadDecimal' },
    PLAYER_3: { SHOOT: 'Semicolon', USE_ITEM: 'Quote' },
};

function createRuntime(sources) {
    return {
        settings: { controls: { ...KEYBOARD, GAMEPAD_2: { SHOOT: 5, SHOOT_MG: 4, SLOWMO: 7 } } },
        input: {
            bindings: KEYBOARD,
            getPlayerSource: (index) => sources[index] || null,
        },
    };
}

test('a player on a controller gets the controller button labels as item bar hints', () => {
    const hints = resolvePlayerActionHintBindings({ type: 'gamepad', gamepadIndex: 0 }, KEYBOARD.PLAYER_1, {});
    assert.deepEqual(hints, { SHOOT: 'RT', USE_ITEM: 'X' });
});

test('the hints follow the remapped buttons of the controller slot that steers the player', () => {
    const controls = { GAMEPAD_2: { SHOOT: 5, SHOOT_MG: 4, SLOWMO: 7 } };
    const hints = resolvePlayerActionHintBindings({ type: 'gamepad', gamepadIndex: 1 }, KEYBOARD.PLAYER_2, controls);
    assert.equal(hints.SHOOT, 'RB');
});

test('keyboard and mouse players keep their keyboard scope', () => {
    assert.equal(resolvePlayerActionHintBindings({ type: 'keyboard' }, KEYBOARD.PLAYER_1, {}), KEYBOARD.PLAYER_1);
    assert.equal(resolvePlayerActionHintBindings({ type: 'mouse' }, KEYBOARD.PLAYER_1, {}), KEYBOARD.PLAYER_1);
    assert.equal(resolvePlayerActionHintBindings(null, KEYBOARD.PLAYER_1, {}), KEYBOARD.PLAYER_1);
});

test('the split-screen runtime port shows gamepad labels for gamepad slots only', () => {
    const runtime = createRuntime([{ type: 'gamepad', gamepadIndex: 0 }, { type: 'gamepad', gamepadIndex: 1 }, { type: 'keyboard' }]);
    const port = createFourPlayerPlanarRuntimePort({ getRuntime: () => runtime });
    assert.deepEqual(port.getPlayerKeyBindings(0), { SHOOT: 'RT', USE_ITEM: 'X' });
    assert.equal(port.getPlayerKeyBindings(1).SHOOT, 'RB');
    assert.equal(port.getPlayerKeyBindings(2), KEYBOARD.PLAYER_3);
});

test('the standard HUD reads the live input sources and each player scope', () => {
    const runtime = createRuntime([{ type: 'keyboard' }, { type: 'gamepad', gamepadIndex: 0 }, { type: 'keyboard' }]);
    const hud = { game: runtime };
    const resolve = (index) => HudRuntimeSystem.prototype._getPlayerKeyBindings.call(hud, index);
    assert.equal(resolve(0), KEYBOARD.PLAYER_1);
    assert.deepEqual(resolve(1), { SHOOT: 'RT', USE_ITEM: 'X' });
    assert.equal(resolve(2), KEYBOARD.PLAYER_3);
});
