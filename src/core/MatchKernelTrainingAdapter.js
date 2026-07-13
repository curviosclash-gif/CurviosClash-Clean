// ============================================
// MatchKernelTrainingAdapter.js - training adapter for MatchKernel (V84 / 84.2.2)
// ============================================
//
// Contract (match-kernel-training-adapter.v1):
// - Wraps a headless runtime handle (from createHeadlessMatchKernelRuntime).
// - Provides a step(inputFrame, tickOptions?) interface for training runners.
// - Returns { tickResult, lifecycle } after each step so callers can observe state.
//
// The adapter decouples training orchestration (episode/reward logic) from the
// kernel internals. Training runners (DeterministicTrainingStepRunner or future
// network-based runners) call adapter.step() and receive structured results.
//
// Invariants:
// - Does NOT reference DOM, window, document, Three.js or Electron.
// - headlessRuntime must implement { step, signalRoundEnd, signalMatchEnd,
//   restartRound, dispose, kernel }.

export const MATCH_KERNEL_TRAINING_ADAPTER_CONTRACT_VERSION = 'match-kernel-training-adapter.v1';

/**
 * MatchKernelTrainingAdapter – bridges a training step runner to a headless MatchKernel.
 *
 * The adapter forwards step() calls to the headless runtime and packages the
 * tick result together with lifecycle metadata so that reward/episode controllers
 * can act on match state without accessing kernel internals directly.
 */
export class MatchKernelTrainingAdapter {
    constructor({ headlessRuntime = null } = {}) {
        this._runtime = headlessRuntime;
    }

    get kernel() { return this._runtime?.kernel ?? null; }
    get lifecycle() { return this._runtime?.kernel?.lifecycle ?? 'disposed'; }
    get tickIndex() { return this._runtime?.kernel?.tickIndex ?? 0; }
    get roundIndex() { return this._runtime?.kernel?.roundIndex ?? 0; }

    /**
     * step – advance the kernel by one tick using a training-sourced input frame.
     *
     * @param {object|null} inputFrame  MatchKernelInputFrame (players[].actions)
     * @param {object}      tickOptions Optional tick envelope overrides
     * @returns {{ tickResult: object|null, lifecycle: string, tickIndex: number, roundIndex: number }}
     */
    step(inputFrame = null, tickOptions = {}) {
        if (!this._runtime) {
            return { tickResult: null, lifecycle: 'disposed', tickIndex: 0, roundIndex: 0 };
        }
        const tickResult = this._runtime.step(inputFrame, tickOptions);
        return {
            tickResult,
            lifecycle: this.lifecycle,
            tickIndex: this.tickIndex,
            roundIndex: this.roundIndex,
        };
    }

    /**
     * signalRoundEnd – notify the kernel that the current round has ended.
     * @returns {string} new lifecycle
     */
    signalRoundEnd(options = {}) {
        if (!this._runtime) return 'disposed';
        return this._runtime.signalRoundEnd(options);
    }

    /**
     * signalMatchEnd – notify the kernel that the match has ended.
     * @returns {string} new lifecycle
     */
    signalMatchEnd() {
        if (!this._runtime) return 'disposed';
        return this._runtime.signalMatchEnd();
    }

    /**
     * restartRound – reset entity state and restart the kernel round.
     * @returns {boolean}
     */
    restartRound() {
        if (!this._runtime) return false;
        return this._runtime.restartRound();
    }

    /**
     * dispose – release the headless runtime and all refs.
     */
    dispose(options = {}) {
        if (!this._runtime) return false;
        const result = this._runtime.dispose(options);
        this._runtime = null;
        return result;
    }
}

/**
 * createMatchKernelTrainingAdapter – factory.
 *
 * @param {{ headlessRuntime: object }} options  headless runtime from createHeadlessMatchKernelRuntime
 */
export function createMatchKernelTrainingAdapter({ headlessRuntime = null } = {}) {
    return new MatchKernelTrainingAdapter({ headlessRuntime });
}
