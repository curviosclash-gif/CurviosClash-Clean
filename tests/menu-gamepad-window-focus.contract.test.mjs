// ============================================
// menu-gamepad-window-focus.contract.test.mjs - Das Hauptmenü liest den Controller nur, solange sein
// Fenster den Fokus hat. Steht das Hangar-Fenster davor, gehört der A-Druck dem Hangar; kehrt der
// Fokus zurück, reagiert das Menü sofort, ohne dass eine noch gehaltene Taste nachträglich auslöst.
// Testbauten (build:app:test setzt __CURVIOS_E2E__) laufen in Fenstern ohne Fokus und steuern das
// Menü mit Ersatz-getGamepads; für sie bleibt das Menü ohne Fokusprüfung.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';

const A = 0;

/** Stands in for the visible main menu root: not hidden, no aria-hidden. */
const visibleMenuRoot = {
    classList: { contains: () => false },
    getAttribute: () => null,
};

/**
 * Stands in for the Electron renderer globals: the pad every window reads, the menu document whose
 * focus moves to the hangar window and back, and the build-time test flag.
 */
function withRenderer({ focused = false, e2e = undefined } = {}, run) {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
    // No pause dialog in this document: getElementById finds nothing.
    const doc = { hidden: false, focused, hasFocus() { return this.focused; }, getElementById: () => null };
    const previous = {
        navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
        document: globalThis.document,
        e2e: globalThis.__CURVIOS_E2E__,
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
    globalThis.document = doc;
    if (e2e === undefined) delete globalThis.__CURVIOS_E2E__;
    else globalThis.__CURVIOS_E2E__ = e2e;
    try {
        run({ pad, doc });
    } finally {
        if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
        else delete globalThis.navigator;
        globalThis.document = previous.document;
        if (previous.e2e === undefined) delete globalThis.__CURVIOS_E2E__;
        else globalThis.__CURVIOS_E2E__ = previous.e2e;
    }
}

function createMenu(options = {}) {
    const runtime = new MenuNavigationRuntime({ ui: { mainMenu: visibleMenuRoot }, ...options });
    const activations = { count: 0 };
    runtime._activateFocusedElement = () => { activations.count += 1; };
    return { runtime, activations };
}

function tap(runtime, pad, index) {
    pad.buttons[index].pressed = true;
    runtime._pollGamepadButtons();
    pad.buttons[index].pressed = false;
    runtime._pollGamepadButtons();
}

test('A pressed while the hangar window has the focus does nothing in the main menu', () => {
    withRenderer({ focused: false }, ({ pad }) => {
        const { runtime, activations } = createMenu();
        tap(runtime, pad, A);
        assert.equal(activations.count, 0, 'the menu behind the hangar ignored the press');
    });
});

test('with the focus back in the main window the menu answers A at once', () => {
    withRenderer({ focused: true }, ({ pad }) => {
        const { runtime, activations } = createMenu();
        tap(runtime, pad, A);
        assert.equal(activations.count, 1);
    });
});

test('A still held when the focus comes back does not fire late', () => {
    withRenderer({ focused: false }, ({ pad, doc }) => {
        const { runtime, activations } = createMenu();
        pad.buttons[A].pressed = true;
        runtime._pollGamepadButtons();
        doc.focused = true;
        runtime._pollGamepadButtons();
        runtime._pollGamepadButtons();
        assert.equal(activations.count, 0, 'the press made for the hangar stays there');
        pad.buttons[A].pressed = false;
        runtime._pollGamepadButtons();
        tap(runtime, pad, A);
        assert.equal(activations.count, 1, 'the next real press counts');
    });
});

test('a test build drives the unfocused offscreen menu with a stand-in pad', () => {
    withRenderer({ focused: false, e2e: true }, ({ pad }) => {
        const { runtime, activations } = createMenu();
        tap(runtime, pad, A);
        assert.equal(activations.count, 1, 'the desktop specs keep their gamepad path');
    });
});

test('"Controller-Steuerung aus" silences the main menu like the hangar', () => {
    withRenderer({ focused: true }, ({ pad }) => {
        let controls = { GAMEPAD: { enabled: false } };
        const { runtime, activations } = createMenu({ getControls: () => controls });
        tap(runtime, pad, A);
        assert.equal(activations.count, 0, 'a switched-off controller does nothing');
        controls = { GAMEPAD: { enabled: true } };
        tap(runtime, pad, A);
        assert.equal(activations.count, 1, 'switching it back on works');
    });
});
