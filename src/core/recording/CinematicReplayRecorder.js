// @ts-nocheck
import { createGameStateSnapshot } from '../GameStateSnapshot.js';

export const CINEMATIC_REPLAY_CONTRACT_VERSION = 'cinematic-replay.v2';
export const CINEMATIC_REPLAY_SAMPLE_FPS = 30;
export const CINEMATIC_REPLAY_MAX_DURATION_SECONDS = 60 * 60;
export const CINEMATIC_REPLAY_MAX_ESTIMATED_BYTES = 256 * 1024 * 1024;

const AUDIO_STOP_TIMEOUT_MS = 8000;
const MAX_PARTICLES_PER_SNAPSHOT = 1000;

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
    const values = new Array(count * 13);
    for (let index = 0; index < count; index++) {
        const src3 = index * 3;
        const dst = index * 13;
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
        values[dst + 8] = toFiniteNumber(particles.gravities?.[index], 0);
        values[dst + 9] = Math.max(0, toFiniteNumber(particles.scales?.[index], 0));
        values[dst + 10] = toFiniteNumber(particles.colors?.[src3], 1);
        values[dst + 11] = toFiniteNumber(particles.colors?.[src3 + 1], 1);
        values[dst + 12] = toFiniteNumber(particles.colors?.[src3 + 2], 1);
    }
    return { count, values };
}

function enrichPlayerVisualState(snapshotPlayers, livePlayers, renderProjection = null) {
    const projectedPlayers = Array.isArray(renderProjection?.players)
        ? renderProjection.players
        : [];
    for (let index = 0; index < snapshotPlayers.length; index++) {
        const snapshot = snapshotPlayers[index];
        const player = livePlayers.find(
            (candidate) => Number(candidate?.index) === Number(snapshot?.index)
        ) || livePlayers[index];
        if (!snapshot || !player) continue;
        const projected = projectedPlayers.find(
            (candidate) => Number(candidate?.playerIndex) === Number(snapshot.index)
        );
        if (projected?.position) {
            snapshot.pos = [
                toFiniteNumber(projected.position.x),
                toFiniteNumber(projected.position.y),
                toFiniteNumber(projected.position.z),
            ];
        }
        if (projected?.quaternion) {
            snapshot.rot = [
                toFiniteNumber(projected.quaternion.x),
                toFiniteNumber(projected.quaternion.y),
                toFiniteNumber(projected.quaternion.z),
                toFiniteNumber(projected.quaternion.w, 1),
            ];
        }
        snapshot.renderDiscontinuityVersion = Math.max(0, Math.trunc(toFiniteNumber(
            projected?.renderDiscontinuityVersion ?? player?._renderDiscontinuityVersion,
            0
        )));
        snapshot.maxHealth = toFiniteNumber(player.maxHp, 100);
        snapshot.maxShieldHp = toFiniteNumber(player.maxShieldHp, 0);
        snapshot.shieldHitFeedback = toFiniteNumber(player.shieldHitFeedback, 0);
        snapshot.boostCharge = toFiniteNumber(player.boostCharge, 0);
        snapshot.boostCapacity = Math.max(0.001, toFiniteNumber(
            player.boostCapacity
            ?? player.gameplayConfig?.PLAYER?.BOOST_DURATION,
            1
        ));
        snapshot.isBoosting = player.isBoosting === true;
        snapshot.cameraMode = Math.trunc(toFiniteNumber(player.cameraMode, 0));
        snapshot.cockpitCamera = player.cockpitCamera === true;
        snapshot.planarMode = player.gameplayConfig?.GAMEPLAY?.PLANAR_MODE === true;
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
        snapshot.trailWidth = Math.max(0.01, toFiniteNumber(player.trail?.width, 0.6));
        snapshot.trailInGap = player.trail?.inGap === true;
    }
}

function enrichSceneVisualState(snapshot, entityManager) {
    const liveProjectiles = entityManager?.projectiles || [];
    for (let index = 0; index < snapshot.projectiles.length; index++) {
        const entry = snapshot.projectiles[index];
        const projectile = liveProjectiles.find(
            (candidate, candidateIndex) => String(
                candidate?.id || candidate?.traversalId || candidateIndex
            ) === String(entry.id)
        );
        if (!projectile) continue;
        entry.color = Math.trunc(toFiniteNumber(
            projectile.color
            ?? projectile.mesh?.userData?.projectileColor
            ?? projectile.mesh?.material?.color?.getHex?.(),
            0xffaa00
        ));
        entry.visualScale = Math.max(
            0.01,
            toFiniteNumber(projectile.visualScale ?? projectile.mesh?.scale?.x, 1)
        );
        entry.visible = projectile.mesh?.visible !== false;
    }

    const livePowerups = entityManager?.powerups || entityManager?.powerupManager?.items || [];
    for (let index = 0; index < snapshot.powerups.length; index++) {
        const entry = snapshot.powerups[index];
        const powerup = livePowerups.find(
            (candidate, candidateIndex) => String(
                candidate?.id || candidate?.networkId || candidateIndex
            ) === String(entry.id)
        );
        if (!powerup) continue;
        if (powerup.mesh?.position) {
            entry.pos = [
                toFiniteNumber(powerup.mesh.position.x),
                toFiniteNumber(powerup.mesh.position.y),
                toFiniteNumber(powerup.mesh.position.z),
            ];
        }
        entry.rotationY = toFiniteNumber(powerup.mesh?.rotation?.y, 0);
        entry.visible = powerup.mesh?.visible !== false;
    }
}

function captureCameraState(cameras) {
    const source = Array.isArray(cameras) ? cameras : [];
    return source.map((camera, index) => ({
        index,
        position: [
            toFiniteNumber(camera?.position?.x),
            toFiniteNumber(camera?.position?.y),
            toFiniteNumber(camera?.position?.z),
        ],
        quaternion: [
            toFiniteNumber(camera?.quaternion?.x),
            toFiniteNumber(camera?.quaternion?.y),
            toFiniteNumber(camera?.quaternion?.z),
            toFiniteNumber(camera?.quaternion?.w, 1),
        ],
        fov: Math.max(1, toFiniteNumber(camera?.fov, 60)),
        aspect: Math.max(0.01, toFiniteNumber(camera?.aspect, 16 / 9)),
        near: Math.max(0.001, toFiniteNumber(camera?.near, 0.1)),
        far: Math.max(1, toFiniteNumber(camera?.far, 200)),
        zoom: Math.max(0.01, toFiniteNumber(camera?.zoom, 1)),
    }));
}

function createReplaySnapshot({
    entityManager,
    roundState,
    particles,
    cameras,
    renderProjection,
    elapsedMs,
    gameStateId = '',
}) {
    const snapshot = createGameStateSnapshot(entityManager, roundState);
    enrichPlayerVisualState(
        snapshot.players,
        entityManager?.players || [],
        renderProjection
    );
    enrichSceneVisualState(snapshot, entityManager);
    snapshot.timeMs = Math.max(0, Math.round(elapsedMs));
    snapshot.gameStateId = String(gameStateId || '');
    snapshot.particles = captureParticleState(particles);
    snapshot.cameras = captureCameraState(cameras);
    return snapshot;
}

function estimateSnapshotBytes(snapshot) {
    return 256
        + ((snapshot?.players?.length || 0) * 256)
        + ((snapshot?.projectiles?.length || 0) * 160)
        + ((snapshot?.powerups?.length || 0) * 96)
        + ((snapshot?.turrets?.length || 0) * 192)
        + ((snapshot?.cameras?.length || 0) * 128)
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
        this._lastCaptureAt = 0;
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
        this._lastCaptureAt = this._startedAt;
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

    capture({
        entityManager,
        roundState = null,
        particles = null,
        cameras = null,
        renderProjection = null,
        dt = 0,
        metadata = null,
    } = {}) {
        if (!this._recording || !entityManager) return false;
        const capturedAt = this.now();
        const wallDeltaMs = Math.max(0, capturedAt - this._lastCaptureAt);
        this._lastCaptureAt = capturedAt;
        const renderDeltaMs = Math.max(0, toFiniteNumber(dt, 0)) * 1000;
        const deltaMs = wallDeltaMs > 0 ? wallDeltaMs : renderDeltaMs;
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
            cameras,
            renderProjection,
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
        this._lastCaptureAt = 0;
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
