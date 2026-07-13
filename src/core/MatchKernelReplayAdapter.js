// ============================================
// MatchKernelReplayAdapter.js - replay adapter for MatchKernel (V84 / 84.2.2)
// ============================================
//
// Contract (match-kernel-replay-adapter.v1):
// - Wraps any recorder that exposes startRecording, recordAction, stopRecording.
// - Hooks into kernel tick flow: call onTickResult(tickResult, inputFrame) per tick.
// - Adapter is surface-agnostic: works with both interactive and headless kernels.
//
// Usage (interactive):
//   const replayAdapter = createMatchKernelReplayAdapter({ recorder });
//   replayAdapter.startRecording(entityManager, roundState, playerCount);
//   // inside tick loop:
//   const result = kernelAdapter.tick(dt, renderFrameId);
//   replayAdapter.onTickResult(result, lastInputFrame);
//   // on match end:
//   const replayData = replayAdapter.stopRecording();
//
// Usage (headless):
//   Same, but call onTickResult after each runtime.step(inputFrame).

export const MATCH_KERNEL_REPLAY_ADAPTER_CONTRACT_VERSION = 'match-kernel-replay-adapter.v1';

/**
 * MatchKernelReplayAdapter – bridges MatchKernel tick results to a replay recorder.
 *
 * The adapter does NOT drive the kernel. It observes kernel tick results and
 * forwards relevant input actions to the recorder so that replays can be
 * reconstructed deterministically.
 */
export class MatchKernelReplayAdapter {
    constructor({ recorder = null } = {}) {
        this._recorder = recorder;
        this._active = false;
    }

    get isRecording() { return this._active; }

    /**
     * startRecording – delegate to the underlying recorder and mark active.
     *
     * @param {object} entityManager
     * @param {object} roundState
     * @param {number} playerCount
     */
    startRecording(entityManager, roundState, playerCount = 0) {
        if (!this._recorder || this._active) return;
        this._recorder.startRecording(entityManager, roundState, playerCount);
        this._active = true;
    }

    /**
     * onTickResult – called after each kernel tick.
     * Records player input actions from the input frame.
     *
     * @param {object|null} tickResult   MatchKernel tick result
     * @param {object|null} inputFrame   MatchKernelInputFrame or raw player actions array
     */
    onTickResult(tickResult, inputFrame = null) {
        if (!this._active || !this._recorder || !tickResult) return;

        const players = Array.isArray(inputFrame?.players) ? inputFrame.players : [];
        for (let i = 0; i < players.length; i++) {
            const playerInput = players[i];
            if (!playerInput) continue;
            const actions = playerInput.actions && typeof playerInput.actions === 'object'
                ? playerInput.actions
                : {};
            // Only record ticks with at least one active action to keep replay data lean.
            const hasAction = Object.values(actions).some(Boolean);
            if (hasAction) {
                this._recorder.recordAction({
                    playerIndex: i,
                    tickIndex: tickResult.tickIndex,
                    surface: tickResult.surface,
                    actions,
                });
            }
        }
    }

    /**
     * stopRecording – delegate to the underlying recorder.
     * @returns {object|null} replay data from the recorder
     */
    stopRecording() {
        if (!this._active || !this._recorder) return null;
        this._active = false;
        if (typeof this._recorder.stopRecording === 'function') {
            return this._recorder.stopRecording();
        }
        return null;
    }

    /**
     * dispose – release refs.
     */
    dispose() {
        this._active = false;
        this._recorder = null;
    }
}

/**
 * createMatchKernelReplayAdapter – factory.
 *
 * @param {{ recorder: object }} options
 */
export function createMatchKernelReplayAdapter({ recorder = null } = {}) {
    return new MatchKernelReplayAdapter({ recorder });
}
