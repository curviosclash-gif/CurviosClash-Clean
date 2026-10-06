import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeDiagnosticsSystem } from '../src/core/RuntimeDiagnosticsSystem.js';

function withBrowserStub(run) {
    const listeners = new Map();
    const body = {
        children: [],
        appendChild(child) { this.children.push(child); child.remove = () => { this.children = this.children.filter((entry) => entry !== child); }; },
    };
    const window = {
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type) { listeners.delete(type); },
        dispatchEvent(event) { listeners.get(event.type)?.(event); },
    };
    const document = { body, createElement: () => ({ style: {} }) };
    const previous = { window: globalThis.window, document: globalThis.document };
    globalThis.window = window;
    globalThis.document = document;
    try {
        return run({ window, body });
    } finally {
        globalThis.window = previous.window;
        globalThis.document = previous.document;
    }
}

function createAccess({ state, humanCount, qualityCalls }) {
    const playerBindings = {
        PLAYER_1: { UP: 'KeyW', CAMERA: 'KeyC' },
        PLAYER_2: { UP: 'ArrowUp', CAMERA: 'KeyV' },
        PLAYER_3: { ROLL_RIGHT: 'KeyO', CAMERA: 'KeyP' },
    };
    return {
        getKeyCaptureActive: () => false,
        getRenderer: () => ({ setQuality: (quality) => qualityCalls.push(String(quality)) }),
        getMediaRecorderSystem: () => null,
        getEntityManager: () => ({ humanPlayers: Array.from({ length: humanCount }, (_, index) => ({ index })) }),
        getPlayerKeyBindings: () => playerBindings,
        getRenderDelta: () => 1 / 60,
        getState: () => state,
        actionShowStatusToast() {},
    };
}

test('diagnostic hotkeys stay silent while an active player has the key bound', () => {
    withBrowserStub(({ window, body }) => {
        const qualityCalls = [];
        const diagnostics = new RuntimeDiagnosticsSystem(createAccess({ state: 'PLAYING', humanCount: 3, qualityCalls }));
        try {
            window.dispatchEvent({ type: 'keydown', code: 'KeyP' });
            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });
            assert.deepEqual(qualityCalls, [], 'player three camera key must not toggle graphics quality');
            assert.equal(body.children.length, 0, 'player three roll key must not open the stats overlay');
        } finally {
            diagnostics.dispose();
        }
    });
});

test('diagnostic hotkeys still work when no active player uses the key', () => {
    withBrowserStub(({ window, body }) => {
        const qualityCalls = [];
        const diagnostics = new RuntimeDiagnosticsSystem(createAccess({ state: 'PLAYING', humanCount: 1, qualityCalls }));
        try {
            window.dispatchEvent({ type: 'keydown', code: 'KeyP' });
            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });
            assert.deepEqual(qualityCalls, ['LOW']);
            assert.equal(body.children.length, 1);
        } finally {
            diagnostics.dispose();
        }
    });
});

test('holding a diagnostic hotkey does not toggle it again through key repeat', () => {
    withBrowserStub(({ window, body }) => {
        const qualityCalls = [];
        const diagnostics = new RuntimeDiagnosticsSystem(createAccess({ state: 'MENU', humanCount: 3, qualityCalls }));
        try {
            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });
            window.dispatchEvent({ type: 'keydown', code: 'KeyO', repeat: true });
            window.dispatchEvent({ type: 'keydown', code: 'KeyP' });
            window.dispatchEvent({ type: 'keydown', code: 'KeyP', repeat: true });
            assert.equal(body.children.length, 1, 'a held O keeps the overlay open');
            assert.deepEqual(qualityCalls, ['LOW'], 'a held P switches quality once');
        } finally {
            diagnostics.dispose();
        }
    });
});
