import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../src/core/Audio.js';
import { ProceduralMusicDirector } from '../src/core/audio/ProceduralMusicDirector.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_MAPS } from '../src/core/config/maps/presets/notre_dame_fire/index.js';

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
            this.panners = [];
            this.stereoPanners = [];
            this.mediaSources = [];
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
                disconnect() { this.disconnected = true; },
                disconnected: false,
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
                    setTargetAtTime(value) {
                        this.value = value;
                        this.targetCalls = (this.targetCalls || 0) + 1;
                    },
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
            const panner = {
                pan: { value: 0 },
                connect() { return this; },
            };
            this.stereoPanners.push(panner);
            return panner;
        }

        createPanner() {
            const panner = {
                panningModel: 'equalpower',
                distanceModel: 'inverse',
                refDistance: 1,
                maxDistance: 10000,
                rolloffFactor: 1,
                positionX: { value: 0 },
                positionY: { value: 0 },
                positionZ: { value: 0 },
                connect() { return this; },
            };
            this.panners.push(panner);
            return panner;
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
            const source = {
                buffer: null,
                loop: false,
                // The real AudioBufferSourceNode carries this; the explosion voice
                // detunes chained blasts through it.
                playbackRate: { value: 1 },
                connect() { return this; },
                start(...args) {
                    this.started = true;
                    this.startArgs = args;
                },
                stop() { this.stopped = true; },
                started: false,
                stopped: false,
                startArgs: [],
            };
            this.bufferSources = this.bufferSources || [];
            this.bufferSources.push(source);
            return source;
        }

        createMediaElementSource(element) {
            const source = {
                element,
                connect() { return this; },
                disconnect() { this.disconnected = true; },
                disconnected: false,
            };
            this.mediaSources.push(source);
            return source;
        }

        resume() {
            this.state = 'running';
            return Promise.resolve();
        }

        close() {
            this.state = 'closed';
            return Promise.resolve();
        }

        decodeAudioData(bytes) {
            return Promise.resolve({ duration: 8, byteLength: bytes.byteLength });
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

        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'pointerdown', 'touchstart']);
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

test('AudioManager initializes dedicated music, UI and ambience buses', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager({
            masterVolume: 0.4,
            musicVolume: 0.3,
            uiVolume: 0.6,
            ambienceVolume: 0.2,
        });
        try {
            mockWindow.dispatchEvent({ type: 'click' });

            assert.ok(audio._musicGain);
            assert.match(audio.thirdPartyAudioNoticeUrl, /THIRD_PARTY_NOTICES\.txt/);
            assert.ok(audio._uiGain);
            assert.ok(audio._ambienceGain);
            assert.equal(audio._musicGain.gain.value, 0.3);
            assert.equal(audio._uiGain.gain.value, 0.6);
            assert.equal(audio._ambienceGain.gain.value, 0.2);
            assert.equal(audio.music.state, 'menu');
            assert.ok(audio.music._sceneGain);
        } finally {
            audio.dispose();
        }
    });
});

test('Notre-Dame ambience crossfades by zone, rings on the shared beat and cleans up', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        const map = NOTRE_DAME_MAPS.notre_dame;
        const mapScale = 3;
        const player = {
            index: 0,
            alive: true,
            isBot: false,
            position: { x: -220 * mapScale, y: 22 * mapScale, z: 0 },
        };
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            assert.equal(audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: { id: 'grid' },
                mapScale,
                elapsedSeconds: 0,
            }), 'none');
            assert.equal(audio._mapAmbience, null);
            assert.equal(audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 0,
            }), 'outdoor');
            const state = audio._mapAmbience;
            const outdoorSource = state.outdoor.source;
            assert.ok(outdoorSource.started);
            assert.ok(state.outdoor.gain.gain.value > state.interior.gain.gain.value);

            player.position.x = -40 * mapScale;
            player.position.y = 28 * mapScale;
            assert.equal(audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 3.9,
            }), 'interior');
            assert.equal(audio._mapAmbience, state);
            assert.equal(state.outdoor.source, outdoorSource);
            assert.ok(state.interior.gain.gain.value > state.outdoor.gain.gain.value);

            const voicesBeforeBell = audio._activeVoices;
            audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 4.1,
            });
            assert.equal(audio._activeVoices, voicesBeforeBell + 1);
            assert.equal(audio.clearMapAmbience(), 'none');
            assert.equal(state.zone, 'none');

            audio.dispose();
            assert.equal(outdoorSource.stopped, true);
            assert.equal(audio._mapAmbience, null);
        } finally {
            if (audio.ctx) audio.dispose();
        }
    });
});

test('Notre-Dame fire ambience uses deterministic fire and wind layers without the construction mix', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        const map = NOTRE_DAME_FIRE_MAPS.notre_dame_fire;
        const mapScale = 3;
        const player = {
            index: 0,
            alive: true,
            isBot: false,
            position: { x: -40 * mapScale, y: 28 * mapScale, z: 0 },
        };
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            assert.equal(audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 10,
            }), 'interior');
            const state = audio._mapAmbience;
            const fireSource = state.fire.source;
            assert.ok(state.fire.gain.gain.value > state.construction.gain.gain.value);
            assert.ok(state.wind.gain.gain.value > state.machinery.gain.gain.value);

            const voicesBeforeCollapse = audio._activeVoices;
            audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 11.1,
            });
            assert.equal(audio._activeVoices, voicesBeforeCollapse + 1);

            assert.equal(audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: NOTRE_DAME_MAPS.notre_dame,
                mapScale,
                elapsedSeconds: 12,
            }), 'interior');
            assert.equal(state.fire.gain.gain.value, 0.0001);
            assert.equal(state.wind.gain.gain.value, 0.0001);

            audio.syncMapAmbienceFromPlayers([player], {
                mapDefinition: map,
                mapScale,
                elapsedSeconds: 2,
            });
            assert.equal(audio._activeVoices, voicesBeforeCollapse + 1);
            audio.dispose();
            assert.equal(fireSource.stopped, true);
            assert.equal(audio._mapAmbience, null);
        } finally {
            if (audio.ctx) audio.dispose();
        }
    });
});

test('AudioManager prefers HRTF positioning and keeps stereo pan as fallback', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'pointerdown' });

            audio._createVoiceGraph({
                pan: -1,
                spatialPosition: { x: 4, y: 2, z: -7 },
            });
            assert.equal(audio.ctx.panners.length, 1);
            assert.equal(audio.ctx.stereoPanners.length, 0);
            assert.deepEqual({
                model: audio.ctx.panners[0].panningModel,
                rolloff: audio.ctx.panners[0].rolloffFactor,
                x: audio.ctx.panners[0].positionX.value,
                y: audio.ctx.panners[0].positionY.value,
                z: audio.ctx.panners[0].positionZ.value,
            }, {
                model: 'HRTF',
                rolloff: 0,
                x: 4,
                y: 2,
                z: -7,
            });

            audio.ctx.createPanner = undefined;
            audio._createVoiceGraph({ pan: -0.6, spatialPosition: { x: -4, y: 0, z: 2 } });
            assert.equal(audio.ctx.stereoPanners.length, 1);
            assert.equal(audio.ctx.stereoPanners[0].pan.value, -0.6);
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager maps the selected recordings to weapons, hits and explosions', async () => {
    await withMockWindow(async (mockWindow) => {
        const requestedUrls = [];
        mockWindow.AudioContext = createMockAudioContext();
        mockWindow.fetch = async (url) => {
            requestedUrls.push(String(url));
            return {
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(16),
            };
        };
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'pointerdown' });
            await audio._sampleLoadPromise;

            assert.equal(requestedUrls.length, 5);
            assert.ok(requestedUrls.some((url) => url.endsWith('/machine-gun-autocannon.wav')));
            assert.ok(requestedUrls.some((url) => url.endsWith('/rocket-launch-heavy.wav')));
            assert.ok(requestedUrls.some((url) => url.endsWith('/armor-hit-break.wav')));
            assert.ok(requestedUrls.some((url) => url.endsWith('/explosion-rocket-deep.wav')));
            assert.ok(requestedUrls.some((url) => url.endsWith('/explosion-vehicle-metal.wav')));
            assert.equal(audio.buffers.machineGun.duration, 8);
            assert.equal(audio.buffers.rocketLaunch.duration, 8);
            assert.equal(audio.buffers.armorHit.duration, 8);
            assert.equal(audio.buffers.classicalMusic, undefined);
            assert.equal(audio.buffers.fightMusic, undefined);
            assert.equal(audio.buffers.arcadeMusic, undefined);
            assert.equal(audio.buffers.rocketExplosion.duration, 8);
            assert.equal(audio.buffers.vehicleExplosion.duration, 8);

            audio._resolveTime = () => 1000;
            audio.play('MG_SHOOT');
            const recordedShot = audio.ctx.bufferSources.find((source) => source.buffer === audio.buffers.machineGun);
            assert.ok(recordedShot);
            assert.deepEqual(recordedShot.startArgs, [0, 0, 0.12]);

            audio.play('ROCKET_SHOOT');
            const rocketLaunch = audio.ctx.bufferSources.find((source) => source.buffer === audio.buffers.rocketLaunch);
            assert.ok(rocketLaunch?.started);
            assert.deepEqual(rocketLaunch.startArgs, [0, 0, 1.9]);

            audio.play('HIT');
            const armorHit = audio.ctx.bufferSources.find((source) => source.buffer === audio.buffers.armorHit);
            assert.ok(armorHit?.started);
            assert.deepEqual(armorHit.startArgs, [0, 0, 1.3]);

            audio.play('EXPLOSION');
            const vehicleBlast = audio.ctx.bufferSources.find(
                (source) => source.buffer === audio.buffers.vehicleExplosion
            );
            assert.ok(vehicleBlast?.started);
            assert.equal(
                audio.ctx.bufferSources.some((source) => source.buffer === audio.buffers.rocketExplosion),
                false
            );

            audio.play('ROCKET_IMPACT');
            const rocketBlast = audio.ctx.bufferSources.find(
                (source) => source.buffer === audio.buffers.rocketExplosion
            );
            assert.ok(rocketBlast?.started);
            assert.equal(
                audio.ctx.bufferSources.filter(
                    (source) => source.buffer === audio.buffers.vehicleExplosion
                ).length,
                1
            );
        } finally {
            audio.dispose();
        }
    });
});

test('recorded explosion tails leave voice capacity for machine-gun feedback', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        mockWindow.fetch = async () => ({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(16),
        });
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'pointerdown' });
            await audio._sampleLoadPromise;

            let now = 1000;
            audio._resolveTime = () => now;
            for (let i = 0; i < 6; i += 1) {
                audio.play('ROCKET_IMPACT');
                now += audio.cooldowns.ROCKET_IMPACT + 10;
                await new Promise((resolve) => setTimeout(resolve, audio.cooldowns.ROCKET_IMPACT + 10));
            }

            const shotsBefore = audio.ctx.bufferSources.filter((source) => source.buffer === audio.buffers.machineGun).length;
            audio.play('MG_SHOOT');
            const shotsAfter = audio.ctx.bufferSources.filter((source) => source.buffer === audio.buffers.machineGun).length;
            assert.equal(shotsAfter, shotsBefore + 1);
            assert.ok(audio._activeVoices < 18);
        } finally {
            audio.dispose();
        }
    });
});

test('AudioManager applies persistent settings and music lifecycle states', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            assert.equal(audio.setMusicState('fight', { intensity: 0.9 }), 'fight');
            assert.equal(audio.music.intensity, 0.9);
            assert.equal(audio.setPaused(true), true);
            assert.equal(audio.music.paused, true);

            const settings = audio.applySettings({
                enabled: true,
                masterVolume: 0.5,
                musicVolume: 0.25,
                sfxVolume: 0.75,
                engineVolume: 0.4,
                uiVolume: 0.65,
                ambienceVolume: 0.15,
            });

            assert.deepEqual(settings, {
                enabled: true,
                masterVolume: 0.5,
                musicVolume: 0.25,
                sfxVolume: 0.75,
                engineVolume: 0.4,
                uiVolume: 0.65,
                ambienceVolume: 0.15,
            });
            assert.equal(audio.music.paused, true);
            assert.equal(audio._musicGain.gain.value, 0.25);
        } finally {
            audio.dispose();
        }
    });
});

test('recorded music follows classic, fight and arcade modes without duplicate sources', async () => {
    await withMockWindow(async (mockWindow) => {
        const musicElements = [];
        mockWindow.AudioContext = createMockAudioContext();
        mockWindow.Audio = class MockMusicElement {
            constructor() {
                this.src = '';
                this.loop = false;
                this.paused = true;
                this.onerror = null;
                musicElements.push(this);
            }

            play() {
                this.paused = false;
                return Promise.resolve();
            }

            pause() {
                this.paused = true;
            }

            removeAttribute(name) {
                if (name === 'src') this.src = '';
            }

            load() {}
        };
        mockWindow.fetch = async () => ({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(16),
        });
        const audio = new AudioManager();
        let arcadeSource = null;
        let arcadeGain = null;
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            await audio._sampleLoadPromise;

            const menuSource = audio.music._recordedSource;
            assert.equal(menuSource?.paused, false);
            assert.equal(menuSource.loop, true);
            assert.ok(menuSource.src.endsWith('/mozart-nachtmusik-advent-chamber.mp3'));

            audio.setMusicState('classic');
            assert.equal(audio.music._recordedSource, menuSource);
            audio.setMusicState('fight');
            const fightSource = audio.music._recordedSource;
            assert.notEqual(fightSource, menuSource);
            assert.equal(fightSource.loop, true);
            assert.ok(fightSource.src.endsWith('/beethoven-5-skidmore-fight.mp3'));
            assert.equal(audio.music._recordedGain.gain.value, 1);
            assert.ok(audio.music._retiredRecordedSources.has(menuSource));

            audio.setMusicState('results');
            assert.equal(audio.music._recordedSource, fightSource);
            audio.setMusicState('arcade');
            arcadeSource = audio.music._recordedSource;
            arcadeGain = audio.music._recordedGain;
            assert.notEqual(arcadeSource, fightSource);
            assert.equal(arcadeSource.loop, true);
            assert.ok(arcadeSource.src.endsWith('/chopin-nocturne-frank-levy-arcade.mp3'));
            assert.ok(audio.music._retiredRecordedSources.has(fightSource));
            assert.equal(musicElements.length, 3);
            assert.equal(audio.ctx.mediaSources.length, 3);

            audio.setPaused(true);
            assert.equal(arcadeGain.gain.value, 0.24);
            audio.setMuted(true);
            assert.equal(arcadeSource.paused, false);
            audio.setMuted(false);
            assert.equal(audio.music._recordedSource, arcadeSource);
            audio.setPaused(false);
            assert.equal(arcadeGain.gain.value, 1);
        } finally {
            audio.dispose();
        }
        assert.equal(arcadeSource?.paused, true);
        assert.equal(arcadeGain?.disconnected, true);
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
        assert.deepEqual(mockWindow.getRemovedTypesForListener(initHandler), ['click', 'keydown', 'pointerdown', 'touchstart']);

        audio.dispose();
        assert.equal(audio.ctx, null);
    });
});

test('AudioManager initializes before pointer-driven hangar interactions', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'pointerdown' });
            audio.play('UI_PICKUP');

            assert.ok(audio.ctx);
            assert.deepEqual(audio.getRecentEvents(1).map((entry) => entry.type), ['UI_PICKUP']);
        } finally {
            audio.dispose();
        }
    });
});

test('ProceduralMusicDirector skips stale steps after scheduler throttling', () => {
    const audio = { ctx: { currentTime: 120 } };
    const director = new ProceduralMusicDirector(audio);
    let scheduledSteps = 0;
    director._generation = 1;
    director._nextStepTime = 0;
    director._scheduleStep = () => {
        scheduledSteps += 1;
    };

    director._schedule(1);

    assert.ok(scheduledSteps <= 2);
    assert.ok(director._nextStepTime > audio.ctx.currentTime);
    director.dispose();
});

test('ProceduralMusicDirector disconnects current and retired scene gains on dispose', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        mockWindow.dispatchEvent({ type: 'pointerdown' });
        const menuGain = audio.music._sceneGain;
        audio.setMusicState('race');
        const raceGain = audio.music._sceneGain;

        audio.dispose();

        assert.equal(menuGain.disconnected, true);
        assert.equal(raceGain.disconnected, true);
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
            assert.ok(audio._engine.air);
            assert.ok(audio._engine.mechanicalPulse);
            assert.equal(audio._engine.mechanicalPulse.type, 'sawtooth');
            assert.ok(audio._engine.mechanicalPulse.frequency.value > 18);
            assert.ok(audio._engine.mechanicalPulseGain.gain.value > 0.002);
            assert.ok(audio._engine.gain.gain.value < 0.08);
            assert.ok(audio._engine.turbineGain.gain.value < 0.02);
            const bodyAutomationCount = audio._engine.body.frequency.targetCalls;
            audio.updateEngine({ alive: true, speed: 22, baseSpeed: 18, boosting: true });
            assert.equal(audio._engine.body.frequency.targetCalls, bodyAutomationCount);
            audio.stopEngine();
            assert.equal(audio._engine.active, false);
        } finally {
            audio.dispose();
        }
    });
});

// Builds an AudioManager wired to the mock context, with an explosion buffer in
// place so the voice actually runs, and a clock the test drives by hand.
function createExplosionHarness() {
    const MockCtx = createMockAudioContext();
    const audio = new AudioManager();
    const ctx = new MockCtx();
    audio.ctx = ctx;
    audio.buffers.explosion = ctx.createBuffer(1, 64);
    audio._sfxOut = () => ctx.destination;
    audio._masterGain = ctx.createGain();
    audio._sfxGain = ctx.createGain();
    let now = 1_000;
    audio._resolveTime = () => now;
    return {
        audio,
        ctx,
        advance(ms) { now += ms; },
        // Every explosion starts one buffer source, so counting them counts blasts.
        blastCount() { return (ctx.bufferSources || []).filter((source) => source.started).length; },
        blastRates() { return (ctx.bufferSources || []).filter((s) => s.started).map((s) => s.playbackRate.value); },
    };
}

test('a chain reaction is heard as several blasts, not one', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            // Three kills inside a single cooldown window. Before this, the last two
            // were dropped outright and a triple kill sounded like a single death.
            audio.play('EXPLOSION');
            harness.advance(40);
            audio.play('EXPLOSION');
            harness.advance(40);
            audio.play('EXPLOSION');

            assert.equal(harness.blastCount(), 3);
            const rates = harness.blastRates();
            assert.equal(rates[0], 1, 'the first kill is the undistorted one');
            assert.notEqual(rates[1], rates[0], 'the second is detuned against the first');
            assert.notEqual(rates[2], rates[1], 'and the third against the second');
        } finally {
            audio.dispose();
        }
    });
});

test('a mass wipe stops at the chain limit instead of turning into noise', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            for (let i = 0; i < 8; i += 1) {
                audio.play('EXPLOSION');
                harness.advance(10);
            }

            // One full blast plus two echoes; everything past that stays silent.
            assert.equal(harness.blastCount(), 3);
        } finally {
            audio.dispose();
        }
    });
});

test('a kill after the window is a full blast again, not an echo', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            audio.play('EXPLOSION');
            harness.advance(20);
            audio.play('EXPLOSION');

            harness.advance(audio.cooldowns.EXPLOSION + 10);
            audio.play('EXPLOSION');

            const rates = harness.blastRates();
            assert.equal(rates.length, 3);
            assert.equal(rates.at(-1), 1, 'the chain resets once the window has passed');
        } finally {
            audio.dispose();
        }
    });
});

test('explosion echoes do not extend the original chain window', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            audio.play('EXPLOSION');
            harness.advance(audio.cooldowns.EXPLOSION - 10);
            audio.play('EXPLOSION');
            harness.advance(audio.cooldowns.EXPLOSION - 10);
            audio.play('EXPLOSION');

            const rates = harness.blastRates();
            assert.equal(rates.length, 3);
            assert.equal(rates.at(-1), 1, 'a new full blast starts outside the original window');
        } finally {
            audio.dispose();
        }
    });
});

test('the chain answer is exclusive to explosions', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            let shots = 0;
            audio._playShoot = () => { shots += 1; };

            audio.play('SHOOT');
            harness.advance(10);
            audio.play('SHOOT');

            // Rapid fire must still be throttled - only deaths get an echo.
            assert.equal(shots, 1);
        } finally {
            audio.dispose();
        }
    });
});

test('a rocket impact bypasses the explosion cooldown without spending the chain', async () => {
    await withMockWindow(async () => {
        const harness = createExplosionHarness();
        const { audio } = harness;
        try {
            // ROCKET_IMPACT drives the explosion voice directly: it is one event
            // with its own cooldown, not a death in a chain of deaths.
            audio.play('ROCKET_IMPACT');
            harness.advance(10);
            audio.play('EXPLOSION');
            harness.advance(10);
            audio.play('EXPLOSION');

            const rates = harness.blastRates();
            assert.equal(rates.length, 3, 'the impact and both deaths are all heard');
            assert.equal(rates[0], 1, 'the rocket impact is undistorted');
            assert.equal(rates[1], 1, 'the first death still gets a full blast');
            assert.notEqual(rates[2], 1, 'only the second death is an echo');
        } finally {
            audio.dispose();
        }
    });
});

test('audio can be switched back on after it was disabled at runtime', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            assert.equal(audio.applySettings({ enabled: false }).enabled, false);

            const reenabled = audio.applySettings({ enabled: true, masterVolume: 0.5 });

            assert.equal(reenabled.enabled, true);
            assert.equal(audio.enabled, true);
            assert.equal(reenabled.masterVolume, 0.5);
        } finally {
            audio.dispose();
        }
    });
});

test('a stopped engine silences its pulse modulation instead of humming on', async () => {
    await withMockWindow(async (mockWindow) => {
        mockWindow.AudioContext = createMockAudioContext();
        const audio = new AudioManager();
        try {
            mockWindow.dispatchEvent({ type: 'click' });
            audio.updateEngine({ alive: true, speed: 30, baseSpeed: 18, boosting: true });
            assert.ok(audio._engine.mechanicalPulseGain.gain.value > 0.002);

            audio.stopEngine();

            assert.equal(audio._engine.active, false);
            // mechanicalPulseGain feeds gain.gain, so any residue keeps the body
            // tone audible even though gain.gain itself is at the idle floor.
            assert.equal(audio._engine.mechanicalPulseGain.gain.value, 0);
            assert.ok(audio._engine.gain.gain.value <= 0.0001);
            assert.ok(audio._engine.turbineGain.gain.value <= 0.0001);
            assert.ok(audio._engine.airGain.gain.value <= 0.0001);

            audio.updateEngine({ alive: true, speed: 30, baseSpeed: 18, boosting: true });
            assert.ok(audio._engine.mechanicalPulseGain.gain.value > 0);
        } finally {
            audio.dispose();
        }
    });
});
