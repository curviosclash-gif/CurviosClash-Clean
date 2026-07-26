import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    CINEMATIC_REPLAY_CONTRACT_VERSION,
    CinematicReplayRecorder,
} from '../src/core/recording/CinematicReplayRecorder.js';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { createCinematicReplayFrameRenderer } from '../src/core/recording/CinematicReplayRenderRuntime.js';
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
            trail: {
                width: 0.85,
                inGap: true,
            },
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
    assert.equal(replay.snapshots[0].players[0].trailWidth, 0.85);
    assert.equal(replay.snapshots[0].players[0].trailInGap, true);
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

test('cinematic profile waits for manual F9 start and continues across round finalization', async () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        autoRecordingEnabled: true,
        globalScope: {},
        recordingCaptureSettings: {
            profile: 'cinematic',
            hudMode: 'clean',
            exportPreset: 'youtube-mp4',
        },
    });
    recorder.notifyLifecycleEvent('match_started', { sessionId: 'lifecycle-match' });
    assert.equal(recorder.isCinematicReplayRecording(), false);
    const startResult = await recorder.startRecording({ type: 'cinematic_manual_start' });
    assert.equal(startResult.started, true);
    assert.equal(recorder.isCinematicReplayRecording(), true);
    const roundResult = await recorder.settleRecording({ type: 'round_finalize' });
    assert.equal(roundResult.deferred, true);
    assert.equal(recorder.isCinematicReplayRecording(), true);
    await recorder.dispose();
});

test('cinematic export streams frames once and propagates partial metadata', async () => {
    const frameBytes = new Uint8ClampedArray(1920 * 1080 * 4);
    const calls = [];
    let firstProjectionTrail = null;
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
        renderFrame: async ({ reset, projection }) => {
            if (reset) return null;
            firstProjectionTrail ||= {
                width: projection.players[0].trailWidth,
                inGap: projection.players[0].trailInGap,
            };
            return {
                width: 1920,
                height: 1080,
                getContext: () => ({
                    getImageData: () => ({ data: frameBytes }),
                }),
            };
        },
    });
    const baseSnapshot = {
        timeMs: 0,
        players: [{
            index: 0,
            pos: [0, 0, 0],
            rot: [0, 0, 0, 1],
            alive: true,
            health: 100,
            trailWidth: 0.85,
            trailInGap: true,
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
    assert.deepEqual(firstProjectionTrail, { width: 0.85, inGap: true });
});

test('cinematic replay frame renderer rebuilds and resets player trails', async () => {
    const calls = [];
    const trail = {
        width: 0.6,
        clear() { calls.push(['clear']); },
        setWidth(width) {
            this.width = width;
            calls.push(['width', width]);
        },
        updateReplayVisual(dt, position, direction, options) {
            calls.push(['update', dt, position.x, direction.x, { ...options }]);
        },
    };
    const player = {
        index: 0,
        position: new THREE.Vector3(),
        previousPosition: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        previousQuaternion: new THREE.Quaternion(),
        hp: 100,
        score: 0,
        speed: 0,
        trail,
        view: {
            setVisible() {},
            syncFromState() {},
            updateVisuals() {},
        },
    };
    const captureCanvas = { width: 1920, height: 1080 };
    const renderer = {
        setRecordingActive() {},
        setRecordingQualityLock() {},
        prepareRecordingCaptureFrame() {},
        getRecordingCaptureCanvas() { return captureCanvas; },
    };
    const replay = { matchId: 'trail-replay' };
    const renderFrame = createCinematicReplayFrameRenderer({
        game: { entityManager: { players: [player] } },
        renderer,
    });
    const projection = {
        players: [{
            playerIndex: 0,
            alive: true,
            hp: 100,
            score: 0,
            speed: 8,
            trailWidth: 0.85,
            trailInGap: false,
            position: { x: 2, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            direction: { x: 1, y: 0, z: 0 },
        }],
    };

    assert.equal(await renderFrame({
        replay,
        projection,
        leftSnapshot: { projectiles: [] },
        frameIndex: 0,
        dt: 1 / 60,
    }), captureCanvas);
    await renderFrame({
        replay,
        projection,
        leftSnapshot: { projectiles: [] },
        frameIndex: 1,
        dt: 1 / 60,
    });
    await renderFrame({ reset: true });

    assert.deepEqual(calls, [
        ['clear'],
        ['width', 0.85],
        ['update', 1 / 60, 2, 1, { inGap: false, discontinuity: true }],
        ['width', 0.85],
        ['update', 1 / 60, 2, 1, { inGap: false, discontinuity: false }],
        ['clear'],
    ]);
});
