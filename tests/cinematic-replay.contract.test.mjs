import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CINEMATIC_REPLAY_CONTRACT_VERSION,
    CinematicReplayRecorder,
} from '../src/core/recording/CinematicReplayRecorder.js';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';

function createEntityManager() {
    return {
        players: [{
            id: 'p-0',
            index: 0,
            alive: true,
            isBot: false,
            position: { x: 1, y: 2, z: 3 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            velocity: { x: 2, y: 0, z: 0 },
            hp: 90,
            maxHp: 100,
            score: 2,
            speed: 12,
            boostCharge: 0.5,
            isBoosting: true,
            color: 0xff00ff,
            activeEffects: [{ type: 'shield', remaining: 1.5 }],
        }],
        projectiles: [{
            id: 'rocket-1',
            active: true,
            position: { x: 4, y: 5, z: 6 },
            velocity: { x: 0, y: 0, z: -5 },
            ownerIndex: 0,
            type: 'rocket',
            ttl: 2,
            radius: 0.4,
        }],
    };
}

test('cinematic replay records fixed-time visual snapshots without video frames', async () => {
    let now = 1000;
    const recorder = new CinematicReplayRecorder({
        sampleFps: 30,
        now: () => now,
        globalScope: {},
    });
    const entityManager = createEntityManager();
    const start = recorder.start({
        matchId: 'match-contract',
        metadata: { mapKey: 'arena', seed: 42 },
    });
    assert.equal(start.started, true);

    for (let frame = 0; frame < 60; frame++) {
        now += 1000 / 60;
        entityManager.players[0].position.x += 0.1;
        recorder.capture({
            entityManager,
            roundState: { frame, round: 1, timeRemaining: 30, scores: [2, 1] },
            dt: 1 / 60,
        });
    }
    const replay = await recorder.stop();
    assert.equal(replay.contractVersion, CINEMATIC_REPLAY_CONTRACT_VERSION);
    assert.equal(replay.matchId, 'match-contract');
    assert.ok(replay.snapshotCount >= 29 && replay.snapshotCount <= 31);
    assert.equal(replay.snapshots[0].players[0].isBoosting, true);
    assert.equal(replay.snapshots[0].projectiles[0].type, 'rocket');
    assert.deepEqual(replay.metadata, { mapKey: 'arena', seed: 42 });
    assert.equal(replay.audioWarning, 'audio_capture_unavailable');
});

test('cinematic replay partial state is preserved through stop', async () => {
    const recorder = new CinematicReplayRecorder({ globalScope: {} });
    recorder.start({ matchId: 'partial-match' });
    recorder.capture({ entityManager: createEntityManager(), dt: 1 / 30 });
    recorder.markPartial('snapshot_budget_exhausted');
    const replay = await recorder.stop();
    assert.equal(replay.partial, true);
    assert.equal(replay.partialReason, 'snapshot_budget_exhausted');
});

test('cinematic profile starts from match lifecycle and continues across round finalization', async () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        autoRecordingEnabled: false,
        globalScope: {},
        recordingCaptureSettings: {
            profile: 'cinematic',
            hudMode: 'clean',
            exportPreset: 'youtube-mp4',
        },
    });
    recorder.notifyLifecycleEvent('match_started', { sessionId: 'lifecycle-match' });
    assert.equal(recorder.isCinematicReplayRecording(), true);
    const roundResult = await recorder.settleRecording({ type: 'round_finalize' });
    assert.equal(roundResult.deferred, true);
    assert.equal(recorder.isCinematicReplayRecording(), true);
    await recorder.dispose();
});

test('cinematic export streams frames once and propagates partial metadata', async () => {
    const frameBytes = new Uint8ClampedArray(1920 * 1080 * 4);
    const calls = [];
    const saveContract = {
        contractVersion: 'preload.save.v2',
        beginCinematicReplayExport: async () => ({ started: true, exportId: 'export-1' }),
        appendCinematicReplayFrame: async (payload) => {
            calls.push(payload.frameIndex);
            return { accepted: true };
        },
        finishCinematicReplayExport: async () => ({
            saved: true,
            filePath: 'C:\\Videos\\replay.mp4',
            fileName: 'replay.mp4',
            warnings: ['audio_capture_unavailable'],
        }),
        cancelCinematicReplayExport: async () => ({ cancelled: true }),
    };
    const runtimeGlobal = {
        __CURVIOS_APP__: true,
        curviosApp: {
            contracts: { save: saveContract },
            capabilities: {
                save: {
                    available: true,
                    providerKind: 'electron-ipc',
                    contractVersion: 'preload.save.v2',
                },
            },
        },
    };
    const controller = new CinematicReplayExportController({
        runtimeGlobal,
        renderFrame: async ({ reset }) => reset ? null : ({
            width: 1920,
            height: 1080,
            getContext: () => ({
                getImageData: () => ({ data: frameBytes }),
            }),
        }),
    });
    const baseSnapshot = {
        timeMs: 0,
        players: [{
            index: 0,
            pos: [0, 0, 0],
            rot: [0, 0, 0, 1],
            alive: true,
            health: 100,
        }],
    };
    const result = await controller.export({
        matchId: 'match-stream',
        durationMs: 17,
        snapshots: [
            baseSnapshot,
            { ...baseSnapshot, timeMs: 17, players: [{ ...baseSnapshot.players[0], pos: [1, 0, 0] }] },
        ],
        metadata: {},
        partial: true,
        partialReason: 'audio_stop_timeout',
        audioBlob: null,
        audioWarning: 'audio_capture_unavailable',
    });
    assert.equal(result.saved, true);
    assert.equal(result.partial, true);
    assert.equal(result.partialReason, 'audio_stop_timeout');
    assert.deepEqual(calls, [0, 1]);
});
