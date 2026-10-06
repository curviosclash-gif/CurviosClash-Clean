import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';

function withGlobals(values, fn) {
    const restores = [];
    for (const [name, value] of Object.entries(values)) {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
        restores.push(() => {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        });
    }
    try {
        return fn();
    } finally {
        restores.reverse().forEach((restore) => restore());
    }
}

function createElementStub() {
    const attributes = {};
    return {
        dataset: {},
        style: { setProperty() {}, removeProperty() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        removeChild(child) { this.children = this.children.filter((entry) => entry !== child); },
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) { attributes[name] = value; },
        getAttribute: (name) => attributes[name],
        removeAttribute(name) { delete attributes[name]; },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    };
}

function createDocumentStub() {
    const body = createElementStub();
    return {
        documentElement: { dataset: {}, clientWidth: 800, clientHeight: 400 },
        defaultView: { innerWidth: 800, innerHeight: 400 },
        body,
        createElement: () => createElementStub(),
        getElementById: () => null,
        addEventListener() {},
        removeEventListener() {},
    };
}

function resolveSource({ coarsePointer }) {
    return withGlobals({
        window: {
            ontouchstart: null,
            matchMedia: (query) => ({ matches: coarsePointer && query === '(pointer: coarse)' }),
            addEventListener() {},
            removeEventListener() {},
        },
        navigator: { maxTouchPoints: 10, getGamepads: () => [] },
        document: createDocumentStub(),
    }, () => {
        const source = createPreferredMatchInputSource({
            inputManager: { getKeyboardInput: () => ({ keyboard: true }) },
            playerIndex: 0,
            localHumanCount: 1,
            game: { settings: { localSettings: {} } },
        });
        source.bind(0);
        const polled = source.poll();
        source.dispose();
        return polled;
    });
}

test('a touch-capable desktop with a mouse keeps keyboard input for player one', () => {
    const polled = resolveSource({ coarsePointer: false });
    assert.equal(polled?.keyboard, true, 'touch laptops and touch monitors must not lose the keyboard');
});

test('a device whose primary pointer is a finger still gets touch controls', () => {
    const polled = resolveSource({ coarsePointer: true });
    assert.notEqual(polled?.keyboard, true, 'phones and tablets keep the on-screen controls');
});
