// ============================================
// gamepad-menu-poller.contract.test.mjs - Gemeinsame Gamepad-Abfrage für DOM-Menüs. Das Hauptmenü
// und das Hangar-Fenster lesen den Controller über dasselbe Modul: ein Druck zählt einmal (Entprellung
// über die steigende Flanke wie bisher im Hauptmenü), gehaltene Richtungen wiederholen sich nach einer
// Pause, der linke Stick zählt wie das Steuerkreuz, und die Einstellung „Controller-Steuerung aus“
// schaltet alles ab. Läuft ohne Browser mit einem Ersatz-Gamepad und einem Ersatz-Bildtakt.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { GAMEPAD_MENU_BUTTONS, createGamepadMenuPoller } from '../src/ui/menu/GamepadMenuPoller.js';

/** Stands in for a standard-mapping pad: 17 buttons, two sticks, all released. */
function createPad() {
    return {
        buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
        press(index, pressed = true) { this.buttons[index].pressed = pressed; },
    };
}

function createHarness(options = {}) {
    const pad = createPad();
    const calls = [];
    let pads = [null, pad];
    const poller = createGamepadMenuPoller({
        getGamepads: () => pads,
        onDirection: (direction) => calls.push(direction),
        onConfirm: () => calls.push('A'),
        onBack: () => calls.push('B'),
        onPreviousTab: () => calls.push('LB'),
        onNextTab: () => calls.push('RB'),
        onStart: () => calls.push('START'),
        ...options,
    });
    return { pad, calls, poller, unplug() { pads = [null, null]; } };
}

test('a held button counts once; releasing and pressing again counts again', () => {
    const { pad, calls, poller } = createHarness();
    pad.press(GAMEPAD_MENU_BUTTONS.A);
    poller.poll(0);
    poller.poll(16);
    poller.poll(32);
    assert.deepEqual(calls, ['A'], 'holding A for three frames confirms once');
    pad.press(GAMEPAD_MENU_BUTTONS.A, false);
    poller.poll(48);
    pad.press(GAMEPAD_MENU_BUTTONS.A);
    poller.poll(64);
    assert.deepEqual(calls, ['A', 'A'], 'a fresh press confirms again');
});

test('B, LB, RB and Start reach their own callbacks', () => {
    const { pad, calls, poller } = createHarness();
    for (const button of ['B', 'LB', 'RB', 'START']) pad.press(GAMEPAD_MENU_BUTTONS[button]);
    poller.poll(0);
    assert.deepEqual(calls, ['B', 'LB', 'RB', 'START']);
});

test('a held direction repeats after a pause, then at a steady rate', () => {
    const { pad, calls, poller } = createHarness({ repeatDelayMs: 300, repeatIntervalMs: 100 });
    pad.press(GAMEPAD_MENU_BUTTONS.DOWN);
    for (let time = 0; time <= 520; time += 20) poller.poll(time);
    assert.deepEqual(calls, ['down', 'down', 'down', 'down'], 'press at 0, repeats at 300, 400 and 500 ms');
});

test('the left stick moves like the d-pad, with the same repeat', () => {
    const { pad, calls, poller } = createHarness({ repeatDelayMs: 300, repeatIntervalMs: 100 });
    pad.axes[0] = 0.9;
    poller.poll(0);
    poller.poll(100);
    assert.deepEqual(calls, ['right'], 'tilting right moves once before the repeat pause');
    pad.axes[0] = 0.2;
    poller.poll(120);
    pad.axes[1] = -0.8;
    poller.poll(140);
    assert.deepEqual(calls, ['right', 'up'], 'a small tilt inside the threshold does nothing, tilting up moves up');
});

test('the main menu mode keeps the old feel: d-pad only, no repeat, no stick', () => {
    const { pad, calls, poller } = createHarness({ repeat: false, leftStick: false });
    pad.press(GAMEPAD_MENU_BUTTONS.LEFT);
    pad.axes[1] = 1;
    for (let time = 0; time <= 2000; time += 50) poller.poll(time);
    assert.deepEqual(calls, ['left']);
});

test('"Controller-Steuerung aus" silences every button and forgets held state', () => {
    let enabled = false;
    const { pad, calls, poller } = createHarness({ isEnabled: () => enabled });
    pad.press(GAMEPAD_MENU_BUTTONS.A);
    pad.press(GAMEPAD_MENU_BUTTONS.RIGHT);
    poller.poll(0);
    assert.deepEqual(calls, [], 'a disabled controller does nothing');
    assert.equal(poller.buttonState.size, 0);
    enabled = true;
    poller.poll(16);
    assert.deepEqual(calls, ['right', 'A'], 'switching it back on works with the next frame');
});

test('an inactive surface does not read the hardware and keeps its state', () => {
    let reads = 0;
    const poller = createGamepadMenuPoller({ isActive: () => false, getGamepads: () => { reads += 1; return []; } });
    poller.buttonState.set(0, true);
    poller.poll(0);
    assert.equal(reads, 0);
    assert.equal(poller.buttonState.get(0), true);
});

test('unplugging the pad clears the stored button state', () => {
    const { pad, poller, unplug } = createHarness();
    pad.press(GAMEPAD_MENU_BUTTONS.A);
    poller.poll(0);
    unplug();
    poller.poll(16);
    assert.equal(poller.buttonState.size, 0);
});

test('a window without focus ignores the pad unless the caller opts out', () => {
    const previous = globalThis.document;
    globalThis.document = { hidden: false, hasFocus: () => false };
    try {
        const focused = createHarness();
        focused.pad.press(GAMEPAD_MENU_BUTTONS.A);
        focused.poller.poll(0);
        assert.deepEqual(focused.calls, [], 'the hangar behind another window stays still');
        const unfocused = createHarness({ requireDocumentFocus: false });
        unfocused.pad.press(GAMEPAD_MENU_BUTTONS.A);
        unfocused.poller.poll(0);
        assert.deepEqual(unfocused.calls, ['A'], 'the main menu keeps its old behaviour');
    } finally {
        globalThis.document = previous;
    }
});

test('start runs one frame loop; stop cancels it and forgets held buttons', () => {
    const frames = new Map();
    let nextHandle = 1;
    const cancelled = [];
    const { pad, calls, poller } = createHarness({
        requestFrame: (tick) => { const handle = nextHandle++; frames.set(handle, tick); return handle; },
        cancelFrame: (handle) => { cancelled.push(handle); frames.delete(handle); },
    });
    poller.start();
    poller.start();
    assert.equal(frames.size, 1, 'a second start does not open a second loop');
    pad.press(GAMEPAD_MENU_BUTTONS.A);
    const [[firstHandle, firstTick]] = frames;
    frames.delete(firstHandle);
    firstTick(16);
    assert.deepEqual(calls, ['A']);
    assert.equal(frames.size, 1, 'the loop asks for the next frame');
    poller.stop();
    assert.equal(frames.size, 0, 'stop cancels the pending frame');
    assert.equal(cancelled.length, 1);
    assert.equal(poller.buttonState.size, 0);
    assert.equal(poller.isRunning(), false);
});
