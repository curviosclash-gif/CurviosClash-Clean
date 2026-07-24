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

function createMockAudioContext() {
    return class MockAudioContext {
        constructor() {
            this.sampleRate = 44_100;
            this.currentTime = 0;
            this.state = 'running';
            this.destination = {};
            this.gains = [];
            this.oscillators = [];
        }

        createGain() {
            const gain = {
                gain: {
                    value: 1,
                    cancelScheduledValues() {},
                    setValueAtTime(value) { this.value = value; },
                    exponentialRampToValueAtTime() {},
                    setTargetAtTime(value) { this.value = value; },
                },
                connect() { return this; },
            };
            this.gains.push(gain);
            return gain;
        }

        createOscillator() {
            const osc = {
                type: 'sine',
                frequency: {
                    value: 440,
                    setValueAtTime(value) { this.value = value; },
                    exponentialRampToValueAtTime() {},
                    linearRampToValueAtTime() {},
                    setTargetAtTime(value) { this.value = value; },
                },
                connect() { return this; },
                start() {},
                stop() {},
            };
            this.oscillators.push(osc);
            return osc;
        }

        createBiquadFilter() {
            return {
                type: 'lowpass',
                Q: { value: 1 },
                frequency: {
                    value: 1000,
                    setValueAtTime(value) { this.value = value; },
                    exponentialRampToValueAtTime() {},
                    linearRampToValueAtTime() {},
                    setTargetAtTime(value) { this.value = value; },
                },
                connect() { return this; },
            };
        }

        createStereoPanner() {
            return {
                pan: { value: 0 },
                connect() { return this; },
            };
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

        createBufferSource() {
            return {
                buffer: null,
                connect() { return this; },
                start() {},
                stop() {},
            };
        }

        resume() {
            this.state = 'running';
            return Promise.resolve();
        }

        close() {
            this.state = 'closed';
            return Promise.resolve();
        }
    };
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

test('AudioManager registers and disposes init listeners without KeyM mute binding', async () => {
    await withMockWindow(async (mockWindow) => {
        const audio = new AudioManager();
        const initHandler = audio._onInitInteraction;

        audio.dispose();

        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'touchstart']);
        assert.equal(audio._onMuteToggle, undefined);
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

test('AudioManager mute toggle uses API instead of KeyM', async () => {
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
            assert.equal(audio.isMuted(), false);
            assert.equal(audio.toggleMute(), true);
            assert.equal(audio.isMuted(), true);
            assert.equal(audio.enabled, false);
            assert.equal(audio.setMuted(false), false);
            assert.equal(audio.isMuted(), false);
            assert.equal(logCalls, 0);
            assert.equal(debugCalls, 0);
        } finally {
            audio.dispose();
            console.log = originalLog;
            console.debug = originalDebug;
        }
    });
});

test('AudioManager master volume clamps and applies to bus', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();

        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            assert.ok(audio._masterGain);
            assert.ok(audio._sfxGain);
            assert.ok(audio._engineGain);
            assert.equal(audio.setMasterVolume(0.4), 0.4);
            assert.equal(audio.getMasterVolume(), 0.4);
            assert.equal(audio._masterGain.gain.value, 0.4);
            audio.setMuted(true);
            assert.equal(audio._masterGain.gain.value, 0);
            audio.setMuted(false);
            assert.equal(audio._masterGain.gain.value, 0.4);
            assert.equal(audio.setMasterVolume(2), 1);
            assert.equal(audio.setMasterVolume(-1), 0);
            assert.equal(audio.setSfxVolume(0.5), 0.5);
            assert.equal(audio._sfxGain.gain.value, 0.5);
            assert.equal(audio.setEngineVolume(0.25), 0.25);
            assert.equal(audio._engineGain.gain.value, 0.25);
        } finally {
            audio.dispose();
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

test('AudioManager supports dedicated parcours, fight and interaction families', async () => {
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
            audio._playParcoursWrong = () => played.push('PARCOURS_WRONG');
            audio._playParcoursTimeout = () => played.push('PARCOURS_TIMEOUT');
            audio._playFightKill = () => played.push('FIGHT_KILL');
            audio._playFightAssist = () => played.push('FIGHT_ASSIST');
            audio._playFightLead = () => played.push('FIGHT_LEAD');
            audio._playPortal = () => played.push('PORTAL');
            audio._playSlingshot = () => played.push('SLINGSHOT');
            audio._playPickup = () => played.push('PICKUP');
            audio._playBoost = () => played.push('BOOST');
            audio._playUiDrop = () => played.push('UI_DROP');

            for (const type of [
                'PARCOURS_CP',
                'PARCOURS_BRANCH',
                'PARCOURS_FINISH',
                'PARCOURS_WRONG',
                'PARCOURS_TIMEOUT',
                'FIGHT_KILL',
                'FIGHT_ASSIST',
                'FIGHT_LEAD',
                'PORTAL',
                'SLINGSHOT',
                'PICKUP',
                'BOOST',
                'UI_DROP',
            ]) {
                audio.play(type);
            }

            assert.equal(audio.cooldowns.PARCOURS_WRONG, 420);
            assert.equal(audio.cooldowns.PORTAL, 320);
            assert.equal(audio.cooldowns.PICKUP, 280);
            assert.deepEqual(played, [
                'PARCOURS_CP',
                'PARCOURS_BRANCH',
                'PARCOURS_FINISH',
                'PARCOURS_WRONG',
                'PARCOURS_TIMEOUT',
                'FIGHT_KILL',
                'FIGHT_ASSIST',
                'FIGHT_LEAD',
                'PORTAL',
                'SLINGSHOT',
                'PICKUP',
                'BOOST',
                'UI_DROP',
            ]);
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager initializes once on first interaction and removes init listeners', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();

        const audio = new AudioManager();
        const initHandler = audio._onInitInteraction;
        mockWindow.dispatchEvent({ type: 'click' });
        mockWindow.dispatchEvent({ type: 'click' });

        assert.equal(Boolean(audio.buffers.explosion), true);
        assert.ok(audio._masterGain);
        assert.ok(audio._sfxGain);
        assert.ok(audio._engineGain);
        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'touchstart']);

        audio.dispose();
        assert.equal(audio.ctx, null);
    });
});

test('AudioManager HIT and SHOOT pass intensity into synth helpers', async () => {
    await withMockWindow(async () => {
        const audio = new AudioManager();
        try {
            const seen = [];
            audio.ctx = {
                state: 'running',
                resume() {},
                close() {
                    return Promise.resolve();
                },
            };
            audio._resolveTime = () => 1_000;
            audio._playHit = (options) => seen.push(['HIT', options.intensity]);
            audio._playShoot = (options) => seen.push(['SHOOT', options.intensity]);

            audio.play('HIT', { intensity: 0.55 });
            audio.play('SHOOT', { intensity: 1.1 });

            assert.deepEqual(seen, [
                ['HIT', 0.55],
                ['SHOOT', 1.1],
            ]);
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager engine loop follows local player speed and stops when idle', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            audio.syncEngineFromPlayers([
                { index: 0, isBot: true, alive: true, speed: 40, baseSpeed: 20, isBoosting: true },
                { index: 1, isBot: false, alive: true, speed: 30, baseSpeed: 20, isBoosting: false },
            ], { localPlayerIndex: 1 });

            assert.ok(audio._engine);
            assert.equal(audio._engine.active, true);

            audio.syncEngineFromPlayers([
                { index: 1, isBot: false, alive: false, speed: 0, baseSpeed: 20 },
            ], { localPlayerIndex: 1 });
            assert.equal(audio._engine.active, false);

            audio.updateEngine({ alive: true, speed: 22, baseSpeed: 18, boosting: true });
            assert.equal(audio._engine.active, true);
            audio.stopEngine();
            assert.equal(audio._engine.active, false);
        } finally {
            audio.dispose();
        }
    });
});
