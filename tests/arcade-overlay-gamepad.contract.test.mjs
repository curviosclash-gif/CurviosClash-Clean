// The menu's gamepad poller only answers while the main menu is open. During a match the Arcade
// choice panels (intermission route/reward/confirm, the victory choice, the Five Fronts advantage,
// which waits without a timeout) could only be picked with mouse or keyboard. They now have their
// own poller: the D-pad and the left stick move the focus between the panel's buttons and A presses
// it. Menu and panel never both answer the same pad, and the panel's poller stops with the panel.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createArcadeOverlayGamepadNav } from '../src/ui/arcade/ArcadeOverlayGamepadNav.js';
import { MatchFlowArcadeOverlayController } from '../src/ui/MatchFlowArcadeOverlayController.js';
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

function createScene({ panelHidden = false, continuePromptVisible = false, menuVisible = false } = {}) {
    const doc = { activeElement: null, hidden: false, hasFocus: () => true };
    const buttons = [createButton(doc, 'route-a', 0, 0), createButton(doc, 'route-b', 200, 0), createButton(doc, 'route-c', 400, 0), createButton(doc, 'confirm', 0, 200)];
    const panel = {
        id: 'arcade-overlay-panel',
        ownerDocument: doc,
        classList: classList(panelHidden ? ['hidden'] : []),
        querySelectorAll: () => buttons,
        querySelector: () => buttons.find((button) => !button.disabled) || null,
    };
    const continuePrompt = { id: 'message-actions', classList: classList(continuePromptVisible ? [] : ['hidden']) };
    const menuRoot = {
        id: 'main-menu',
        classList: classList(menuVisible ? [] : ['hidden']),
        getAttribute: (name) => (name === 'aria-hidden' ? String(!menuVisible) : null),
    };
    doc.getElementById = (id) => ({ 'arcade-overlay-panel': panel, 'message-actions': continuePrompt, 'main-menu': menuRoot }[id] || null);
    const pad = { buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
    const reads = { count: 0 };
    const nav = createArcadeOverlayGamepadNav({ doc, getGamepads: () => { reads.count += 1; return [pad]; } });
    return { doc, buttons, panel, menuRoot, pad, reads, nav };
}

function tap(pollers, pad, index) {
    pad.buttons[index].pressed = true;
    for (const poll of pollers) poll();
    pad.buttons[index].pressed = false;
    for (const poll of pollers) poll();
}

test('D-pad and A pick a button of the visible arcade choice panel', () => {
    const { doc, buttons, pad, nav } = createScene();
    buttons[0].focus();
    nav.poll(); // the panel is on screen for a frame before the press
    tap([nav.poll], pad, 15);
    assert.equal(doc.activeElement?.id, 'route-b', 'D-pad right moves to the next route');
    tap([nav.poll], pad, 0);
    assert.equal(buttons[1].clicks, 1, 'A presses the focused button');
    tap([nav.poll], pad, 14);
    tap([nav.poll], pad, 13);
    assert.equal(doc.activeElement?.id, 'confirm', 'D-pad down reaches the confirm button');
    tap([nav.poll], pad, 5);
    assert.equal(doc.activeElement?.id, 'confirm', 'RB moves right only along the row');
});

test('the left stick moves the focus once per push, not once per frame', () => {
    const { doc, buttons, pad, nav } = createScene();
    buttons[0].focus();
    nav.poll(); // the panel is on screen for a frame before the push
    pad.axes = [0.9, 0.1];
    nav.poll();
    nav.poll();
    nav.poll();
    assert.equal(doc.activeElement?.id, 'route-b');
    pad.axes = [0, 0];
    nav.poll();
    pad.axes = [0.1, 0.95];
    nav.poll();
    assert.equal(doc.activeElement?.id, 'confirm');
    pad.axes = [0, 0];
    nav.poll();
    pad.axes = [0, -0.9];
    nav.poll();
    assert.equal(doc.activeElement?.id, 'route-a', 'up goes to the route straight above');
});

test('A without a focused button only focuses the first one instead of pressing it', () => {
    const { doc, buttons, pad, nav } = createScene();
    nav.poll(); // the panel is on screen for a frame before the press
    tap([nav.poll], pad, 0);
    assert.equal(doc.activeElement?.id, 'route-a');
    assert.equal(buttons[0].clicks, 0);
});

test('a hidden arcade panel leaves the gamepad alone during play', () => {
    const { doc, buttons, pad, reads, nav } = createScene({ panelHidden: true });
    buttons[0].focus();
    tap([nav.poll], pad, 15);
    tap([nav.poll], pad, 0);
    assert.equal(reads.count, 0, 'no hardware poll while no arcade panel is shown');
    assert.equal(doc.activeElement?.id, 'route-a');
    assert.equal(buttons[0].clicks, 0);
});

// At the match end every pad button already means "continue" on the result board; pressing a
// panel button with the same A would start a replay and leave for the menu in one press.
test('the visible continue prompt keeps the pad, so A does not also press a panel button', () => {
    const { doc, buttons, pad, nav } = createScene({ continuePromptVisible: true });
    buttons[0].focus();
    tap([nav.poll], pad, 15);
    tap([nav.poll], pad, 0);
    assert.equal(doc.activeElement?.id, 'route-a');
    assert.equal(buttons[0].clicks, 0);
});

test('an A still held when the continue prompt goes away is not a new press on the panel', () => {
    const { doc, buttons, pad, nav } = createScene({ continuePromptVisible: true });
    buttons[0].focus();
    pad.buttons[0].pressed = true;
    nav.poll();
    doc.getElementById('message-actions').classList.add('hidden');
    nav.poll();
    nav.poll();
    assert.equal(buttons[0].clicks, 0, 'the held press belonged to the continue prompt');
    pad.buttons[0].pressed = false;
    nav.poll();
    tap([nav.poll], pad, 0);
    assert.equal(buttons[0].clicks, 1, 'the next real press counts');
});

test('a D-pad direction or stick already held when the panel appears does not move the focus', () => {
    const { doc, buttons, pad, nav } = createScene({ continuePromptVisible: true });
    buttons[0].focus();
    pad.buttons[15].pressed = true;
    pad.axes = [0, 0.9];
    nav.poll();
    doc.getElementById('message-actions').classList.add('hidden');
    nav.poll();
    nav.poll();
    assert.equal(doc.activeElement?.id, 'route-a', 'the held direction belonged to the moment before the panel');
    pad.buttons[15].pressed = false;
    pad.axes = [0, 0];
    nav.poll();
    tap([nav.poll], pad, 15);
    assert.equal(doc.activeElement?.id, 'route-b', 'after release the next D-pad press moves');
    pad.axes = [0, 0.9];
    nav.poll();
    assert.equal(doc.activeElement?.id, 'confirm', 'after release the next stick push moves');
});

function withNavigatorPad(pad, run) {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
    try {
        run();
    } finally {
        if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
        else delete globalThis.navigator;
    }
}

function spyMenu(runtime) {
    const calls = { moves: 0, confirms: 0 };
    runtime._moveFocusByDirection = () => { calls.moves += 1; };
    runtime._activateFocusedElement = () => { calls.confirms += 1; };
    return calls;
}

test('the menu poller stays silent while an arcade choice panel is open during a match', () => {
    const { buttons, menuRoot, pad, nav } = createScene();
    const menu = new MenuNavigationRuntime({ ui: { mainMenu: menuRoot } });
    const menuCalls = spyMenu(menu);
    withNavigatorPad(pad, () => {
        buttons[0].focus();
        const both = [nav.poll, () => menu._pollGamepadButtons()];
        for (const poll of both) poll(); // the panel is on screen for a frame before the press
        tap(both, pad, 15);
        tap(both, pad, 0);
    });
    assert.equal(buttons[1].clicks, 1, 'the panel took the press');
    assert.deepEqual(menuCalls, { moves: 0, confirms: 0 }, 'the hidden menu did not react');
});

test('an interactive main menu keeps the pad, so the panel poller does not also react', () => {
    const { buttons, menuRoot, pad, reads, nav } = createScene({ menuVisible: true });
    const menu = new MenuNavigationRuntime({ ui: { mainMenu: menuRoot } });
    const menuCalls = spyMenu(menu);
    withNavigatorPad(pad, () => {
        buttons[0].focus();
        const both = [nav.poll, () => menu._pollGamepadButtons()];
        tap(both, pad, 15);
        tap(both, pad, 0);
    });
    assert.equal(reads.count, 0, 'the panel poller did not read the pad');
    assert.equal(buttons[0].clicks + buttons[1].clicks, 0);
    assert.deepEqual(menuCalls, { moves: 1, confirms: 1 }, 'the menu answered alone');
});

function createOverlayElement() {
    const element = {
        children: [], parentElement: null, style: {}, attributes: {},
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        append(...nodes) { nodes.forEach((node) => this.appendChild(node)); },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener() {},
        focus() {},
        remove() {},
        querySelector() { return null; },
    };
    element.classList = classList();
    return element;
}

test('the panel poller runs while an arcade panel is shown and stops on dispose', () => {
    const frames = { requested: 0, cancelled: 0 };
    const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.document = { createElement: () => createOverlayElement(), getElementById: () => null };
    globalThis.requestAnimationFrame = () => { frames.requested += 1; return frames.requested; };
    globalThis.cancelAnimationFrame = () => { frames.cancelled += 1; };
    try {
        const game = { state: 'PLAYING', ui: { messageOverlay: createOverlayElement() } };
        const controller = new MatchFlowArcadeOverlayController({
            runtime: game,
            runtimePort: {
                getMatchRuntimeProjection: () => ({ arcade: {} }),
                getArcadeMenuSurfaceState: () => ({ runType: 'arena_waves', phase: 'upgrade', choices: ['shield'] }),
            },
        });
        controller.syncArcadeOverlayPanel();
        assert.equal(controller._gamepadNav.isRunning(), true, 'the open Five Fronts choice starts the poller');
        assert.equal(frames.requested, 1);
        controller.dispose();
        assert.equal(controller._gamepadNav.isRunning(), false, 'dispose stops the poller');
        assert.equal(frames.cancelled, 1, 'the pending animation frame is cancelled');
    } finally {
        for (const [key, value] of Object.entries({ document: saved.document, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf })) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
