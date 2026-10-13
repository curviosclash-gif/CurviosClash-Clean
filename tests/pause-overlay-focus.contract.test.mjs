import assert from 'node:assert/strict';
import test from 'node:test';

import { setPauseOverlayHidden } from '../src/ui/PauseOverlayFocus.js';
import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';

function createClassList(initial = []) {
    const entries = new Set(initial);
    return {
        contains: (value) => entries.has(value),
        toggle(value, force) {
            const enabled = force === undefined ? !entries.has(value) : !!force;
            if (enabled) entries.add(value);
            else entries.delete(value);
            return enabled;
        },
    };
}

function createPauseDom() {
    const doc = { activeElement: null };
    const makeButton = (id) => ({
        id,
        disabled: false,
        clicks: 0,
        focus() { doc.activeElement = this; },
        click() { this.clicks += 1; },
    });
    const resume = makeButton('btn-pause-resume');
    const settings = makeButton('btn-pause-settings');
    const menu = makeButton('btn-pause-menu');
    const buttons = [resume, settings, menu];
    const overlay = {
        ownerDocument: doc,
        classList: createClassList(['hidden']),
        getAttribute: () => null,
        contains: (node) => buttons.includes(node),
        querySelectorAll: () => buttons,
    };
    const canvas = { id: 'game-canvas', focus() { doc.activeElement = this; } };
    return { doc, overlay, resume, settings, menu, canvas, ui: { pauseOverlay: overlay, pauseResumeButton: resume } };
}

test('opening the pause dialog moves focus to Fortsetzen and closing it gives focus back', () => {
    const dom = createPauseDom();
    dom.canvas.focus();

    setPauseOverlayHidden(dom.ui, false);
    assert.equal(dom.overlay.classList.contains('hidden'), false);
    assert.equal(dom.doc.activeElement, dom.resume, 'an aria-modal dialog must own the focus');

    setPauseOverlayHidden(dom.ui, true);
    assert.equal(dom.overlay.classList.contains('hidden'), true);
    assert.equal(dom.doc.activeElement, dom.canvas, 'resuming returns focus to where the player was');
});

test('a repeated visible projection does not steal focus inside the open dialog', () => {
    const dom = createPauseDom();
    setPauseOverlayHidden(dom.ui, false);
    dom.settings.focus();
    setPauseOverlayHidden(dom.ui, false);
    assert.equal(dom.doc.activeElement, dom.settings);
});

function withGamepad(pad, run) {
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
    try {
        run();
    } finally {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
    }
}

function createPad() {
    return { buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
}

function press(runtime, pad, index) {
    pad.buttons[index].pressed = true;
    runtime._pollGamepadButtons();
    pad.buttons[index].pressed = false;
    runtime._pollGamepadButtons();
}

test('the gamepad navigates and activates the pause dialog buttons', () => {
    const dom = createPauseDom();
    const pad = createPad();
    withGamepad(pad, () => {
        const runtime = new MenuNavigationRuntime({
            ui: { mainMenu: { classList: createClassList(['hidden']), getAttribute: () => 'true' }, pauseOverlay: dom.overlay },
        });
        setPauseOverlayHidden(dom.ui, false);
        runtime._pollGamepadButtons();

        press(runtime, pad, 13);
        assert.equal(dom.doc.activeElement, dom.settings, 'D-pad down reaches Einstellungen');
        press(runtime, pad, 13);
        assert.equal(dom.doc.activeElement, dom.menu, 'and Match verlassen');
        press(runtime, pad, 12);
        assert.equal(dom.doc.activeElement, dom.settings, 'D-pad up goes back');
        press(runtime, pad, 0);
        assert.equal(dom.settings.clicks, 1, 'A activates the focused pause button');
    });
});

test('a button still held when the menu appears does not fire', () => {
    const pad = createPad();
    const menuRoot = { classList: createClassList(['hidden']), getAttribute() { return this.classList.contains('hidden') ? 'true' : null; } };
    let activations = 0;
    withGamepad(pad, () => {
        const runtime = new MenuNavigationRuntime({ ui: { mainMenu: menuRoot } });
        runtime._activateFocusedElement = () => { activations += 1; };
        pad.buttons[0].pressed = true;
        runtime._pollGamepadButtons();
        menuRoot.classList.toggle('hidden', false);
        runtime._pollGamepadButtons();
        runtime._pollGamepadButtons();
        assert.equal(activations, 0, 'A held over from the match must not press a menu button');
        pad.buttons[0].pressed = false;
        runtime._pollGamepadButtons();
        pad.buttons[0].pressed = true;
        runtime._pollGamepadButtons();
        assert.equal(activations, 1, 'a fresh press works');
    });
});
