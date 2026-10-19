import assert from 'node:assert/strict';
import test from 'node:test';

import { GameLoop } from '../src/core/GameLoop.js';
import { attachGlobalRuntimeErrorHandler } from '../src/core/RuntimeErrorOverlay.js';

function installDomStub() {
    const body = { children: [] };
    const createElement = (tag) => {
        const element = {
            tag,
            id: '',
            style: {},
            textContent: '',
            children: [],
            listeners: {},
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            addEventListener(type, handler) { this.listeners[type] = handler; },
            remove() { body.children = body.children.filter((entry) => entry !== this); },
        };
        return element;
    };
    body.appendChild = (child) => { body.children.push(child); return child; };
    const document = {
        body,
        createElement,
        getElementById: (id) => body.children.find((child) => child.id === id) || null,
    };
    const listeners = {};
    const window = {
        addEventListener(type, handler) { listeners[type] = handler; },
        dispatch(type, event) { listeners[type]?.(event); },
    };
    const previous = { document: globalThis.document, window: globalThis.window, raf: globalThis.requestAnimationFrame };
    globalThis.document = document;
    globalThis.window = window;
    globalThis.requestAnimationFrame = () => 0;
    return {
        body,
        window,
        listeners,
        restore() {
            globalThis.document = previous.document;
            globalThis.window = previous.window;
            if (previous.raf === undefined) delete globalThis.requestAnimationFrame;
            else globalThis.requestAnimationFrame = previous.raf;
        },
    };
}

function findButton(element) {
    if (element.tag === 'button') return element;
    for (const child of element.children || []) {
        const found = findButton(child);
        if (found) return found;
    }
    return null;
}

test('one failing frame does not freeze the game; repeated failures still stop it with a notice', () => {
    const dom = installDomStub();
    try {
        let failures = 1;
        const loop = new GameLoop(() => {}, () => {
            if (failures > 0) {
                failures -= 1;
                throw new Error('transient render fault');
            }
        });
        loop.running = true;
        loop.lastTime = 0;
        loop._loop(16);
        assert.equal(loop.running, true, 'a single bad frame is skipped, not fatal');
        assert.equal(dom.body.children.length, 0, 'a recovered frame shows no error screen');
        loop._loop(32);
        assert.equal(loop.running, true);

        failures = 10;
        loop._loop(48);
        assert.equal(loop.running, true, 'a second fault within a second is still skipped');
        assert.equal(dom.body.children.length, 0);
        loop._loop(64);
        assert.equal(loop.running, false, 'the third fault within a second stops the loop');
        assert.equal(dom.body.children.length, 1, 'and explains it');
    } finally {
        dom.restore();
    }
});

test('a fault that keeps coming back between clean frames still stops the loop', () => {
    const dom = installDomStub();
    try {
        let frame = 0;
        const loop = new GameLoop(() => {}, () => {
            frame += 1;
            if (frame % 2 === 0) throw new Error('every other frame');
        });
        loop.running = true;
        loop.lastTime = 0;
        for (let step = 1; step <= 6 && loop.running; step += 1) loop._loop(step * 16);
        assert.equal(loop.running, false, 'alternating faults are not hidden forever');
        assert.equal(dom.body.children.length, 1);
    } finally {
        dom.restore();
    }
});

test('a fault in the update step skips the frame without replaying its sub-steps', () => {
    const dom = installDomStub();
    try {
        let updates = 0;
        let failNext = true;
        const loop = new GameLoop(() => {
            updates += 1;
            if (failNext) {
                failNext = false;
                throw new Error('transient update fault');
            }
        }, () => {});
        loop.running = true;
        loop.lastTime = 0;
        loop._loop(50);
        assert.equal(loop.running, true, 'a single update fault is skipped');
        assert.equal(updates, 1, 'the faulty frame stops at the failing step');
        assert.equal(loop.accumulator, 0, 'its remaining sub-steps are dropped, not replayed');
        loop._loop(66);
        assert.equal(updates, 2, 'the next frame simulates one fresh step');
    } finally {
        dom.restore();
    }
});

test('clean play forgets earlier faults', () => {
    const dom = installDomStub();
    try {
        let failing = true;
        const loop = new GameLoop(() => {}, () => {
            if (failing) throw new Error('burst');
        });
        loop.running = true;
        loop.lastTime = 0;
        let now = 0;
        const frame = () => { now += 16; loop._loop(now); };
        frame();
        frame();
        failing = false;
        for (let clean = 0; clean < 60; clean += 1) frame();
        failing = true;
        frame();
        frame();
        assert.equal(loop.running, true, 'a new burst after a clean second starts counting from zero');
        frame();
        assert.equal(loop.running, false);
    } finally {
        dom.restore();
    }
});

test('benign browser errors stay off screen, real ones get a dismissable notice', () => {
    const dom = installDomStub();
    try {
        attachGlobalRuntimeErrorHandler();
        dom.window.dispatch('error', { message: 'ResizeObserver loop completed with undelivered notifications.' });
        dom.window.dispatch('error', { message: 'Script error.', filename: '' });
        assert.equal(dom.body.children.length, 0, 'ResizeObserver and opaque cross-origin errors are not fatal');

        dom.window.dispatch('error', { message: 'boom', filename: 'main.js', lineno: 3, colno: 4, error: new Error('boom') });
        assert.equal(dom.body.children.length, 1);
        const closeButton = findButton(dom.body.children[0]);
        assert.ok(closeButton, 'the error screen offers a way out');
        closeButton.listeners.click();
        assert.equal(dom.body.children.length, 0);

        assert.equal(typeof dom.listeners.unhandledrejection, 'function', 'async failures are no longer silent');
        dom.window.dispatch('unhandledrejection', { reason: new Error('late async failure') });
        assert.equal(dom.body.children.length, 0, 'an async failure is logged, not put over the game');
    } finally {
        dom.restore();
    }
});
