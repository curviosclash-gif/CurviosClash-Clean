// @ts-nocheck
import { createGameStateSnapshot } from '../GameStateSnapshot.js';

export const CINEMATIC_REPLAY_CONTRACT_VERSION = 'cinematic-replay.v1';
export const CINEMATIC_REPLAY_SAMPLE_FPS = 30;
export const CINEMATIC_REPLAY_MAX_DURATION_SECONDS = 60 * 60;
export const CINEMATIC_REPLAY_MAX_ESTIMATED_BYTES = 256 * 1024 * 1024;

const AUDIO_STOP_TIMEOUT_MS = 8000;
const MAX_PARTICLES_PER_SNAPSHOT = 192;

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneJsonValue(value, fallback = null) {
    if (value == null) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function captureParticleState(particles) {
    const count = Math.min(
        MAX_PARTICLES_PER_SNAPSHOT,
        Math.max(0, Math.trunc(toFiniteNumber(particles?.count, 0)))
    );
    if (count <= 0 || !particles?.positions || !particles?.velocities) return null;
    const values = new Array(count * 12);
    for (let index = 0; index < count; index++) {
        const src3 = index * 3;
        const dst = index * 12;
        values[dst] = toFiniteNumber(particles.positions[src3], 0);
        values[dst + 1] = toFiniteNumber(particles.positions[src3 + 1], 0);
        values[dst + 2] = toFiniteNumber(particles.positions[src3 + 2], 0);
        values[dst + 3] = toFiniteNumber(particles.velocities[src3], 0);
        values[dst + 4] = toFiniteNumber(particles.velocities[src3 + 1], 0);
        values[dst + 5] = toFiniteNumber(particles.velocities[src3 + 2], 0);
        values[dst + 6] = Math.max(0, toFiniteNumber(particles.lifetimes?.[index], 0));
        values[dst + 7] = Math.max(
            values[dst + 6],
            toFiniteNumber(particles.maxLifetimes?.[index], values[dst + 6])
        );
        values[dst + 8] = Math.max(0, toFiniteNumber(particles.scales?.[index], 0));
        values[dst + 9] = toFiniteNumber(particles.colors?.[src3], 1);
        values[dst + 10] = toFiniteNumber(particles.colors?.[src3 + 1], 1);
        values[dst + 11] = toFiniteNumber(particles.colors?.[src3 + 2], 1);
    }
    return { count, values };
}

function enrichPlayerVisualState(snapshotPlayers, livePlayers) {
    for (let index = 0; index < snapshotPlayers.length; index++) {
        const snapshot = snapshotPlayers[index];
        const player = livePlayers[index];
        if (!snapshot || !player) continue;
        snapshot.maxHealth = toFiniteNumber(player.maxHp, 100);
        snapshot.boostCharge = toFiniteNumber(player.boostCharge, 0);
        snapshot.isBoosting = player.isBoosting === true;
        snapshot.cameraMode = Math.trunc(toFiniteNumber(player.cameraMode, 0));
        snapshot.modelScale = Math.max(0.01, toFiniteNumber(player.modelScale, 1));
        snapshot.color = Math.trunc(toFiniteNumber(player.color, 0xffffff));
        snapshot.vehicleId = String(
            player.vehicleId
            || player.vehicleType
            || player.modelId
            || ''
        );
        snapshot.skinId = String(player.skinId || player.selectedSkin || '');
        snapshot.animation = String(player.animationState || player.activeAnimation || '');
        snapshot.weapon = String(player.activeWeapon || player.weaponType || '');
    }
}

function createReplaySnapshot({ entityManager, roundState, particles, elapsedMs, gameStateId = '' }) {
    const snapshot = createGameStateSnapshot(entityManager, roundState);
    enrichPlayerVisualState(snapshot.players, entityManager?.players || []);
    snapshot.timeMs = Math.max(0, Math.round(elapsedMs));
    snapshot.gameStateId = String(gameStateId || '');
    snapshot.particles = captureParticleState(particles);
    return snapshot;
}

function estimateSnapshotBytes(snapshot) {
    return 256
        + ((snapshot?.players?.length || 0) * 256)
        + ((snapshot?.projectiles?.length || 0) * 160)
        + ((snapshot?.powerups?.length || 0) * 96)
        + ((snapshot?.particles?.values?.length || 0) * 8);
}

function resolveAudioMimeType(globalScope) {
    const MediaRecorderCtor = globalScope?.MediaRecorder;
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
    ];
    for (const mimeType of candidates) {
        if (typeof MediaRecorderCtor?.isTypeSupported !== 'function'
            || MediaRecorderCtor.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return '';
}

export class CinematicReplayRecorder {
    constructor({
        sampleFps = CINEMATIC_REPLAY_SAMPLE_FPS,
        maxDurationSeconds = CINEMATIC_REPLAY_MAX_DURATION_SECONDS,
        maxEstimatedBytes = CINEMATIC_REPLAY_MAX_ESTIMATED_BYTES,
        now = () => Date.now(),
        globalScope = globalThis,
        logger = console,
    } = {}) {
        this.sampleFps = Math.max(10, Math.min(60, Math.round(toFiniteNumber(sampleFps, 30))));
        this.maxDurationSeconds = Math.max(10, toFiniteNumber(maxDurationSeconds, 3600));
        this.maxEstimatedBytes = Math.max(1024 * 1024, toFiniteNumber(
            maxEstimatedBytes,
            CINEMATIC_REPLAY_MAX_ESTIMATED_BYTES
        ));
        this.now = typeof now === 'function' ? now : (() => Date.now());
        this.globalScope = globalScope || globalThis;
        this.logger = logger || console;
        this._recording = false;
        this._matchId = null;
        this._startedAt = 0;
        this._elapsedMs = 0;
        this._sampleAccumulatorMs = 0;
        this._snapshots = [];
        this._metadata = null;
        this._partial = false;
        this._partialReason = null;
        this._estimatedBytes = 0;
        this._audioRecorder = null;
        this._audioChunks = [];
        this._audioMimeType = '';
        this._releaseAudioStream = null;
    }

    get isRecording() {
        return this._recording;
    }

    start({ matchId = null, metadata = null, audioStream = null, releaseAudioStream = null } = {}) {
        if (this._recording) {
            return { started: false, reason: 'already_recording', matchId: this._matchId };
        }
        this._recording = true;
        this._matchId = String(matchId || `match-${this.now().toString(36)}`);
        this._startedAt = this.now();
        this._elapsedMs = 0;
        this._sampleAccumulatorMs = 0;
        this._snapshots = [];
        this._metadata = cloneJsonValue(metadata, {});
        this._partial = false;
        this._partialReason = null;
        this._estimatedBytes = 0;
        this._startAudioCapture(audioStream, releaseAudioStream);
        return { started: true, mode: 'cinematic_replay', matchId: this._matchId };
    }

    _startAudioCapture(audioStream, releaseAudioStream) {
        this._audioRecorder = null;
        this._audioChunks = [];
        this._audioMimeType = '';
        this._releaseAudioStream = typeof releaseAudioStream === 'function'
            ? releaseAudioStream
            : null;
        const MediaRecorderCtor = this.globalScope?.MediaRecorder;
        if (!audioStream || typeof MediaRecorderCtor !== 'function') return;
        try {
            this._audioMimeType = resolveAudioMimeType(this.globalScope);
            this._audioRecorder = this._audioMimeType
                ? new MediaRecorderCtor(audioStream, { mimeType: this._audioMimeType })
                : new MediaRecorderCtor(audioStream);
            this._audioRecorder.addEventListener?.('dataavailable', (event) => {
                if (event?.data?.size > 0) this._audioChunks.push(event.data);
            });
            this._audioRecorder.start(1000);
        } catch (error) {
            this._audioRecorder = null;
            this._audioMimeType = '';
            this.logger?.warn?.('[CinematicReplayRecorder] audio capture unavailable', error);
        }
    }

    capture({ entityManager, roundState = null, particles = null, dt = 0, metadata = null } = {}) {
        if (!this._recording || !entityManager) return false;
        const deltaMs = Math.max(0, toFiniteNumber(dt, 0)) * 1000;
        this._elapsedMs += deltaMs;
        this._sampleAccumulatorMs += deltaMs;
        const intervalMs = 1000 / this.sampleFps;
        const firstSnapshot = this._snapshots.length === 0;
        if (!firstSnapshot && this._sampleAccumulatorMs + 0.0001 < intervalMs) return false;
        if (this._elapsedMs > this.maxDurationSeconds * 1000) {
            this._partial = true;
            this._partialReason ||= 'replay_duration_limit';
            return false;
        }
        this._sampleAccumulatorMs = firstSnapshot ? 0 : (this._sampleAccumulatorMs % intervalMs);
        if (metadata && this._snapshots.length === 0) {
            this._metadata = {
                ...(this._metadata || {}),
                ...(cloneJsonValue(metadata, {}) || {}),
            };
        }
        const snapshot = createReplaySnapshot({
            entityManager,
            roundState,
            particles,
            elapsedMs: this._elapsedMs,
            gameStateId: metadata?.gameStateId || '',
        });
        const estimatedBytes = estimateSnapshotBytes(snapshot);
        if (this._estimatedBytes + estimatedBytes > this.maxEstimatedBytes) {
            this.markPartial('replay_memory_budget');
            return false;
        }
        this._estimatedBytes += estimatedBytes;
        this._snapshots.push(snapshot);
        return true;
    }

    markPartial(reason = 'capture_partial') {
        this._partial = true;
        this._partialReason ||= String(reason || 'capture_partial');
    }

    async _stopAudioCapture() {
        const recorder = this._audioRecorder;
        if (!recorder) {
            this._releaseAudioStream?.();
            this._releaseAudioStream = null;
            return { blob: null, mimeType: '', warning: 'audio_capture_unavailable' };
        }
        let timedOut = false;
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve();
            };
            const timeoutId = setTimeout(() => {
                timedOut = true;
                finish();
            }, AUDIO_STOP_TIMEOUT_MS);
            recorder.addEventListener?.('stop', finish, { once: true });
            recorder.addEventListener?.('error', finish, { once: true });
            try {
                if (recorder.state === 'inactive') {
                    finish();
                } else {
                    recorder.requestData?.();
                    recorder.stop();
                }
            } catch {
                finish();
            }
        });
        this._releaseAudioStream?.();
        this._releaseAudioStream = null;
        const mimeType = this._audioMimeType || this._audioChunks[0]?.type || 'audio/webm';
        const blob = this._audioChunks.length > 0
            ? new Blob(this._audioChunks, { type: mimeType })
            : null;
        this._audioRecorder = null;
        this._audioChunks = [];
        this._audioMimeType = '';
        return {
            blob,
            mimeType,
            warning: timedOut
                ? 'audio_stop_timeout'
                : (blob?.size > 0 ? null : 'audio_capture_empty'),
        };
    }

    async stop() {
        if (!this._recording) return null;
        this._recording = false;
        const audio = await this._stopAudioCapture();
        if (audio.warning === 'audio_stop_timeout') {
            this.markPartial('audio_stop_timeout');
        }
        return {
            contractVersion: CINEMATIC_REPLAY_CONTRACT_VERSION,
            matchId: this._matchId,
            startedAt: this._startedAt,
            endedAt: this.now(),
            durationMs: Math.max(
                this._elapsedMs,
                toFiniteNumber(this._snapshots[this._snapshots.length - 1]?.timeMs, 0)
            ),
            sampleFps: this.sampleFps,
            metadata: cloneJsonValue(this._metadata, {}),
            snapshots: this._snapshots,
            snapshotCount: this._snapshots.length,
            estimatedBytes: this._estimatedBytes,
            partial: this._partial,
            partialReason: this._partialReason,
            audioBlob: audio.blob,
            audioMimeType: audio.mimeType,
            audioWarning: audio.warning,
        };
    }

    reset() {
        this._recording = false;
        this._matchId = null;
        this._startedAt = 0;
        this._elapsedMs = 0;
        this._sampleAccumulatorMs = 0;
        this._snapshots = [];
        this._metadata = null;
        this._partial = false;
        this._partialReason = null;
        this._estimatedBytes = 0;
        try {
            if (this._audioRecorder?.state !== 'inactive') this._audioRecorder?.stop?.();
        } catch {
            // Best-effort reset; no export is reported as successful here.
        }
        this._audioRecorder = null;
        this._audioChunks = [];
        this._audioMimeType = '';
        this._releaseAudioStream?.();
        this._releaseAudioStream = null;
    }
}
