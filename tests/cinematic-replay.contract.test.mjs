import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    CINEMATIC_REPLAY_CONTRACT_VERSION,
    CinematicReplayRecorder,
} from '../src/core/recording/CinematicReplayRecorder.js';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { CinematicReplayLibrary } from '../src/core/recording/CinematicReplayLibrary.js';
import { updateReplayProjection } from '../src/core/recording/CinematicReplayProjection.js';
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
    const particleCount = 240;
    const particles = {
        count: particleCount,
        positions: new Float32Array(particleCount * 3).fill(1),
        velocities: new Float32Array(particleCount * 3).fill(2),
        lifetimes: new Float32Array(particleCount).fill(0.5),
        maxLifetimes: new Float32Array(particleCount).fill(1),
        gravities: new Float32Array(particleCount).fill(-9.81),
        scales: new Float32Array(particleCount).fill(0.75),
        colors: new Float32Array(particleCount * 3).fill(0.25),
    };
    const cameras = [{
        position: { x: 8, y: 6, z: 4 },
        quaternion: { x: 0, y: 0.5, z: 0, w: 0.866 },
        fov: 72,
        aspect: 16 / 9,
        near: 0.2,
        far: 300,
        zoom: 1.1,
    }];
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
            particles,
            cameras,
            renderProjection: {
                players: [{
                    playerIndex: 0,
                    position: { x: 50 + frame, y: 4, z: -3 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                    renderDiscontinuityVersion: 7,
                }],
            },
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
    assert.equal(replay.snapshots[0].players[0].pos[0], 50);
    assert.equal(replay.snapshots[0].players[0].renderDiscontinuityVersion, 7);
    assert.equal(replay.snapshots[0].particles.count, particleCount);
    assert.equal(replay.snapshots[0].particles.values.length, particleCount * 13);
    assert.deepEqual(replay.snapshots[0].cameras[0].position, [8, 6, 4]);
    assert.equal(replay.snapshots[0].cameras[0].fov, 72);
    assert.deepEqual(replay.metadata, { mapKey: 'arena', seed: 42 });
    assert.equal(replay.audioWarning, 'audio_capture_unavailable');
});

test('cinematic replay cuts player and recorded camera transforms at discontinuities', () => {
    const createPlayer = (positionX, renderDiscontinuityVersion) => ({
        index: 0,
        pos: [positionX, 5, 0],
        rot: [0, 0, 0, 1],
        alive: true,
        health: 100,
        renderDiscontinuityVersion,
    });
    const createCamera = (positionX) => ({
        index: 0,
        position: [positionX, 10, 9],
        quaternion: [0, 0, 0, 1],
        fov: 75,
        aspect: 16 / 9,
        near: 0.1,
        far: 200,
        zoom: 1,
    });
    const leftSnapshot = {
        timeMs: 0,
        players: [createPlayer(0, 0)],
        cameras: [createCamera(0)],
    };
    const rightSnapshot = {
        timeMs: 1000 / 30,
        players: [createPlayer(20, 1)],
        cameras: [createCamera(20)],
    };
    const projection = { players: [], localPlayerIndex: 0, localHumanCount: 1 };

    updateReplayProjection(projection, leftSnapshot, rightSnapshot, 0.49, {});
    assert.equal(projection.players[0].position.x, 0);
    assert.equal(projection.players[0].renderDiscontinuityVersion, 0);
    assert.equal(projection.recordedCamera.position.x, 0);

    updateReplayProjection(projection, leftSnapshot, rightSnapshot, 0.5, {});
    assert.equal(projection.players[0].position.x, 20);
    assert.equal(projection.players[0].renderDiscontinuityVersion, 1);
    assert.equal(projection.recordedCamera.position.x, 20);
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

test('cinematic replay timing follows integer wall-clock deltas without cumulative drift', () => {
    let now = 1000;
    const recorder = new CinematicReplayRecorder({
        sampleFps: 30,
        now: () => now,
        globalScope: {},
    });
    recorder.start({ matchId: 'timing-contract' });
    const entityManager = { players: [], projectiles: [], powerups: [] };
    const wallDeltas = [17, 17, 16];

    for (let frame = 0; frame < 600; frame++) {
        now += wallDeltas[frame % wallDeltas.length];
        recorder.capture({ entityManager, dt: 1 / 60 });
    }

    assert.equal(recorder._elapsedMs, 10000);
});

test('cinematic replay library keeps individual recordings selectable and bounded', () => {
    let now = 1000;
    const library = new CinematicReplayLibrary({
        now: () => now,
        maxEntries: 2,
        maxEstimatedBytes: 1024 * 1024,
    });
    const first = library.enqueue({
        matchId: 'first',
        startedAt: 100,
        durationMs: 5000,
        estimatedBytes: 100,
        snapshots: [{ timeMs: 0 }, { timeMs: 5000 }],
    });
    now = 2000;
    const second = library.enqueue({
        matchId: 'second',
        startedAt: 200,
        durationMs: 7000,
        estimatedBytes: 200,
        snapshots: [{ timeMs: 0 }, { timeMs: 7000 }],
    });

    assert.equal(first.queued, true);
    assert.equal(second.queued, true);
    assert.deepEqual(
        library.list().map((recording) => recording.matchId),
        ['second', 'first']
    );
    assert.equal(library.getCapacityState().canRecord, false);
    assert.equal(library.remove(first.recording.recordingId).removed, true);
    assert.equal(library.getCapacityState().canRecord, true);
});

test('cinematic profile waits for manual F8 start and continues across round finalization', async () => {
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

test('stopping cinematic capture queues it without exporting and manual render removes only the selection', async () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        globalScope: {},
        recordingCaptureSettings: {
            profile: 'cinematic',
            hudMode: 'clean',
            exportPreset: 'youtube-mp4',
        },
    });
    let exportCalls = 0;
    recorder._cinematicReplayExporter.export = async (replay) => {
        exportCalls += 1;
        return {
            saved: replay.matchId === 'manual-render',
            reason: replay.matchId === 'manual-render' ? 'saved' : 'render_failed',
            filePath: replay.matchId === 'manual-render' ? 'C:\\Videos\\manual-render.mp4' : null,
        };
    };

    await recorder.startRecording({
        type: 'cinematic_manual_start',
        context: { sessionId: 'manual-render' },
    });
    const stopResult = await recorder.stopRecording({ type: 'cinematic_manual_stop' });

    assert.equal(stopResult.stopped, true);
    assert.equal(stopResult.queued, true);
    assert.equal(exportCalls, 0);
    assert.equal(recorder.listCinematicReplayRecordings().length, 1);

    const renderResult = await recorder.renderCinematicReplayRecording(stopResult.recordingId);
    assert.equal(renderResult.saved, true);
    assert.equal(exportCalls, 1);
    assert.equal(recorder.listCinematicReplayRecordings().length, 0);
});

test('failed manual cinematic render retains the selected recording', async () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        globalScope: {},
        recordingCaptureSettings: { profile: 'cinematic' },
    });
    await recorder.startRecording({
        type: 'cinematic_manual_start',
        context: { sessionId: 'retained-render' },
    });
    const stopResult = await recorder.stopRecording({ type: 'cinematic_manual_stop' });
    recorder._cinematicReplayExporter.export = async () => ({
        saved: false,
        reason: 'render_failed',
    });

    const renderResult = await recorder.renderCinematicReplayRecording(stopResult.recordingId);

    assert.equal(renderResult.saved, false);
    assert.equal(renderResult.replayRetained, true);
    assert.equal(recorder.listCinematicReplayRecordings().length, 1);
});

test('cinematic export streams frames once and propagates partial metadata', async () => {
    const frameBytes = new Uint8ClampedArray(1920 * 1080 * 4);
    const calls = [];
    let firstProjectionState = null;
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
            firstProjectionState ||= {
                trailWidth: projection.players[0].trailWidth,
                trailInGap: projection.players[0].trailInGap,
                hasShield: projection.players[0].hasShield,
                cameraX: projection.recordedCamera.position.x,
                cameraFov: projection.recordedCamera.fov,
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
            hasShield: true,
            shieldHP: 40,
        }],
        cameras: [0, 1, 2].map((index) => ({
            index,
            position: [4 + index, 5, 6],
            quaternion: [0, 0, 0, 1],
            fov: 68 + index,
            aspect: 16 / 9,
            near: 0.1,
            far: 200,
            zoom: 1,
        })),
    };
    const result = await controller.export({
        matchId: 'match-stream',
        durationMs: 17,
        snapshots: [
            baseSnapshot,
            { ...baseSnapshot, timeMs: 17, players: [{ ...baseSnapshot.players[0], pos: [1, 0, 0] }] },
        ],
        metadata: { localPlayerIndex: 2 },
        partial: true,
        partialReason: 'audio_stop_timeout',
        audioBlob: null,
        audioWarning: 'audio_capture_unavailable',
    });
    assert.equal(result.saved, true);
    assert.equal(result.partial, true);
    assert.equal(result.partialReason, 'audio_stop_timeout');
    assert.deepEqual(calls, [0, 1]);
    assert.deepEqual(firstProjectionState, {
        trailWidth: 0.85,
        trailInGap: true,
        hasShield: true,
        cameraX: 6,
        cameraFov: 70,
    });
});

test('cinematic export keeps consecutive saved renders successful when scene cleanup fails', async () => {
    const frameBytes = new Uint8ClampedArray(1920 * 1080 * 4);
    const completedExports = [];
    let exportSequence = 0;
    let resetCalls = 0;
    const runtimeGlobal = {
        __CURVIOS_APP__: true,
        curviosApp: {
            contracts: {
                save: {
                    contractVersion: 'preload.save.v2',
                    beginCinematicReplayExport: async () => {
                        exportSequence++;
                        return { started: true, exportId: `export-${exportSequence}` };
                    },
                    appendCinematicReplayFrame: async () => ({ accepted: true }),
                    finishCinematicReplayExport: async ({ exportId }) => {
                        completedExports.push(exportId);
                        return {
                            saved: true,
                            filePath: `C:\\Videos\\${exportId}.mp4`,
                            fileName: `${exportId}.mp4`,
                        };
                    },
                    cancelCinematicReplayExport: async () => ({ cancelled: true }),
                },
            },
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
        logger: { warn() {} },
        renderFrame: async ({ reset }) => {
            if (reset) {
                resetCalls++;
                if (resetCalls === 1) throw new Error('scene_cleanup_failed');
                return null;
            }
            return {
                width: 1920,
                height: 1080,
                getContext: () => ({
                    getImageData: () => ({ data: frameBytes }),
                }),
            };
        },
    });
    const snapshot = {
        timeMs: 0,
        players: [{
            index: 0,
            pos: [0, 0, 0],
            rot: [0, 0, 0, 1],
            alive: true,
            health: 100,
        }],
    };

    const first = await controller.export({
        matchId: 'first',
        durationMs: 1,
        snapshots: [snapshot],
        metadata: {},
    });
    const second = await controller.export({
        matchId: 'second',
        durationMs: 1,
        snapshots: [snapshot],
        metadata: {},
    });

    assert.equal(first.saved, true);
    assert.deepEqual(first.warnings, ['replay_renderer_reset_failed']);
    assert.equal(second.saved, true);
    assert.deepEqual(completedExports, ['export-1', 'export-2']);
    assert.equal(resetCalls, 2);
});

test('cinematic replay frame renderer rebuilds and resets player trails', async () => {
    const calls = [];
    const visibility = [];
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
    let visualOptions = null;
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
            setVisible(value) { visibility.push(value); },
            syncFromState() {},
            updateVisuals(dt, options) {
                visualOptions = { dt, ...options };
            },
        },
    };
    const networkSnapshots = [];
    let networkReplicaEnabled = false;
    const entityManager = {
        players: [player],
        setNetworkReplica(enabled) {
            networkReplicaEnabled = enabled;
        },
        applyNetworkSnapshot(snapshot) {
            networkSnapshots.push(structuredClone(snapshot));
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
    let preparedSessions = 0;
    let disposedSessions = 0;
    const renderFrame = createCinematicReplayFrameRenderer({
        game: { entityManager: null },
        renderer,
        prepareReplaySession: async () => {
            preparedSessions += 1;
            return { entityManager, particles: null, arena: null };
        },
        disposeReplaySession: async () => {
            disposedSessions += 1;
        },
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
        leftSnapshot: {
            projectiles: [{
                id: 'rocket-1',
                type: 'rocket',
                owner: 0,
                pos: [0, 0, 0],
                vel: [0, 0, 2],
                ttl: 2,
                visualScale: 1.5,
            }],
            powerups: [{
                id: 'boost-1',
                type: 'BOOST',
                pos: [2, 0, 0],
                rotationY: 0,
                visible: true,
            }],
        },
        rightSnapshot: {
            projectiles: [{
                id: 'rocket-1',
                type: 'rocket',
                owner: 0,
                pos: [4, 0, 0],
                vel: [0, 0, 4],
                ttl: 1,
                visualScale: 1.5,
            }],
            powerups: [{
                id: 'boost-1',
                type: 'BOOST',
                pos: [6, 0, 0],
                rotationY: 1,
                visible: true,
            }],
        },
        alpha: 0.5,
        frameIndex: 0,
        dt: 1 / 60,
    }), captureCanvas);
    await renderFrame({
        replay,
        projection: {
            ...projection,
            players: [{ ...projection.players[0], alive: false }],
        },
        leftSnapshot: { projectiles: [] },
        frameIndex: 1,
        dt: 1 / 60,
    });
    await renderFrame({ reset: true });

    assert.equal(preparedSessions, 1);
    assert.equal(disposedSessions, 1);
    assert.equal(networkReplicaEnabled, true);
    assert.equal(networkSnapshots[0].projectiles[0].pos[0], 2);
    assert.equal(networkSnapshots[0].powerups[0].pos[0], 4);
    assert.deepEqual(visibility, [true, false]);
    assert.deepEqual(visualOptions, { dt: 1 / 60, emitParticles: false });
    assert.deepEqual(calls, [
        ['clear'],
        ['width', 0.85],
        ['update', 1 / 60, 2, 1, { inGap: false, discontinuity: true }],
        ['width', 0.85],
        ['update', 1 / 60, 2, 1, { inGap: true, discontinuity: true }],
        ['clear'],
    ]);
});
