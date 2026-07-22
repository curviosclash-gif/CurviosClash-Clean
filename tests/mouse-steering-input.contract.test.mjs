import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createMouseSteeringInputSource,
    createPreferredMatchInputSource,
} from '../src/ui/MatchInputSourceResolver.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';

function createEventTarget(rect = null) {
    const listeners = new Map();
    return {
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) listeners.delete(type);
        },
        dispatch(type, event = {}) {
            listeners.get(type)?.(event);
        },
        getBoundingClientRect() {
            return rect;
        },
        listenerCount() {
            return listeners.size;
        },
    };
}

test('mouse steering maps canvas position to analog axes and preserves keyboard actions', () => {
    const originalWindow = globalThis.window;
    const windowTarget = createEventTarget();
    globalThis.window = windowTarget;
    const canvas = createEventTarget({ left: 10, top: 20, width: 200, height: 100 });
    const keyboardInput = { boost: true, shootMG: true, rollLeft: true };
    const inputManager = {
        getKeyboardInput(playerIndex, options) {
            assert.equal(playerIndex, 0);
            assert.equal(options.includeSecondaryBindings, true);
            return keyboardInput;
        },
    };
    const source = createMouseSteeringInputSource(inputManager, true, { target: canvas, keyboardPlayerIndex: 0 });

    try {
        source.bind(0);
        assert.equal(source.poll(), keyboardInput);

        canvas.dispatch('pointermove', { clientX: 210, clientY: 20, pointerType: 'mouse' });
        const input = source.poll();
        assert.equal(input.yawAxis, -1);
        assert.equal(input.pitchAxis, 1);
        assert.equal(input.boost, true);
        assert.equal(input.shootMG, true);
        assert.equal(input.rollLeft, true);

        inputManager.getPlayerInput = () => source.poll();
        const player = { index: 0, isBot: false, inventory: [] };
        const playerInputSystem = new PlayerInputSystem({
            humanPlayers: [player],
            renderer: { cameraModes: [], cycleCamera() {} },
        });
        const resolvedInput = playerInputSystem.resolvePlayerInput(player, 1 / 60, inputManager);
        assert.equal(resolvedInput.yawAxis, -1);
        assert.equal(resolvedInput.pitchAxis, 1);

        canvas.dispatch('pointermove', { clientX: 110, clientY: 70, pointerType: 'mouse' });
        assert.equal(source.poll().yawAxis, 0);
        assert.equal(source.poll().pitchAxis, 0);

        canvas.dispatch('pointerleave');
        assert.equal(source.poll(), keyboardInput);
    } finally {
        source.dispose();
        globalThis.window = originalWindow;
    }

    assert.equal(canvas.listenerCount(), 0);
    assert.equal(windowTarget.listenerCount(), 0);
});

test('mouse steering is opt-in, persisted, and selected for desktop player one', () => {
    const defaults = createDefaultSettingsSnapshot();
    assert.equal(defaults.localSettings.mouseSteering, false);

    const settings = { localSettings: { ...defaults.localSettings, mouseSteering: true } };
    ensureMenuContractState(settings);
    assert.equal(settings.localSettings.mouseSteering, true);

    const source = createPreferredMatchInputSource({
        inputManager: { getKeyboardInput() { return {}; } },
        playerIndex: 0,
        localHumanCount: 1,
        game: { settings },
    });
    assert.equal(source.type, 'mouse');
});
