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

function resolveSource({ coarsePointer, appMode = 'web', appTarget = 'default', mouseSteering = false, mobileClassic = false, mobileArcade = false }) {
    const document = createDocumentStub();
    document.documentElement.dataset.appTarget = appTarget;
    return withGlobals({
        window: {
            ontouchstart: null,
            matchMedia: (query) => ({ matches: coarsePointer && query === '(pointer: coarse)' }),
            addEventListener() {},
            removeEventListener() {},
        },
        navigator: { maxTouchPoints: 10, getGamepads: () => [] },
        document,
        __APP_MODE__: appMode,
        __APP_TARGET__: appTarget,
    }, () => {
        const source = createPreferredMatchInputSource({
            inputManager: { getKeyboardInput: () => ({ keyboard: true }) },
            playerIndex: 0,
            localHumanCount: 1,
            game: {
                _mobileClassicAppTarget: mobileClassic,
                _mobileArcadeAppTarget: mobileArcade,
                settings: { localSettings: { mouseSteering } },
            },
        });
        source.bind(0);
        const result = { type: source.type, polled: source.poll() };
        source.dispose();
        return result;
    });
}

test('a touch-capable desktop with a mouse keeps keyboard input for player one', () => {
    const result = resolveSource({ coarsePointer: false });
    assert.equal(result.polled?.keyboard, true, 'touch laptops and touch monitors must not lose the keyboard');
});

test('a device whose primary pointer is a finger still gets touch controls', () => {
    const result = resolveSource({ coarsePointer: true });
    assert.notEqual(result.polled?.keyboard, true, 'phones and tablets keep the on-screen controls');
    assert.equal(result.type, 'touch');
});

test('a coarse-touch desktop app keeps keyboard input instead of replacing it with touch', () => {
    // 'default' is the dist-app build, 'game' the packaged game export.
    for (const appTarget of ['default', 'game']) {
        const result = resolveSource({ coarsePointer: true, appMode: 'app', appTarget });
        assert.equal(result.polled?.keyboard, true, appTarget);
        assert.equal(result.type, 'keyboard', appTarget);
    }
});

test('a coarse-touch desktop app keeps its opt-in mouse-steering source', () => {
    const result = resolveSource({
        coarsePointer: true,
        appMode: 'app',
        appTarget: 'default',
        mouseSteering: true,
    });
    assert.equal(result.polled?.keyboard, true);
    assert.equal(result.type, 'mouse');
});

test('mobile app targets still prefer touch controls on a coarse pointer', () => {
    for (const result of [
        resolveSource({
            coarsePointer: true,
            appMode: 'app',
            appTarget: 'mobile-classic',
            mobileClassic: true,
        }),
        resolveSource({
            coarsePointer: true,
            appMode: 'app',
            appTarget: 'mobile-arcade',
            mobileArcade: true,
        }),
    ]) {
        assert.notEqual(result.polled?.keyboard, true);
        assert.equal(result.type, 'touch');
    }
});
