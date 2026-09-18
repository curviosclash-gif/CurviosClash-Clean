import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ROCKET_WARNING_FAR_INTERVAL_MS,
    ROCKET_WARNING_NEAR_INTERVAL_MS,
    createRocketWarningAudioState,
    resolveLocalHumanCount,
    updateRocketWarningAudio,
} from '../src/entities/systems/projectile/RocketWarningAudioOps.js';
import { AudioManager } from '../src/core/Audio.js';
import { playGameplayVoice } from '../src/core/audio/GameplayVoices.js';

function createAudioSpy() {
    const calls = [];
    return {
        calls,
        play(type, options = {}) {
            calls.push({ type, intensity: Number(options.intensity) });
        },
    };
}

function createPlayer(index, overrides = {}) {
    return { index, isBot: false, alive: true, ...overrides };
}

function createThreat(overrides = {}) {
    return {
        active: true,
        count: 1,
        nearestDistance: 90,
        timeToImpactSeconds: 4,
        ...overrides,
    };
}

// Hands out one threat entry per player index, like ProjectileSystem.getRocketThreat.
function createThreatSource(entries) {
    const inactive = createThreat({ active: false, count: 0, nearestDistance: 0, timeToImpactSeconds: 0 });
    return (index) => entries[index] || inactive;
}

test('a rocket that locks on warns the local player at once', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0)];
    const threats = [createThreat()];

    updateRocketWarningAudio(state, players, createThreatSource(threats), audio, 1_000, {
        localPlayerIndex: 0,
        localHumanCount: 1,
    });

    assert.equal(audio.calls.length, 1);
    assert.equal(audio.calls[0].type, 'ROCKET_WARNING');
});

test('a steady far threat repeats only after the far interval', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0)];
    const source = createThreatSource([createThreat()]);
    const options = { localPlayerIndex: 0, localHumanCount: 1 };

    updateRocketWarningAudio(state, players, source, audio, 1_000, options);
    updateRocketWarningAudio(state, players, source, audio, 1_000 + ROCKET_WARNING_FAR_INTERVAL_MS - 20, options);
    assert.equal(audio.calls.length, 1, 'no second tone before the interval is over');

    updateRocketWarningAudio(state, players, source, audio, 1_000 + ROCKET_WARNING_FAR_INTERVAL_MS, options);
    assert.equal(audio.calls.length, 2, 'the tone repeats once the interval passed');
});

test('a close rocket warns faster and louder', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0)];
    const source = createThreatSource([createThreat({ nearestDistance: 18, timeToImpactSeconds: 0.8 })]);
    const options = { localPlayerIndex: 0, localHumanCount: 1 };

    updateRocketWarningAudio(state, players, source, audio, 0, options);
    updateRocketWarningAudio(state, players, source, audio, ROCKET_WARNING_NEAR_INTERVAL_MS, options);

    assert.equal(audio.calls.length, 2);
    assert.ok(ROCKET_WARNING_NEAR_INTERVAL_MS < ROCKET_WARNING_FAR_INTERVAL_MS);

    const farState = createRocketWarningAudioState();
    const farAudio = createAudioSpy();
    updateRocketWarningAudio(farState, players, createThreatSource([createThreat()]), farAudio, 0, options);
    assert.ok(audio.calls[0].intensity > farAudio.calls[0].intensity, 'a close rocket is the louder warning');
});

test('a threat that ends and returns warns again immediately', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0)];
    const active = createThreatSource([createThreat()]);
    const gone = createThreatSource([createThreat({ active: false, count: 0 })]);
    const options = { localPlayerIndex: 0, localHumanCount: 1 };

    updateRocketWarningAudio(state, players, active, audio, 0, options);
    updateRocketWarningAudio(state, players, gone, audio, 100, options);
    updateRocketWarningAudio(state, players, gone, audio, 200, options);
    assert.equal(audio.calls.length, 1, 'a gone rocket stays silent');

    updateRocketWarningAudio(state, players, active, audio, 300, options);
    assert.equal(audio.calls.length, 2, 'a new lock warns without waiting for the interval');
});

test('bots never hear a rocket warning', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0, { isBot: true })];

    updateRocketWarningAudio(state, players, createThreatSource([createThreat()]), audio, 0, {
        localPlayerIndex: 0,
        localHumanCount: 1,
    });

    assert.equal(audio.calls.length, 0);
});

test('a remote player under fire stays silent on this machine', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0), createPlayer(1)];
    const threats = [createThreat(), undefined];

    updateRocketWarningAudio(state, players, createThreatSource(threats), audio, 0, {
        localPlayerIndex: 1,
        localHumanCount: 1,
    });

    assert.equal(audio.calls.length, 0, 'only the local viewport warns');
});

test('dead players, ended rounds and a missing audio system stay silent', () => {
    const source = createThreatSource([createThreat()]);
    const options = { localPlayerIndex: 0, localHumanCount: 1 };

    const deadAudio = createAudioSpy();
    updateRocketWarningAudio(
        createRocketWarningAudioState(), [createPlayer(0, { alive: false })], source, deadAudio, 0, options,
    );
    assert.equal(deadAudio.calls.length, 0);

    const endedAudio = createAudioSpy();
    updateRocketWarningAudio(
        createRocketWarningAudioState(), [createPlayer(0)], source, endedAudio, 0,
        { ...options, roundEnded: true },
    );
    assert.equal(endedAudio.calls.length, 0);

    assert.doesNotThrow(() => {
        updateRocketWarningAudio(createRocketWarningAudioState(), [createPlayer(0)], source, null, 0, options);
        updateRocketWarningAudio(createRocketWarningAudioState(), [createPlayer(0)], null, createAudioSpy(), 0, options);
        updateRocketWarningAudio(null, null, source, createAudioSpy(), 0, options);
    });
});

test('two threatened local players share a single tone per tick', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0), createPlayer(1)];
    const source = createThreatSource([createThreat(), createThreat()]);
    const options = { localPlayerIndex: 0, localHumanCount: 2 };

    updateRocketWarningAudio(state, players, source, audio, 0, options);
    assert.equal(audio.calls.length, 1, 'a split screen warns once, not twice');

    updateRocketWarningAudio(state, players, source, audio, 10, options);
    assert.equal(audio.calls.length, 1, 'the second player does not sneak in a tone next frame');
});

test('many ticks do not grow the warning state', () => {
    const state = createRocketWarningAudioState();
    const audio = createAudioSpy();
    const players = [createPlayer(0), createPlayer(1)];
    const source = createThreatSource([createThreat(), createThreat()]);
    const options = { localPlayerIndex: 0, localHumanCount: 2 };

    for (let tick = 0; tick < 600; tick += 1) {
        updateRocketWarningAudio(state, players, source, audio, tick * 16, options);
    }

    assert.equal(state.activeFlags.length, 2);
    assert.equal(state.nextPlayAtMs.length, 2);
});

function createMockAudioParam() {
    return {
        value: 0,
        cancelScheduledValues() {},
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
        linearRampToValueAtTime() {},
    };
}

function createMockAudioContext() {
    const oscillators = [];
    return {
        currentTime: 0,
        state: 'running',
        destination: {},
        oscillators,
        createGain() {
            return { gain: createMockAudioParam(), connect() {} };
        },
        createOscillator() {
            const osc = {
                type: 'sine',
                frequency: createMockAudioParam(),
                started: false,
                connect() {},
                start() { osc.started = true; },
                stop() {},
            };
            oscillators.push(osc);
            return osc;
        },
    };
}

function createHeadlessAudio() {
    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    const audio = new AudioManager();
    const ctx = createMockAudioContext();
    audio.ctx = ctx;
    audio.enabled = true;
    audio._sfxOut = () => ctx.destination;
    audio._resolveTime = () => 10_000;
    const restore = () => {
        audio.dispose();
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    };
    return { audio, ctx, restore };
}

test('the audio catalog knows the rocket warning tone', () => {
    const { audio, ctx, restore } = createHeadlessAudio();
    try {
        playGameplayVoice(audio, 'ROCKET_WARNING', { intensity: 0.9 });
        assert.ok(ctx.oscillators.length > 0, 'the warning tone reaches the synthesis');
        assert.ok(ctx.oscillators.every((osc) => osc.started));

        const before = ctx.oscillators.length;
        audio.play('ROCKET_WARNING', { intensity: 0.5 });
        assert.ok(ctx.oscillators.length > before, 'AudioManager.play routes the key to the catalog');
    } finally {
        restore();
    }
});

// A local split screen carries its humans in `numHumans`; `localHumanCount` only exists on a
// network session. Reading the latter alone left player two of a split screen without a tone.
test('the local human count covers split screen, network and explicit sessions', () => {
    assert.equal(resolveLocalHumanCount({ numHumans: 2, networkEnabled: false }), 2);
    assert.equal(resolveLocalHumanCount({ numHumans: 4 }), 4);
    assert.equal(resolveLocalHumanCount({ numHumans: 3, networkEnabled: true }), 1);
    assert.equal(resolveLocalHumanCount({ localHumanCount: 1, numHumans: 2 }), 1);
    assert.equal(resolveLocalHumanCount(null), 1);
    assert.equal(resolveLocalHumanCount({ numHumans: Number.NaN }), 1);
});
