// @ts-nocheck

export const CINEMATIC_REPLAY_LIBRARY_MAX_ENTRIES = 8;
export const CINEMATIC_REPLAY_LIBRARY_MAX_ESTIMATED_BYTES = 512 * 1024 * 1024;

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function summarizeEntry(entry) {
    const replay = entry.replay;
    return {
        recordingId: entry.recordingId,
        matchId: String(replay.matchId || ''),
        startedAt: Math.max(0, toFiniteNumber(replay.startedAt, entry.queuedAt)),
        endedAt: Math.max(0, toFiniteNumber(replay.endedAt, entry.queuedAt)),
        queuedAt: entry.queuedAt,
        durationMs: Math.max(0, toFiniteNumber(replay.durationMs, 0)),
        snapshotCount: Math.max(0, Math.trunc(toFiniteNumber(replay.snapshotCount, replay.snapshots?.length || 0))),
        estimatedBytes: entry.estimatedBytes,
        partial: replay.partial === true,
        partialReason: replay.partialReason || null,
        metadata: replay.metadata && typeof replay.metadata === 'object'
            ? { ...replay.metadata }
            : {},
    };
}

export class CinematicReplayLibrary {
    constructor({
        now = () => Date.now(),
        maxEntries = CINEMATIC_REPLAY_LIBRARY_MAX_ENTRIES,
        maxEstimatedBytes = CINEMATIC_REPLAY_LIBRARY_MAX_ESTIMATED_BYTES,
    } = {}) {
        this.now = typeof now === 'function' ? now : (() => Date.now());
        this.maxEntries = Math.max(1, Math.trunc(toFiniteNumber(
            maxEntries,
            CINEMATIC_REPLAY_LIBRARY_MAX_ENTRIES
        )));
        this.maxEstimatedBytes = Math.max(1024 * 1024, toFiniteNumber(
            maxEstimatedBytes,
            CINEMATIC_REPLAY_LIBRARY_MAX_ESTIMATED_BYTES
        ));
        this._entries = [];
        this._sequence = 0;
        this._estimatedBytes = 0;
    }

    getCapacityState() {
        const fullByCount = this._entries.length >= this.maxEntries;
        const fullByBytes = this._estimatedBytes >= this.maxEstimatedBytes;
        return {
            canRecord: !fullByCount && !fullByBytes,
            count: this._entries.length,
            maxEntries: this.maxEntries,
            estimatedBytes: this._estimatedBytes,
            maxEstimatedBytes: this.maxEstimatedBytes,
            reason: fullByCount
                ? 'replay_library_entry_limit'
                : (fullByBytes ? 'replay_library_memory_limit' : null),
        };
    }

    enqueue(replay) {
        if (!replay || !Array.isArray(replay.snapshots)) {
            return { queued: false, reason: 'invalid_replay' };
        }
        const capacity = this.getCapacityState();
        if (!capacity.canRecord) {
            return { queued: false, reason: capacity.reason, capacity };
        }
        const queuedAt = this.now();
        this._sequence += 1;
        const estimatedBytes = Math.max(
            0,
            toFiniteNumber(replay.estimatedBytes, 0) + toFiniteNumber(replay.audioBlob?.size, 0)
        );
        const entry = {
            recordingId: `cinematic-${queuedAt.toString(36)}-${this._sequence.toString(36)}`,
            queuedAt,
            estimatedBytes,
            replay,
        };
        this._entries.push(entry);
        this._estimatedBytes += estimatedBytes;
        return {
            queued: true,
            recording: summarizeEntry(entry),
            capacity: this.getCapacityState(),
        };
    }

    list() {
        return this._entries.slice().reverse().map(summarizeEntry);
    }

    getReplay(recordingId) {
        const normalizedId = String(recordingId || '').trim();
        return this._entries.find((entry) => entry.recordingId === normalizedId)?.replay || null;
    }

    remove(recordingId) {
        const normalizedId = String(recordingId || '').trim();
        const index = this._entries.findIndex((entry) => entry.recordingId === normalizedId);
        if (index < 0) return { removed: false, reason: 'recording_not_found' };
        const [entry] = this._entries.splice(index, 1);
        this._estimatedBytes = Math.max(0, this._estimatedBytes - entry.estimatedBytes);
        return {
            removed: true,
            recording: summarizeEntry(entry),
            capacity: this.getCapacityState(),
        };
    }

    clear() {
        const removedCount = this._entries.length;
        this._entries.length = 0;
        this._estimatedBytes = 0;
        return { cleared: true, removedCount };
    }
}
