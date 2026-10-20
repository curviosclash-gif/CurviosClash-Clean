import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

// main.js boots the browser app at module scope and imports CSS. Compile and invoke the
// actual Game.render method body from production so this contract exercises its real
// state predicates, metadata assembly, and ordering without booting the app.
const MAIN_SOURCE = readFileSync(new URL('../src/core/main.js', import.meta.url), 'utf8');

function readMethodBody(source, methodName) {
    const signatureIndex = source.indexOf(`\n    ${methodName}(`);
    assert.notEqual(signatureIndex, -1, `main.js must define ${methodName}()`);
    const bodyStart = source.indexOf('{', signatureIndex);
    assert.notEqual(bodyStart, -1, `${methodName}() must have a body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}' && --depth === 0) return source.slice(bodyStart + 1, index);
    }
    throw new Error(`${methodName}() body is not balanced`);
}

const renderGame = new Function('alpha', 'renderDelta', 'GAME_STATE_IDS', readMethodBody(MAIN_SOURCE, 'render'));

function createGame({ state, cinematicRecording }) {
    const events = [];
    const game = {};
    const settings = { seed: 23 };
    let settingsReads = 0;

    Object.assign(game, {
        _getPublishedRenderer() { return this.renderer; },
        state,
        _renderAlpha: 0,
        _renderDelta: 0,
        mapKey: 'test-arena',
        activeGameMode: 'classic',
        numHumans: 1,
        numBots: 3,
        winsNeeded: 5,
        runtimeConfig: { session: { seed: 23, localPlayerIndex: 0 } },
        roundStateController: { state: 'round' },
        particles: { active: true },
        arena: { id: 'arena' },
        entityManager: {
            captureKillcamRenderedFrame() { events.push('killcam'); },
        },
        playingStateSystem: {
            render(alpha, delta) { events.push(`playing:${alpha}:${delta}`); },
            getMatchRenderProjection() {
                events.push('projection');
                return { frameId: 17 };
            },
        },
        runtimePerfProfiler: {
            startSample() { events.push('profiler:start'); return 'sample'; },
            endSample(name) { events.push(`profiler:end:${name}`); },
        },
        renderer: {
            cameras: [{ id: 'camera' }],
            viewportSystem: { localPlayerIndex: 2 },
            splitScreen: true,
            viewportLayout: { id: 'layout' },
            render() { events.push('render'); },
            prepareRecordingCaptureFrame(options) {
                events.push('live-frame');
                assert.equal(options.recordingActive, true);
                assert.deepEqual(options.renderProjection, state === GAME_STATE_IDS.PLAYING || state === GAME_STATE_IDS.PAUSED
                    ? { frameId: 17 }
                    : null);
            },
        },
        mediaRecorderSystem: {
            isCinematicReplayRecording() {
                events.push('cinematic-status');
                return cinematicRecording;
            },
            captureReplayState(payload) {
                events.push('replay-state');
                assert.equal(payload.entityManager, game.entityManager);
                assert.equal(payload.roundState, game.roundStateController);
                assert.equal(payload.particles, game.particles);
                assert.equal(payload.cameras, game.renderer.cameras);
                assert.equal(payload.dt, 0.05);
                assert.equal(payload.renderProjection?.frameId ?? null,
                    state === GAME_STATE_IDS.PLAYING || state === GAME_STATE_IDS.PAUSED ? 17 : null);
                assert.equal(payload.metadata.gameStateId, state);
                assert.equal(payload.metadata.mapKey, 'test-arena');
                assert.equal(payload.metadata.activeGameMode, 'classic');
                assert.equal(payload.metadata.numHumans, 1);
                assert.equal(payload.metadata.numBots, 3);
                assert.equal(payload.metadata.winsNeeded, 5);
                assert.equal(payload.metadata.localPlayerIndex, 2);
                assert.equal(payload.metadata.randomSeed, 23);
                assert.equal(payload.metadata.settings, settings);
            },
            isLiveRecording() { events.push('live-status'); return true; },
            captureRenderedFrame(delta) {
                events.push('rendered-frame');
                assert.equal(delta, 0.05);
            },
        },
    });
    Object.defineProperty(game, 'settings', {
        configurable: true,
        get() { settingsReads += 1; return settings; },
    });

    return { game, events, getSettingsReads: () => settingsReads };
}

test('inactive cinematic recording skips replay payload creation and capture while preserving the render path', () => {
    const { game, events, getSettingsReads } = createGame({
        state: GAME_STATE_IDS.PLAYING,
        cinematicRecording: false,
    });

    renderGame.call(game, 0.4, 0.2, GAME_STATE_IDS);

    assert.equal(getSettingsReads(), 0, 'inactive recording must not build the replay metadata payload');
    assert.deepEqual(events, [
        'playing:0.4:0.05',
        'projection',
        'cinematic-status',
        'profiler:start',
        'render',
        'profiler:end:render',
        'profiler:start',
        'killcam',
        'profiler:end:killcam_capture',
        'live-status',
        'profiler:start',
        'live-frame',
        'profiler:end:render',
        'rendered-frame',
    ]);
});

for (const state of [GAME_STATE_IDS.PLAYING, GAME_STATE_IDS.PAUSED, GAME_STATE_IDS.ROUND_END]) {
    test(`active cinematic recording captures ${state} metadata before the ordinary render`, () => {
        const { game, events, getSettingsReads } = createGame({ state, cinematicRecording: true });

        renderGame.call(game, 0.4, 0.2, GAME_STATE_IDS);

        assert.equal(getSettingsReads(), 1, 'settings metadata remains available to the active capture');
        assert.ok(events.indexOf('replay-state') >= 0);
        assert.ok(events.indexOf('replay-state') < events.indexOf('render'));
        assert.ok(events.indexOf('render') < events.indexOf('rendered-frame'));
        assert.equal(events.filter((event) => event === 'replay-state').length, 1);
        assert.equal(events.includes('cinematic-status'), true);
        assert.equal(events.includes('live-frame'), true);
        if (state === GAME_STATE_IDS.PLAYING) {
            assert.ok(events.indexOf('render') < events.indexOf('killcam'));
            assert.ok(events.indexOf('killcam') < events.indexOf('live-frame'));
        } else {
            assert.equal(events.includes('killcam'), false);
        }
    });
}

test('inactive replay states avoid payload construction while retaining ordinary render capture', () => {
    for (const state of [GAME_STATE_IDS.PAUSED, GAME_STATE_IDS.ROUND_END]) {
        const { game, events, getSettingsReads } = createGame({ state, cinematicRecording: false });

        renderGame.call(game, 0.4, 0.2, GAME_STATE_IDS);

        assert.equal(getSettingsReads(), 0);
        assert.equal(events.includes('replay-state'), false);
        assert.equal(events.includes('render'), true);
        assert.equal(events.includes('rendered-frame'), true);
    }
});
