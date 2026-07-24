import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';

function createClassList(initial = []) {
    const entries = new Set(initial);
    return {
        add(value) {
            entries.add(value);
        },
        remove(value) {
            entries.delete(value);
        },
        contains(value) {
            return entries.has(value);
        },
        toggle(value, force) {
            const enabled = force === undefined ? !entries.has(value) : !!force;
            if (enabled) entries.add(value);
            else entries.delete(value);
            return enabled;
        },
    };
}

function createMenuRoot({ hidden }) {
    return {
        classList: createClassList(hidden ? ['hidden'] : []),
        getAttribute(name) {
            return name === 'aria-hidden' && hidden ? 'true' : null;
        },
    };
}

function withNavigatorGetGamepads(getGamepads, callback) {
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { getGamepads },
    });
    try {
        callback();
    } finally {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: previousNavigator,
        });
    }
}

test('MenuNavigationRuntime does not poll gamepads while the menu is hidden', () => {
    let getGamepadsCalls = 0;
    withNavigatorGetGamepads(() => {
        getGamepadsCalls += 1;
        return [];
    }, () => {
        const runtime = new MenuNavigationRuntime({
            ui: { mainMenu: createMenuRoot({ hidden: true }) },
        });
        runtime._gamepadButtonStateByIndex.set(0, true);

        runtime._pollGamepadButtons();

        assert.equal(getGamepadsCalls, 0);
        assert.equal(runtime._gamepadButtonStateByIndex.get(0), true);
    });
});

test('MenuNavigationRuntime clears stored button state when the gamepad disconnects', () => {
    let getGamepadsCalls = 0;
    withNavigatorGetGamepads(() => {
        getGamepadsCalls += 1;
        return [];
    }, () => {
        const runtime = new MenuNavigationRuntime({
            ui: { mainMenu: createMenuRoot({ hidden: false }) },
        });
        runtime._gamepadButtonStateByIndex.set(0, true);

        runtime._pollGamepadButtons();

        assert.equal(getGamepadsCalls, 1);
        assert.equal(runtime._gamepadButtonStateByIndex.size, 0);
    });
});
