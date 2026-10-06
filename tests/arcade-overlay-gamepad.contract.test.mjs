// The menu's gamepad poll only ran while the main menu was open. During a match the Arcade choice
// panels (intermission route/reward/confirm, the victory choice, the Five Fronts advantage, which
// waits without a timeout) could only be picked with mouse or keyboard. While such a panel is on
// screen, the D-pad and the left stick now move the focus between its buttons and A presses it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';

function classList(initial = []) {
    const values = new Set(initial);
    return {
        add: (name) => values.add(name),
        remove: (name) => values.delete(name),
        contains: (name) => values.has(name),
        toggle: (name, force) => (force ? values.add(name) : values.delete(name)),
    };
}

function createButton(doc, id, x, y) {
    return {
        id,
        tagName: 'BUTTON',
        clicks: 0,
        disabled: false,
        parentElement: null,
        getAttribute: () => null,
        closest: () => null,
        getBoundingClientRect: () => ({ x, y, width: 100, height: 40 }),
        focus() { doc.activeElement = this; },
        click() { this.clicks += 1; },
    };
}

function createScene({ panelHidden = false, continuePromptVisible = false } = {}) {
    const doc = { activeElement: null };
    const buttons = [createButton(doc, 'route-a', 0, 0), createButton(doc, 'route-b', 200, 0), createButton(doc, 'route-c', 400, 0), createButton(doc, 'confirm', 0, 200)];
    const panel = {
        id: 'arcade-overlay-panel',
        ownerDocument: doc,
        classList: classList(panelHidden ? ['hidden'] : []),
        querySelectorAll: () => buttons,
    };
    const continuePrompt = { id: 'message-actions', classList: classList(continuePromptVisible ? [] : ['hidden']) };
    doc.getElementById = (id) => ({ 'arcade-overlay-panel': panel, 'message-actions': continuePrompt }[id] || null);
    const menuRoot = { classList: classList(['hidden']), getAttribute: (name) => (name === 'aria-hidden' ? 'true' : null) };
    return { doc, buttons, runtime: new MenuNavigationRuntime({ ui: { mainMenu: menuRoot } }) };
}

function withPad(doc, pad, run) {
    const previousDocument = globalThis.document;
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    globalThis.document = doc;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
    try {
        run();
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
        else delete globalThis.navigator;
    }
}

function createPad() {
    return { buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
}

function tap(runtime, pad, index) {
    pad.buttons[index].pressed = true;
    runtime._pollGamepadButtons();
    pad.buttons[index].pressed = false;
    runtime._pollGamepadButtons();
}

test('D-pad and A pick a button of the visible arcade choice panel while the menu is hidden', () => {
    const { doc, buttons, runtime } = createScene();
    const pad = createPad();
    withPad(doc, pad, () => {
        buttons[0].focus();
        tap(runtime, pad, 15);
        assert.equal(doc.activeElement?.id, 'route-b', 'D-pad right moves to the next route');
        tap(runtime, pad, 0);
        assert.equal(buttons[1].clicks, 1, 'A presses the focused button');
        tap(runtime, pad, 14);
        tap(runtime, pad, 13);
        assert.equal(doc.activeElement?.id, 'confirm', 'D-pad down reaches the confirm button');
    });
});

test('the left stick moves the focus once per push, not once per frame', () => {
    const { doc, runtime } = createScene();
    const pad = createPad();
    withPad(doc, pad, () => {
        doc.getElementById('arcade-overlay-panel').querySelectorAll()[0].focus();
        pad.axes = [0.9, 0.1];
        runtime._pollGamepadButtons();
        runtime._pollGamepadButtons();
        assert.equal(doc.activeElement?.id, 'route-b');
        pad.axes = [0, 0];
        runtime._pollGamepadButtons();
        pad.axes = [0.1, 0.95];
        runtime._pollGamepadButtons();
        assert.equal(doc.activeElement?.id, 'confirm');
        pad.axes = [0, 0];
        runtime._pollGamepadButtons();
        pad.axes = [0, -0.9];
        runtime._pollGamepadButtons();
        assert.equal(doc.activeElement?.id, 'route-a', 'up goes to the route straight above');
    });
});

test('A without a focused button only focuses the first one instead of pressing it', () => {
    const { doc, buttons, runtime } = createScene();
    const pad = createPad();
    withPad(doc, pad, () => {
        tap(runtime, pad, 0);
        assert.equal(doc.activeElement?.id, 'route-a');
        assert.equal(buttons[0].clicks, 0);
    });
});

test('a hidden arcade panel leaves the gamepad alone during play', () => {
    const { doc, buttons, runtime } = createScene({ panelHidden: true });
    const pad = createPad();
    let polls = 0;
    withPad(doc, pad, () => {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => { polls += 1; return [pad]; } } });
        buttons[0].focus();
        tap(runtime, pad, 15);
        assert.equal(polls, 0, 'no hardware poll while neither menu nor arcade panel is shown');
        assert.equal(doc.activeElement?.id, 'route-a');
    });
});

// At the match end every pad button already means "continue" on the result board; pressing a
// panel button with the same A would start a replay and leave for the menu in one press.
test('the visible continue prompt keeps the pad, so A does not also press a panel button', () => {
    const { doc, buttons, runtime } = createScene({ continuePromptVisible: true });
    const pad = createPad();
    withPad(doc, pad, () => {
        buttons[0].focus();
        tap(runtime, pad, 15);
        tap(runtime, pad, 0);
        assert.equal(doc.activeElement?.id, 'route-a');
        assert.equal(buttons[0].clicks, 0);
    });
});