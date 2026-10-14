import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import { createMarketingSessionStore } from '../electron/marketing-session-store.cjs';
import { readSessionRecords } from '../scripts/marketing/session-analysis.mjs';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { MarketingSession } from '../src/core/recording/MarketingSession.js';
import { createMarketingSessionRuntimePort } from '../src/core/recording/MarketingSessionRuntimePort.js';

const createSession = (runtime, bridge, view) => new MarketingSession(
    createMarketingSessionRuntimePort(runtime), bridge, view,
);

function fakeEncoder() {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); },
        final(done) { done(); queueMicrotask(() => child.emit('close', 0)); } });
    child.kill = () => child.emit('close', 1);
    return child;
}

test('start and runtime failures close an opened store, release capture resources and retain a partial session', async () => {
    const originals = Object.fromEntries(['navigator', 'MediaStream', 'MediaRecorder', 'window']
        .map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const tracks = [0, 1].map(() => ({ stopped: false, stop() { this.stopped = true; },
        addEventListener() {}, getSettings() { return {}; } }));
    let released = 0;
    let failure;
    class FakeMediaRecorder {
        constructor() { if (failure === 'constructor') throw new Error('recorder_constructor_failed'); this.state = 'inactive'; this.listeners = {}; }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        start() { if (failure === 'start') throw new Error('recorder_start_failed'); this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.listeners.dataavailable?.({ data: { size: 2, arrayBuffer: async () => Uint8Array.of(1, 2).buffer } });
            this.listeners.stop?.();
        }
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
        getDisplayMedia: async () => ({ getTracks: () => [tracks[0]], getVideoTracks: () => [tracks[0]] }),
    } } });
    Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: class {
        constructor(streamTracks) { this.tracks = streamTracks; }
        getTracks() { return this.tracks; }
    } });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
    try {
        for (failure of ['begin', 'constructor', 'start', 'match', 'runtime']) {
            tracks.forEach((track) => { track.stopped = false; });
            const calls = { begin: 0, finish: [], appended: [] };
            const bridge = {
                begin: async () => { calls.begin++; if (failure === 'begin') throw new Error('store_begin_failed'); },
                append: async (batch) => { calls.appended.push(batch); return { accepted: true }; },
                finish: async (details) => { calls.finish.push(details); return { status: 'partial' }; },
            };
            const game = { state: 'MENU', settings: { localSettings: {}, audio: {} }, recorder: {},
                input: { getPlayerSource: () => null },
                audio: { ctx: { resume: async () => {} }, acquireRecordingStream: () => ({
                    stream: { getAudioTracks: () => [tracks[1]] }, release: () => { released++; },
                }), applySettings() {} },
                _applySettingsToRuntime() {},
                startMatch: async () => { if (failure === 'match') throw new Error('match_start_failed'); },
            };
            const session = createSession(game, bridge);
            if (failure === 'runtime') {
                await session.start({ humans: 1, bots: 3 });
                session.fail('runtime_failed');
                await session.finish();
            } else {
                await assert.rejects(session.start({ humans: 1, bots: 3 }),
                    new RegExp(failure === 'match' ? 'match_start_failed'
                        : failure === 'begin' ? 'store_begin_failed' : `recorder_${failure}_failed`));
            }
            assert.equal(calls.begin, 1);
            assert.equal(calls.finish.length, failure === 'begin' ? 0 : 1);
            if (failure !== 'begin') assert.match(calls.finish[0].error, /failed/);
            assert.equal(session.running, false);
            assert.ok(tracks.every((track) => track.stopped));
            assert.equal(released, ['begin', 'constructor', 'start', 'match', 'runtime'].indexOf(failure) + 1);
            if (failure === 'begin') assert.equal(session.error, null);
            else assert.equal(game.input.recordingInputObserver, undefined);
            await session.finish();
            assert.equal(calls.finish.length, failure === 'begin' ? 0 : 1);
            if (failure === 'match') assert.ok(calls.appended.some((batch) => batch.kind === 'media'));
            if (failure === 'runtime') {
                assert.ok(calls.appended.some((batch) => batch.kind === 'media'));
                assert.ok(calls.appended.some((batch) => batch.kind === 'records'));
            }
            if (failure === 'begin') {
                const video = { stopped: false, stop() { this.stopped = true; } };
                const originalDisplay = navigator.mediaDevices.getDisplayMedia;
                navigator.mediaDevices.getDisplayMedia = async () => ({ getTracks: () => [video], getVideoTracks: () => [video] });
                game.audio.acquireRecordingStream = () => null;
                try { await assert.rejects(session.start({ humans: 1, bots: 3 }), /Kein Spielton/); }
                finally { navigator.mediaDevices.getDisplayMedia = originalDisplay; }
                assert.equal(video.stopped, true);
                assert.equal(released, 1);
            }
        }
    } finally {
        for (const [name, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});

test('large checkpoint batches preserve every ordered record while respecting the soft packet budget', async () => {
    const batches = [];
    const session = createSession({}, { append: async (payload) => { batches.push(payload); return { accepted: true }; } });
    const records = Array.from({ length: 12 }, (_, id) => ({ id, checkpoint: 'x'.repeat(300000) }));
    session.sendRecordBatch(records);
    await session.pending;
    assert.equal(session.error, null);
    assert.ok(batches.length > 1);
    assert.deepEqual(batches.flatMap((b) => b.records), records);
    assert.deepEqual(batches.map((b) => b.sequence), batches.map((_, i) => i));
    assert.ok(batches.every((b) => JSON.stringify(b.records).length * 2 <= 4 * 1024 * 1024));
    assert.equal(session.pendingBytes, 0);
});

test('physical input evidence follows bound keyboard indices and solo secondary bindings', () => {
    const previousWindow = globalThis.window;
    const listeners = new Map();
    globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: () => {} };
    try {
        const game = { state: 'PLAYING', recorder: {}, input: {
            bindings: { PLAYER_1: { UP: 'KeyW' }, PLAYER_2: { UP: 'ArrowUp' } },
            getPlayerSource: (player) => ({ type: 'keyboard', gamepadIndex: 1 - player }),
        } };
        const session = createSession(game, {}), evidence = [];
        session.setup = { humans: 2 }; session.record = (record) => evidence.push(record);
        session.installObservers();
        listeners.get('keydown')({ type: 'keydown', code: 'KeyW', isTrusted: true });
        assert.deepEqual(evidence.map((e) => e.player), [1]);
        evidence.length = 0;
        session.setup.humans = 1;
        game.input.getPlayerSource = () => ({ type: 'keyboard', gamepadIndex: 0 });
        listeners.get('keydown')({ type: 'keydown', code: 'ArrowUp', isTrusted: true });
        assert.deepEqual(evidence.map((e) => e.player), [0]);
    } finally { globalThis.window = previousWindow; }
});

test('a direct rematch resets active time and input evidence even when the runtime manager is reused', () => {
    const game = { state: 'PLAYING', entityManager: { players: [] }, roundStateController: { round: 1 }, settings: {}, runtimeConfig: {} };
    const session = createSession(game, {}), records = [];
    Object.assign(session, { running: true, epoch: performance.now(), lastTick: performance.now(), lastFlush: performance.now(),
        currentMatch: true, manager: game.entityManager, previousState: 'MATCH_END', previousRound: 1, match: 1, activeMs: 999999 });
    session.lastInput.set(0, 'held'); session.record = (record) => records.push(record);
    session.captureTick();
    assert.equal(session.error, null);
    assert.equal(session.match, 2); assert.equal(session.activeMs, 0);
    assert.equal(session.lastInput.size, 0);
    assert.equal(records.filter((r) => r.type === 'match-start').length, 1);
});

test('preroll resets from the actual kernel round and records real simulation and render frames', () => {
    const kernel = { roundIndex: 3, tickIndex: 51 };
    const game = { state: 'PLAYING', entityManager: { players: [] }, gameLoop: { renderFrameId: 123 },
        matchSessionRuntimeBridge: { getCurrentMatchKernel: () => kernel } };
    const session = createSession(game, {}), now = performance.now();
    Object.assign(session, { running: true, epoch: now, lastTick: now, lastSample: now, lastFlush: now,
        currentMatch: true, manager: game.entityManager, kernel, previousState: 'PLAYING', previousRound: 2, activeMs: 200000 });
    session.captureTick();
    assert.equal(session.activeMs, 0);
    assert.equal(session.records[0].round, 3);
    assert.equal(session.records[0].frame, 51);
    assert.equal(session.records[0].renderFrame, 123);
    assert.equal(session.records[0].activeMs, 0);
});

test('two fixed simulation steps in one render frame produce distinct ordered snapshots', () => {
    const kernel = { roundIndex: 1, tickIndex: 1 };
    const game = { state: 'PLAYING', entityManager: { players: [] }, settings: {}, runtimeConfig: {},
        gameLoop: { fixedStep: 1 / 60, accumulator: 2 / 60, renderFrameId: 7 },
        matchSessionRuntimeBridge: { getCurrentMatchKernel: () => kernel } };
    const session = createSession(game, {}), now = performance.now();
    Object.assign(session, { running: true, epoch: now - 1000, lastTick: now - 1000,
        previousState: 'PLAYING', previousRound: 1, currentMatch: true,
        manager: game.entityManager, kernel, lastFlush: now });
    session.captureTick();
    kernel.tickIndex = 2;
    game.gameLoop.accumulator = 1 / 60;
    session.captureTick();
    const snapshots = session.records.filter((record) => record.type === 'snapshot');
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots.map((record) => record.frame), [1, 2]);
    assert.deepEqual(snapshots.map((record) => record.renderFrame), [7, 7]);
    assert.ok(snapshots[1].timeMs - snapshots[0].timeMs >= 15);
    assert.ok(snapshots[1].timeMs - snapshots[0].timeMs < 30);
    assert.ok(snapshots.every((record) => Math.abs(record.timeMs - record.snapshot.timeMs) < 1));
});

test('session flush persists ordered records and exact media bytes before successful close', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'curvios-store-test-'));
    const directory = path.join(parent, 'session');
    const store = await createMarketingSessionStore({ directory, ffmpeg: 'test-encoder', spawnProcess: fakeEncoder });
    const media = Buffer.from([1, 2, 3, 4]);
    await store.append({ kind: 'media', sequence: 0, bytes: media });
    await store.append({ kind: 'records', sequence: 1, records: [{ type: 'event', timeMs: 1 }] });
    await store.append({ kind: 'media', sequence: 2, bytes: media });
    const manifest = await store.finish();
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.modelCalls, 0);
    assert.deepEqual(await readFile(path.join(directory, 'original.webm')), Buffer.concat([media, media]));
    const records = []; for await (const r of readSessionRecords(path.join(directory, 'journal.ndjson'), manifest.journalSha256)) records.push(r);
    assert.equal(records.length, 1);
    await assert.rejects(store.append({}), /session_closed/);
});

test('sequence gaps produce partial status and never overwrite existing recordings', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'curvios-store-gap-'));
    const directory = path.join(parent, 'session');
    const options = { directory, ffmpeg: 'test-encoder', spawnProcess: fakeEncoder };
    const store = await createMarketingSessionStore(options);
    await assert.rejects(store.append({ sequence: 1, kind: 'records', records: [] }), /sequence_gap/);
    const manifest = await store.finish();
    assert.equal(manifest.status, 'partial');
    await assert.rejects(createMarketingSessionStore(options), /EEXIST/);
    assert.ok((await readFile(path.join(directory, 'session.json'), 'utf8')).includes('session_sequence_gap'));
});

test('streamed replay exports only the selected interval and advances beyond its initial pair of snapshots', async () => {
    const frames = [], begin = [];
    const save = {
        contractVersion: 'preload.save.v2',
        beginCinematicReplayExport: async (payload) => { begin.push(payload); return { started: true, exportId: 'test' }; },
        appendCinematicReplayFrame: async () => ({ accepted: true }),
        finishCinematicReplayExport: async () => ({ saved: true }),
        cancelCinematicReplayExport: async () => ({ cancelled: true }),
    };
    const controller = new CinematicReplayExportController({
        runtimeGlobal: { __CURVIOS_APP__: true, curviosApp: { contracts: { save },
            capabilities: { save: { available: true, providerKind: 'electron-ipc', contractVersion: 'preload.save.v2' } } } },
        resolveExportFormat: () => ({ width: 2, height: 2, fps: 60 }),
        renderFrame: async (frame) => {
            if (frame.reset) return null;
            frames.push({ time: frame.timeMs, left: frame.leftSnapshot.timeMs, right: frame.rightSnapshot.timeMs });
            return { width: 2, height: 2, getContext: () => ({ getImageData: () => ({ data: new Uint8Array(16) }) }) };
        },
    });
    const snapshot = (timeMs) => ({ timeMs, players: [] });
    const remaining = [snapshot(1034), snapshot(1051), snapshot(1068)];
    const result = await controller.export({ durationMs: 1050, exportStartMs: 1000,
        snapshots: [snapshot(1000), snapshot(1017)], metadata: {}, nextSnapshot: async () => remaining.shift() || null });
    assert.equal(result.saved, true);
    assert.equal(begin[0].expectedDurationMs, 50);
    assert.equal(frames.length, 3);
    assert.equal(frames[0].time, 1000);
    assert.equal(frames.at(-1).left, 1017);
    assert.equal(frames.at(-1).right, 1034);
});

test('capture hooks wrap gameplay only while active and restore original methods', () => {
    const previousWindow = globalThis.window;
    const listeners = new Map();
    globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: () => {} };
    const calls = [];
    const game = {
        state: 'PLAYING',
        update(dt) { calls.push(['update', dt]); },
        input: {
            getPlayerSource: () => ({ type: 'keyboard' }),
            getPlayerInput(player) { calls.push(['input', player]); return { throttleAxis: 0.5 }; },
        },
        recorder: {
            logEvent(...args) { calls.push(['event-original', ...args]); },
            recordDamageEvent(event) { calls.push(['damage-original', event]); },
        },
    };
    const originals = {
        update: game.update,
        input: game.input.getPlayerInput,
        event: game.recorder.logEvent,
        damage: game.recorder.recordDamageEvent,
    };
    const session = createSession(game, {});
    const records = [];
    session.setup = { humans: 1 };
    session.record = (record) => records.push(record);
    session.tick = (dt) => calls.push(['tick', dt]);
    assert.equal(game.update, originals.update);
    assert.equal(game.input.getPlayerInput, originals.input);
    assert.equal(game.recorder.logEvent, originals.event);
    session.installGameTick();
    session.installObservers();
    game.input.getPlayerInput(0);
    game.recorder.logEvent('KILL', 0, 'cause=rocket');
    game.recorder.recordDamageEvent({ sourcePlayer: { index: 0 }, target: { index: 1 },
        projectile: { type: 'ROCKET' }, damageResult: { applied: 12, hpApplied: 10, absorbedByShield: 2 } });
    game.update(1 / 60);
    assert.ok(records.some((record) => record.type === 'applied-input' && record.player === 0));
    assert.ok(records.some((record) => record.type === 'event' && record.eventType === 'KILL'));
    assert.ok(records.some((record) => record.type === 'event' && record.eventType === 'DAMAGE'
        && record.hpApplied === 10));
    assert.deepEqual(calls.filter(([name]) => name === 'tick'), [['tick', 1 / 60]]);
    session.cleanups.splice(0).forEach((cleanup) => cleanup());
    assert.equal(game.update, originals.update);
    assert.equal(game.input.getPlayerInput, originals.input);
    assert.equal(game.recorder.logEvent, originals.event);
    assert.equal(game.recorder.recordDamageEvent, originals.damage);
    globalThis.window = previousWindow;
});
