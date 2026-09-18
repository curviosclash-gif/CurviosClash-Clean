// Contract: the "Continue" input intent (ET-P7a).
// Any fresh key, primary mouse click or gamepad button edge means "continue",
// except Escape, modifier keys, key repeats and the bound gamepad PAUSE button.

import assert from 'node:assert/strict';
import test from 'node:test';
import { InputManager } from '../src/core/InputManager.js';
import { createHeadlessInputAdapter } from '../src/state/MatchKernel.js';
import { normalizeGamepadControls } from '../src/shared/contracts/GamepadControlsContract.js';

const BUTTON_COUNT = 16;

function createPad() {
    return {
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false })),
    };
}

function setup(t, { padCount = 0 } = {}) {
    const listeners = new Map();
    const pads = Array.from({ length: padCount }, () => createPad());
    const state = { pads, hidden: false, focused: true };
    const doc = {
        activeElement: null,
        get hidden() { return state.hidden; },
        hasFocus: () => state.focused,
        addEventListener() {},
        removeEventListener() {},
    };
    const win = {
        document: doc,
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type) { listeners.delete(type); },
    };
    const globals = {
        window: win,
        document: doc,
        navigator: { getGamepads: () => state.pads, maxTouchPoints: 0 },
    };
    const restores = [];
    for (const [key, value] of Object.entries(globals)) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        restores.push(() => {
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        });
    }

    const input = new InputManager();
    // Globals must outlive dispose(): the manager unregisters its window listeners there.
    t.after(() => {
        input.dispose();
        for (const restore of restores) restore();
    });

    const dispatch = (type, event) => listeners.get(type)?.({ preventDefault() {}, ...event });
    const keydown = (event = {}) => dispatch('keydown', { code: 'KeyW', key: 'w', repeat: false, target: null, ...event });
    const keyup = (event = {}) => dispatch('keyup', { code: 'KeyW', key: 'w', target: null, ...event });
    const mousedown = (event = {}) => dispatch('mousedown', { button: 0, target: null, ...event });
    const tap = (event = {}) => { keydown(event); keyup(event); };

    return { input, doc, state, pads, keydown, keyup, mousedown, tap };
}

const inputElement = (type) => ({ tagName: 'INPUT', getAttribute: () => type });

test('a fresh key press means continue for exactly one frame', (t) => {
    const { input, tap } = setup(t);
    tap();
    assert.equal(input.wasPressed('Continue'), true);
    assert.equal(input.wasPressed('Continue'), false);
});

test('repeats, escape and modifier keys never mean continue', (t) => {
    const { input, tap } = setup(t);

    tap({ repeat: true });
    assert.equal(input.wasPressed('Continue'), false, 'key repeat');

    tap({ code: 'Escape', key: 'Escape' });
    assert.equal(input.wasPressed('Continue'), false, 'escape');
    assert.equal(input.wasPressed('Escape'), true, 'escape still reaches the menu path');

    const modifiers = [
        ['ShiftLeft', 'Shift'], ['ShiftRight', 'Shift'],
        ['ControlLeft', 'Control'], ['ControlRight', 'Control'],
        ['AltLeft', 'Alt'], ['AltRight', 'AltGraph'],
        ['MetaLeft', 'Meta'], ['MetaRight', 'Meta'],
        ['CapsLock', 'CapsLock'],
    ];
    for (const [code, key] of modifiers) {
        tap({ code, key });
        assert.equal(input.wasPressed('Continue'), false, code);
    }

    tap();
    assert.equal(input.wasPressed('Continue'), true, 'a normal key still counts');
});

test('focused or targeted interactive elements keep the key for themselves', (t) => {
    const { input, doc, tap, mousedown } = setup(t);
    const interactive = [
        inputElement('text'),
        { tagName: 'TEXTAREA' },
        { tagName: 'SELECT' },
        { tagName: 'BUTTON' },
        { tagName: 'SUMMARY' },
        { tagName: 'DIV', isContentEditable: true },
    ];

    for (const element of interactive) {
        doc.activeElement = element;
        tap({ code: 'Enter', key: 'Enter' });
        assert.equal(input.wasPressed('Continue'), false, `focused ${element.tagName}`);
        doc.activeElement = null;
        tap({ code: 'Space', key: ' ', target: element });
        assert.equal(input.wasPressed('Continue'), false, `targeted ${element.tagName}`);
        mousedown({ target: element });
        assert.equal(input.wasPressed('Continue'), false, `clicked ${element.tagName}`);
    }

    tap();
    assert.equal(input.wasPressed('Continue'), true, 'a free document still counts');
});

test('a click beside a focused summary still means continue', (t) => {
    // Opening the details with the mouse leaves the summary focused; the next click on the
    // board surface is decided by its own target, not by that focus (play test: the second
    // click did nothing).
    const { input, doc, mousedown } = setup(t);
    doc.activeElement = { tagName: 'SUMMARY' };
    mousedown({ target: { tagName: 'DIV' } });
    assert.equal(input.wasPressed('Continue'), true, 'the click target decides');
    mousedown({ target: { tagName: 'SUMMARY' } });
    assert.equal(input.wasPressed('Continue'), false, 'a click on the summary itself stays with it');
});

test('enter on a focused summary or button never reaches the raw key path either', (t) => {
    // The board reads wasPressed('Enter') next to the continue intent; a press that belongs to
    // the details toggle must not slip through that second door (seen in the Electron play test:
    // Enter on "Details" started the next round).
    const { input, doc, tap } = setup(t);
    for (const element of [{ tagName: 'SUMMARY' }, { tagName: 'BUTTON', getAttribute: () => 'menu' }]) {
        doc.activeElement = element;
        tap({ code: 'Enter', key: 'Enter', target: element });
        assert.equal(input.wasPressed('Enter'), false, `enter on ${element.tagName} stays with the element`);
        tap({ code: 'Space', key: ' ', target: element });
        assert.equal(input.wasPressed('Space'), false, `space on ${element.tagName} stays with the element`);
        doc.activeElement = null;
    }
    tap({ code: 'Enter', key: 'Enter' });
    assert.equal(input.wasPressed('Enter'), true, 'a free document still delivers enter');
});

test('a primary mouse click means continue, other buttons do not', (t) => {
    const { input, mousedown } = setup(t);
    mousedown({ button: 2 });
    assert.equal(input.wasPressed('Continue'), false, 'secondary button');
    mousedown();
    assert.equal(input.wasPressed('Continue'), true);
    assert.equal(input.wasPressed('Continue'), false);
});

test('gamepad buttons count on the rising edge, the bound pause button never does', (t) => {
    const { input, pads } = setup(t, { padCount: 4 });

    pads[0].buttons[0].pressed = true;
    assert.equal(input.wasPressed('Continue'), true, 'fresh button');
    assert.equal(input.wasPressed('Continue'), false, 'held button');
    pads[0].buttons[0].pressed = false;
    input.wasPressed('Continue');

    pads[0].buttons[9].pressed = true;
    assert.equal(input.wasPressed('Continue'), false, 'default pause button');
    pads[0].buttons[9].pressed = false;
    input.wasPressed('Continue');

    for (const slot of [1, 3]) {
        pads[slot].buttons[3].pressed = true;
        assert.equal(input.wasPressed('Continue'), true, `pad ${slot + 1}`);
        pads[slot].buttons[3].pressed = false;
        input.wasPressed('Continue');
    }

    pads[0].axes[0] = 1;
    pads[0].axes[1] = -1;
    assert.equal(input.wasPressed('Continue'), false, 'axes never count');
});

test('a rebound pause button moves the reservation with it', (t) => {
    const { input, pads } = setup(t, { padCount: 1 });
    input.setBindings({ GAMEPAD_1: { ...normalizeGamepadControls(), PAUSE: 8 } });

    pads[0].buttons[8].pressed = true;
    assert.equal(input.wasPressed('Continue'), false, 'rebound pause button 8');
    pads[0].buttons[8].pressed = false;
    input.wasPressed('Continue');

    pads[0].buttons[9].pressed = true;
    assert.equal(input.wasPressed('Continue'), true, 'button 9 is free again');
});

test('a hidden or unfocused document reports no gamepad continue', (t) => {
    const { input, pads, state } = setup(t, { padCount: 1 });

    state.hidden = true;
    pads[0].buttons[0].pressed = true;
    assert.equal(input.wasPressed('Continue'), false, 'hidden document');
    state.hidden = false;
    pads[0].buttons[0].pressed = false;
    input.wasPressed('Continue');

    state.focused = false;
    pads[0].buttons[1].pressed = true;
    assert.equal(input.wasPressed('Continue'), false, 'unfocused document');
    state.focused = true;
    pads[0].buttons[1].pressed = false;
    input.wasPressed('Continue');

    pads[0].buttons[2].pressed = true;
    assert.equal(input.wasPressed('Continue'), true, 'a focused document counts again');
});

test('clearContinueIntent drops a pending press without touching other keys', (t) => {
    const { input, tap, mousedown } = setup(t);
    tap();
    mousedown();
    tap({ code: 'Enter', key: 'Enter' });
    input.clearContinueIntent();
    assert.equal(input.wasPressed('Continue'), false, 'pending intent dropped');
    assert.equal(input.wasPressed('Enter'), true, 'enter is untouched');

    tap();
    assert.equal(input.wasPressed('Continue'), true, 'later presses still count');
});

test('clearInputState also drops the continue intent', (t) => {
    const { input, tap } = setup(t);
    tap();
    input.clearInputState('test');
    assert.equal(input.wasPressed('Continue'), false);
});

test('existing Enter and Escape behaviour is unchanged', (t) => {
    const { input, tap } = setup(t);
    tap({ code: 'Enter', key: 'Enter' });
    assert.equal(input.wasPressed('Enter'), true);
    assert.equal(input.wasPressed('Enter'), false);
    tap({ code: 'Escape', key: 'Escape' });
    assert.equal(input.wasPressed('Escape'), true);
    assert.equal(input.wasPressed('Escape'), false);
});

test('the headless kernel adapter speaks the same Continue interface', () => {
    assert.equal(createHeadlessInputAdapter({}).wasPressed('Continue'), false);
    assert.equal(createHeadlessInputAdapter({ commands: ['Continue'] }).wasPressed('Continue'), true);
    assert.equal(createHeadlessInputAdapter({ commands: ['Escape'] }).wasPressed('Continue'), false);
});
