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
        style: { cursor: '' },
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

test('mouse actions fire MG on right click, use items on left click, rockets on middle click and cycle items on wheel', () => {
    const canvas = createEventTarget();
    const keyboard = { shootMG: false, shootItem: false, shootRocket: false, useItem: false, nextItem: false };
    const source = createMouseSteeringInputSource({ getKeyboardInput: () => keyboard }, false, { target: canvas });
    const event = (button) => ({ button, preventDefault() {} });
    try {
        source.bind(0);
        canvas.dispatch('mousedown', event(2));
        assert.equal(source.poll().shootMG, true);
        assert.equal(source.poll().shootMG, true);
        assert.equal(source.poll().useItem, false);
        assert.equal(source.poll().shootItem, false);
        canvas.dispatch('mouseup', event(2));
        assert.equal(source.poll().shootMG, false);
        canvas.dispatch('mousedown', event(2));
        canvas.dispatch('mouseup', event(2));
        assert.equal(source.poll().shootMG, true, 'short clicks survive until polling');
        assert.equal(source.poll().shootMG, false);
        canvas.dispatch('mousedown', event(1));
        const rocketPoll = source.poll();
        assert.equal(rocketPoll.shootRocket, true);
        assert.equal(rocketPoll.shootItem, false, 'middle click never falls back to the selected item');
        assert.equal(source.poll().shootRocket, false);
        for (const deltaY of [-100, 100]) {
            let prevented = false;
            canvas.dispatch('wheel', { deltaY, preventDefault() { prevented = true; } });
            assert.equal(prevented, true);
            assert.equal(source.poll().nextItem, true);
            assert.equal(source.poll().nextItem, false);
        }
        for (const reset of [() => source.clearInputState(), () => canvas.dispatch('pointerleave'), () => source.bind(0)]) {
            canvas.dispatch('mousedown', event(2));
            canvas.dispatch('mousedown', event(1));
            canvas.dispatch('mousedown', event(0));
            reset();
            assert.equal(source.poll().useItem, false);
            assert.equal(source.poll().shootMG, false);
            assert.equal(source.poll().shootItem, false);
        }
        canvas.dispatch('mousedown', event(0));
        canvas.dispatch('mouseup', event(0));
        const itemInput = source.poll();
        assert.equal(itemInput.useItem, true);
        assert.equal(itemInput.shootMG, false);
        assert.equal(itemInput.shootItem, false);
        assert.equal(source.poll().useItem, false);
        let contextPrevented = false;
        canvas.dispatch('contextmenu', { preventDefault() { contextPrevented = true; } });
        assert.equal(contextPrevented, true);
        keyboard.useItem = true;
        canvas.dispatch('mousedown', event(2));
        assert.equal(source.poll().useItem, true, 'keyboard item use remains available');
    } finally {
        source.dispose();
    }
    assert.equal(canvas.listenerCount(), 0);
});

test('mouse steering restores the canvas cursor across rebind and disposal', () => {
    const canvas = createEventTarget({ left: 0, top: 0, width: 200, height: 100 });
    canvas.style.cursor = 'crosshair';
    const source = createMouseSteeringInputSource(null, false, { target: canvas });

    try {
        source.bind(0);
        assert.equal(canvas.style.cursor, 'none');

        source.bind(0);
        assert.equal(canvas.style.cursor, 'none');
        source.unbind();
        assert.equal(canvas.style.cursor, 'crosshair');

        canvas.style.cursor = '';
        source.bind(0);
        assert.equal(canvas.style.cursor, 'none');
    } finally {
        source.dispose();
    }

    assert.equal(canvas.style.cursor, '');
    assert.equal(canvas.listenerCount(), 0);
    source.dispose();
    assert.equal(canvas.style.cursor, '');
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
