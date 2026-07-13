import {
    normalizeGhostClip,
    normalizeGhostPlayerMeta,
} from '../../shared/contracts/GhostClipContract.js';

const SAMPLE_INTERVAL_MS = 50;
const MAX_SAMPLES = 1200;

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function roundTo(value, precision) {
    return Math.round(value * precision) / precision;
}

function normalizePlayerIndex(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeQuaternion(player) {
    const qx = Number(player?.quaternion?.x);
    const qy = Number(player?.quaternion?.y);
    const qz = Number(player?.quaternion?.z);
    const qw = Number(player?.quaternion?.w);
    if (!Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz) || !Number.isFinite(qw)) {
        return { qx: 0, qy: 0, qz: 0, qw: 1 };
    }

    const lengthSq = (qx * qx) + (qy * qy) + (qz * qz) + (qw * qw);
    if (!Number.isFinite(lengthSq) || lengthSq <= 1e-8) {
        return { qx: 0, qy: 0, qz: 0, qw: 1 };
    }

    const inverseLength = 1 / Math.sqrt(lengthSq);
    return {
        qx: roundTo(qx * inverseLength, 10000),
        qy: roundTo(qy * inverseLength, 10000),
        qz: roundTo(qz * inverseLength, 10000),
        qw: roundTo(qw * inverseLength, 10000),
    };
}

function createSampledPose(player, ownerIdx) {
    const x = Number(player?.position?.x);
    const y = Number(player?.position?.y);
    const z = Number(player?.position?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    return {
        idx: ownerIdx,
        x: roundTo(x, 10),
        y: roundTo(y, 10),
        z: roundTo(z, 10),
        alive: player?.alive !== false,
        ...normalizeQuaternion(player),
    };
}

export class ArcadeGhostRecorder {
    constructor() {
        this._recording = false;
        this._frames = [];
        this._startMs = 0;
        this._lastSampleMs = -Infinity;
        this._playerIdx = 0;
        this._routeId = '';
        this._sampleIntervalMs = SAMPLE_INTERVAL_MS;
        this._playerMeta = null;
        this._debugSnapshot = {
            routeId: '',
            ownerIdx: null,
            frameCount: 0,
            sourceDuration: 0,
            sampleIntervalMs: SAMPLE_INTERVAL_MS,
            active: false,
        };
    }

    _updateDebugSnapshot(active = this._recording) {
        const lastFrame = this._frames.length > 0 ? this._frames[this._frames.length - 1] : null;
        this._debugSnapshot.routeId = this._routeId;
        this._debugSnapshot.ownerIdx = this._playerMeta?.idx ?? this._playerIdx ?? null;
        this._debugSnapshot.frameCount = this._frames.length;
        this._debugSnapshot.sourceDuration = lastFrame
            ? roundTo(Math.max(0, Number(lastFrame?.time) || 0), 1000)
            : 0;
        this._debugSnapshot.sampleIntervalMs = this._sampleIntervalMs;
        this._debugSnapshot.active = active === true;
    }

    _clearRecordingState({ preserveIdentity = false } = {}) {
        this._recording = false;
        this._frames = [];
        this._startMs = 0;
        this._lastSampleMs = -Infinity;
        this._sampleIntervalMs = SAMPLE_INTERVAL_MS;
        if (!preserveIdentity) {
            this._playerIdx = 0;
            this._playerMeta = null;
            this._routeId = '';
        }
    }

    startRecording(playerIndex, nowMs, options = {}) {
        const nextPlayerIdx = normalizePlayerIndex(playerIndex);
        if (nextPlayerIdx == null || options?.isBot === true) return false;
        if (this._recording && this._playerIdx !== nextPlayerIdx) return false;

        this._recording = true;
        this._frames = [];
        this._startMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0;
        this._lastSampleMs = -Infinity;
        this._playerIdx = nextPlayerIdx;
        this._routeId = normalizeString(options?.routeId, '');
        this._sampleIntervalMs = SAMPLE_INTERVAL_MS;
        this._playerMeta = normalizeGhostPlayerMeta({
            idx: nextPlayerIdx,
            color: options?.color,
            isBot: false,
            modelScale: options?.modelScale,
        }) || {
            idx: nextPlayerIdx,
            color: 0xffffff,
            isBot: false,
            modelScale: 1,
        };
        this._updateDebugSnapshot(true);
        return true;
    }

    _compactFrames() {
        if (this._frames.length < MAX_SAMPLES) return;

        let writeIndex = 1;
        const lastIndex = this._frames.length - 1;
        for (let readIndex = 2; readIndex < lastIndex; readIndex += 2) {
            this._frames[writeIndex] = this._frames[readIndex];
            writeIndex += 1;
        }
        this._frames[writeIndex] = this._frames[lastIndex];
        writeIndex += 1;
        this._frames.length = writeIndex;
        this._sampleIntervalMs *= 2;
    }

    _updatePlayerMeta(player) {
        this._playerMeta = normalizeGhostPlayerMeta({
            idx: this._playerIdx,
            color: player?.color,
            isBot: false,
            modelScale: player?.modelScale,
        }) || this._playerMeta;
    }

    sample(player, nowMs) {
        if (!this._recording) return;
        const sampledPlayerIdx = normalizePlayerIndex(player?.index);
        if (sampledPlayerIdx == null || sampledPlayerIdx !== this._playerIdx || player?.isBot === true) return;

        const safeNowMs = Number(nowMs);
        if (!Number.isFinite(safeNowMs) || safeNowMs < this._startMs) return;
        if ((safeNowMs - this._lastSampleMs) < this._sampleIntervalMs) return;

        const sampledPose = createSampledPose(player, this._playerIdx);
        if (!sampledPose) return;

        if (this._frames.length >= MAX_SAMPLES) {
            this._compactFrames();
        }

        this._updatePlayerMeta(player);
        this._lastSampleMs = safeNowMs;
        this._frames.push({
            time: roundTo(Math.max(0, (safeNowMs - this._startMs) / 1000), 1000),
            players: [sampledPose],
        });
        this._updateDebugSnapshot(true);
    }

    stopRecording(playerIndex = null) {
        if (!this._recording) return null;
        if (playerIndex != null && !this.isOwnedBy(playerIndex)) return null;

        this._recording = false;
        if (this._frames.length < 2) {
            this._updateDebugSnapshot(false);
            return null;
        }

        const sourceDuration = Math.max(0, Number(this._frames[this._frames.length - 1]?.time) || 0);
        const normalizedClip = normalizeGhostClip({
            routeId: this._routeId,
            frames: this._frames,
            players: [this._playerMeta || { idx: this._playerIdx, color: 0xffffff, isBot: false, modelScale: 1 }],
            sourceDuration,
            displayDuration: sourceDuration,
        });
        if (normalizedClip) {
            this._frames = normalizedClip.frames;
            this._playerMeta = normalizedClip.players.find((player) => player.idx === this._playerIdx)
                || normalizedClip.players[0]
                || this._playerMeta;
            this._routeId = normalizeString(normalizedClip.routeId, this._routeId);
        }
        this._updateDebugSnapshot(false);
        return normalizedClip;
    }

    cancelRecording(reason = 'cancelled', playerIndex = null) {
        if (!this._recording) return false;
        if (playerIndex != null && !this.isOwnedBy(playerIndex)) return false;

        this._recording = false;
        this._updateDebugSnapshot(false);
        this._debugSnapshot.cancelReason = normalizeString(reason, 'cancelled');
        this._clearRecordingState({ preserveIdentity: true });
        return true;
    }

    get isRecording() {
        return this._recording;
    }

    isOwnedBy(playerIndex) {
        const normalizedPlayerIdx = normalizePlayerIndex(playerIndex);
        return this._recording === true && normalizedPlayerIdx != null && normalizedPlayerIdx === this._playerIdx;
    }

    getDebugSnapshot() {
        return { ...this._debugSnapshot };
    }

    reset() {
        this._clearRecordingState({ preserveIdentity: false });
        this._debugSnapshot = {
            routeId: '',
            ownerIdx: null,
            frameCount: 0,
            sourceDuration: 0,
            sampleIntervalMs: SAMPLE_INTERVAL_MS,
            active: false,
        };
    }
}
