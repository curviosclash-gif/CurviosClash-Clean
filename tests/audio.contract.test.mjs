import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../src/core/Audio.js';

function createMockWindow() {
    const listeners = new Map();
    const removed = [];

    const removeListener = (type, listener) => {
        const entries = listeners.get(type) || [];
        listeners.set(type, entries.filter((entry) => entry !== listener));
        removed.push({ type, listener });
    };

    const mockWindow = {
        addEventListener(type, listener, options = {}) {
            const entries = listeners.get(type) || [];
            entries.push(listener);
            listeners.set(type, entries);
            const signal = options && typeof options === 'object' ? options.signal : null;
            if (signal && typeof signal.addEventListener === 'function') {
                signal.addEventListener('abort', () => removeListener(type, listener), { once: true });
            }
        },
        removeEventListener(type, listener) {
            removeListener(type, listener);
        },
        dispatchEvent(event) {
            const payload = event && typeof event === 'object' ? event : { type: String(event || '') };
            const type = String(payload.type || '');
            const entries = [...(listeners.get(type) || [])];
            for (const listener of entries) {
                listener.call(mockWindow, payload);
            }
            return true;
        },
        getRemovedTypesForListener(listener) {
            return removed.filter((entry) => entry.listener === listener).map((entry) => entry.type).sort();
        },
    };

    return mockWindow;
}

function withMockWindow(run) {
    const originalWindow = globalThis.window;
    const mockWindow = createMockWindow();
    globalThis.window = mockWindow;
    return Promise.resolve()
        .then(() => run(mockWindow))
        .finally(() => {
            if (typeof originalWindow === 'undefined') {
                delete globalThis.window;
            } else {
                globalThis.window = originalWindow;
            }
        });
}

test('AudioManager registers and disposes init/mute listeners', async () => {
    await withMockWindow(async (mockWindow) => {
        const audio = new AudioManager();
        const initHandler = audio._onInitInteraction;
        const muteHandler = audio._onMuteToggle;

        audio.dispose();

        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'touchstart']);
        assert.deepEqual(mockWindow.getRemovedTypesForListener(muteHandler), ['keydown']);
    });
});

test('AudioManager init failure enables silent fallback and warning', async () => {
    await withMockWindow(async (mockWindow) => {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args.map((value) => String(value)).join(' '));
        mockWindow.AudioContext = class ThrowingAudioContext {
            constructor() {
                throw new Error('audio-init-boom');
            }
        };

        let audio = null;
        try {
            audio = new AudioManager();
            mockWindow.dispatchEvent({ type: 'click' });

            assert.equal(audio.enabled, false);
            assert.equal(Boolean(audio.ctx), false);
            assert.equal(audio._audioInitFailed, true);
            assert.ok(warnings.length > 0);
            assert.match(warnings[0], /AudioContext initialization failed/);
        } finally {
            if (audio) {
                audio.dispose();
            }
            console.warn = originalWarn;
        }
    });
});

test('AudioManager mute toggle uses debug path instead of console.log', async () => {
    await withMockWindow(async () => {
        const originalLog = console.log;
        const originalDebug = console.debug;
        let logCalls = 0;
        let debugCalls = 0;
        console.log = () => {
            logCalls += 1;
        };
        console.debug = () => {
            debugCalls += 1;
        };

        const audio = new AudioManager();
        try {
            const initialEnabled = audio.enabled;
            globalThis.window.dispatchEvent({ type: 'keydown', code: 'KeyM' });

            assert.equal(initialEnabled, true);
            assert.equal(audio.enabled, false);
            assert.equal(logCalls, 0);
            assert.equal(debugCalls, 0);
        } finally {
            audio.dispose();
            console.log = originalLog;
            console.debug = originalDebug;
        }
    });
});

test('AudioManager respects cooldown throttling', async () => {
    await withMockWindow(async () => {
        const audio = new AudioManager();
        try {
            let now = 1_000;
            let playCalls = 0;

            audio.ctx = {
                state: 'running',
                resume() {},
                close() {
                    return Promise.resolve();
                },
            };
            audio._resolveTime = () => now;
            audio._playShoot = () => {
                playCalls += 1;
            };

            audio.play('SHOOT');
            audio.play('SHOOT');
            now += audio.cooldowns.SHOOT;
            audio.play('SHOOT');

            assert.equal(audio.cooldowns.SHOOT, 100);
            assert.equal(playCalls, 2);
            assert.deepEqual(audio.getRecentEvents(5).map((entry) => entry.type), ['SHOOT', 'SHOOT']);
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager supports dedicated parcours sound families with distinct cooldowns', async () => {
    await withMockWindow(async () => {
        const audio = new AudioManager();
        try {
            const played = [];
            audio.ctx = {
                state: 'running',
                resume() {},
                close() {
                    return Promise.resolve();
                },
            };
            audio._resolveTime = () => 1_000;
            audio._playParcoursCheckpoint = () => played.push('PARCOURS_CP');
            audio._playParcoursBranch = () => played.push('PARCOURS_BRANCH');
            audio._playParcoursFinish = () => played.push('PARCOURS_FINISH');

            audio.play('PARCOURS_CP');
            audio.play('PARCOURS_BRANCH');
            audio.play('PARCOURS_FINISH');

            assert.equal(audio.cooldowns.PARCOURS_CP, 80);
            assert.equal(audio.cooldowns.PARCOURS_BRANCH, 140);
            assert.equal(audio.cooldowns.PARCOURS_FINISH, 650);
            assert.deepEqual(played, ['PARCOURS_CP', 'PARCOURS_BRANCH', 'PARCOURS_FINISH']);
            assert.deepEqual(
                audio.getRecentEvents(5).map((entry) => entry.type),
                ['PARCOURS_CP', 'PARCOURS_BRANCH', 'PARCOURS_FINISH']
            );
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager initializes once on first interaction and removes init listeners', async () => {
    await withMockWindow(async (mockWindow) => {
        let constructorCalls = 0;
        let closeCalls = 0;
        mockWindow.AudioContext = class MockAudioContext {
            constructor() {
                constructorCalls += 1;
                this.sampleRate = 44_100;
                this.currentTime = 0;
                this.state = 'running';
                this.destination = {};
            }

            createBuffer(channels, bufferSize) {
                return {
                    numberOfChannels: channels,
                    length: bufferSize,
                    getChannelData() {
                        return new Float32Array(bufferSize);
                    },
                };
            }

            close() {
                closeCalls += 1;
                return Promise.resolve();
            }
        };

        const audio = new AudioManager();
        const initHandler = audio._onInitInteraction;
        mockWindow.dispatchEvent({ type: 'click' });
        mockWindow.dispatchEvent({ type: 'click' });

        assert.equal(constructorCalls, 1);
        assert.equal(Boolean(audio.buffers.explosion), true);
        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'touchstart']);

        audio.dispose();
        assert.ok(closeCalls >= 1);
    });
});
