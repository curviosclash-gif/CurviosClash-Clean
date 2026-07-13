// ============================================
// EpisodeController.js - deterministic episode lifecycle for training sessions
// ============================================

import { deriveTrainingDomain } from './TrainingDomain.js';

const DEFAULT_MAX_STEPS = 1800;

export const TRAINING_TERMINAL_REASONS = Object.freeze({
    EXTERNAL: 'external-terminal',
    MATCH_ENDED: 'match-ended',
    PLAYER_DEAD: 'player-dead',
    MANUAL_STOP: 'manual-stop',
});

export const TRAINING_TRUNCATION_REASONS = Object.freeze({
    EXTERNAL: 'external-truncated',
    MAX_STEPS: 'max-steps',
    TIME_LIMIT: 'time-limit',
});

function toPositiveInt(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(1, Math.trunc(numeric));
}

function toTimestampMs(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
        return Math.trunc(numeric);
    }
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return Math.trunc(performance.now());
    }
    return Date.now();
}

function toReason(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function cloneEpisodeState(state) {
    return {
        episodeId: state.episodeId,
        episodeIndex: state.episodeIndex,
        stepIndex: state.stepIndex,
        maxSteps: state.maxSteps,
        done: state.done,
        truncated: state.truncated,
        terminalReason: state.terminalReason,
        truncatedReason: state.truncatedReason,
        startedAtMs: state.startedAtMs,
        updatedAtMs: state.updatedAtMs,
        domain: state.domain ? { ...state.domain } : null,
    };
}

export class EpisodeController {
    constructor(options = {}) {
        this._defaultMaxSteps = toPositiveInt(options.defaultMaxSteps, DEFAULT_MAX_STEPS);
        this._episodeCounter = 0;
        this._state = null;
    }

    hasActiveEpisode() {
        return !!this._state;
    }

    getSnapshot() {
        return this._state ? cloneEpisodeState(this._state) : null;
    }

    reset(input = {}) {
        this._episodeCounter += 1;
        const requestedEpisodeId = typeof input.episodeId === 'string' && input.episodeId.trim()
            ? input.episodeId.trim()
            : null;
        const nowMs = toTimestampMs(input.nowMs);
        const maxSteps = toPositiveInt(input.maxSteps, this._defaultMaxSteps);

        this._state = {
            episodeId: requestedEpisodeId || `episode-${this._episodeCounter}`,
            episodeIndex: this._episodeCounter,
            stepIndex: 0,
            maxSteps,
            done: false,
            truncated: false,
            terminalReason: null,
            truncatedReason: null,
            startedAtMs: nowMs,
            updatedAtMs: nowMs,
            domain: deriveTrainingDomain(input),
        };
        return this.getSnapshot();
    }

    close(reason = TRAINING_TERMINAL_REASONS.MANUAL_STOP, nowMs = null) {
        if (!this._state) return null;
        this._state.done = true;
        this._state.truncated = false;
        this._state.terminalReason = toReason(reason, TRAINING_TERMINAL_REASONS.MANUAL_STOP);
        this._state.truncatedReason = null;
        this._state.updatedAtMs = toTimestampMs(nowMs);
        return this.getSnapshot();
    }

    step(input = {}) {
        if (!this._state) {
            this.reset(input);
        }

        const state = this._state;
        if (state.done || state.truncated) {
            return {
                ...this.getSnapshot(),
                wasTerminal: true,
                justTerminated: false,
            };
        }

        const nextStepIndex = state.stepIndex + 1;
        let done = !!input.done;
        let truncated = !!input.truncated;
        let terminalReason = done
            ? toReason(input.terminalReason, TRAINING_TERMINAL_REASONS.EXTERNAL)
            : null;
        let truncatedReason = truncated
            ? toReason(input.truncatedReason, TRAINING_TRUNCATION_REASONS.EXTERNAL)
            : null;

        if (!done && !truncated && nextStepIndex >= state.maxSteps) {
            truncated = true;
            truncatedReason = TRAINING_TRUNCATION_REASONS.MAX_STEPS;
        }

        state.stepIndex = nextStepIndex;
        state.done = done;
        state.truncated = truncated;
        state.terminalReason = done ? terminalReason : null;
        state.truncatedReason = truncated ? truncatedReason : null;
        state.updatedAtMs = toTimestampMs(input.nowMs);

        return {
            ...this.getSnapshot(),
            wasTerminal: false,
            justTerminated: done || truncated,
        };
    }
}

export function createEpisodeController(options = {}) {
    return new EpisodeController(options);
}
