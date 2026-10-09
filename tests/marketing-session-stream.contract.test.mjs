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

function fakeEncoder() {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); },
        final(done) { done(); queueMicrotask(() => child.emit('close', 0)); } });
    child.kill = () => child.emit('close', 1);
    return child;
}

test('large checkpoint batches preserve every ordered record while respecting the soft packet budget', async () => {
    const batches = [];
    const session = new MarketingSession({}, { append: async (payload) => { batches.push(payload); return { accepted: true }; } });
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
        const session = new MarketingSession(game, {}), evidence = [];
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
    const session = new MarketingSession(game, {}), records = [];
    Object.assign(session, { running: true, epoch: performance.now(), lastTick: performance.now(),
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
    const session = new MarketingSession(game, {}), now = performance.now();
    Object.assign(session, { running: true, epoch: now, lastTick: now, lastSample: now, lastFlush: now,
        currentMatch: true, manager: game.entityManager, kernel, previousState: 'PLAYING', previousRound: 2, activeMs: 200000 });
    session.captureTick();
    assert.equal(session.activeMs, 0);
    assert.equal(session.records[0].round, 3);
    assert.equal(session.records[0].frame, 51);
    assert.equal(session.records[0].renderFrame, 123);
    assert.equal(session.records[0].activeMs, 0);
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
