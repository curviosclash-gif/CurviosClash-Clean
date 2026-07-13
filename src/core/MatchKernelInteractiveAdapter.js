// ============================================
// MatchKernelInteractiveAdapter.js - interactive runtime adapter for MatchKernel (V84)
// ============================================
//
// Contract (match-kernel-interactive-adapter.v1):
// - Inputs: game (interactive runtime handle), kernel (MatchKernel instance)
// - Outputs: kernel tick result via adapter.tick(dt, renderFrameId)
// - Invariants:
//   - This adapter bridges PlayingStateSystem and the MatchKernel.
//   - It reads game.input (live interactive source) and passes it to the kernel.
//   - It can drive running, round-end and match-end kernel ticks.
//   - Pause/Escape intent is handled by PlayingStateSystem before calling this adapter.

import {
    MATCH_KERNEL_SURFACES,
} from '../shared/contracts/MatchKernelRuntimeContract.js';
import {
    MATCH_KERNEL_CONSUMER_IDS,
    createMatchKernelConsumerAdapter,
} from '../state/MatchKernelConsumerAdapters.js';
import { createGameStateSnapshot } from './GameStateSnapshot.js';

export const MATCH_KERNEL_INTERACTIVE_ADAPTER_CONTRACT_VERSION =
    'match-kernel-interactive-adapter.v1';

/**
 * MatchKernelInteractiveAdapter – bridges the interactive `game` object to MatchKernel.
 *
 * Usage inside PlayingStateSystem:
 *   if (this._kernelAdapter) {
 *       this._kernelAdapter.tick(dt, renderFrameId);
 *   } else {
 *       // legacy direct calls
 *   }
 */
export class MatchKernelInteractiveAdapter {
    constructor({ game = null, kernel = null } = {}) {
        this._game = game;
        this._kernel = kernel;
        this._runtimeAdapter = createMatchKernelConsumerAdapter({
            consumerId: MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE,
            kernel,
            sessionProvider: () => this._game?.matchSessionRuntimeBridge?.getCurrentMatchSessionRefs?.() || null,
            sessionRuntimeProvider: () => this._game?.runtimeBundle?.sessionRuntime || this._game?.sessionRuntime || null,
            gameStateSnapshotProvider: () => {
                const session = this._game?.matchSessionRuntimeBridge?.getCurrentMatchSessionRefs?.() || null;
                if (!session?.entityManager) return null;
                const roundState = this._game?.runtimeBundle?.state?.roundStateController || this._game?.roundStateController || null;
                return createGameStateSnapshot(session.entityManager, roundState);
            },
        });
    }

    get kernel() { return this._kernel; }
    get profile() { return this._runtimeAdapter?.profile || null; }
    getDescriptor() { return this._runtimeAdapter?.getDescriptor?.() || null; }
    createInputFrame(payload = {}) { return this._runtimeAdapter?.createInputFrame?.(payload) || null; }
    createSeedEnvelope(payload = {}) { return this._runtimeAdapter?.createSeedEnvelope?.(payload) || null; }
    createSnapshotEnvelope(payload = {}) { return this._runtimeAdapter?.createSnapshotEnvelope?.(payload) || null; }

    /**
     * tick – drive one MatchKernel tick from the interactive game loop.
     *
     * @param {number} dt            Fixed simulation step in seconds.
     * @param {number} renderFrameId Current render frame counter from GameLoop.
     * @returns {object|null} MatchKernel tick result or null if not running.
     */
    tick(dt, renderFrameId = 0) {
        if (!this._kernel) return null;
        if (this._kernel.lifecycle === 'idle' || this._kernel.lifecycle === 'disposed') {
            return null;
        }

        const tickEnvelope = this._runtimeAdapter.createTickEnvelope({
            fixedStepSeconds: dt,
            frameId: renderFrameId,
            surface: MATCH_KERNEL_SURFACES.INTERACTIVE,
            wallClockMs: (typeof Date !== 'undefined') ? Date.now() : 0,
            highResTimestampMs: (typeof performance !== 'undefined') ? performance.now() : 0,
            timeScale: this._game?.gameLoop?.timeScale ?? 1,
        });

        // Pass game.input directly: it provides getPlayerInput(playerIndex, options).
        // EntityManager.update(dt, inputManager, frameId) uses this interface.
        return this._kernel.tick(tickEnvelope, this._game?.input ?? null);
    }

    /**
     * dispose – release references.
     */
    dispose() {
        this._runtimeAdapter?.dispose?.();
        this._runtimeAdapter = null;
        this._game = null;
        this._kernel = null;
    }
}

/**
 * createMatchKernelInteractiveAdapter – factory for interactive kernel adapters.
 *
 * @param {{ game: object, kernel: import('../state/MatchKernel.js').MatchKernel }} options
 */
export function createMatchKernelInteractiveAdapter({ game = null, kernel = null } = {}) {
    return new MatchKernelInteractiveAdapter({ game, kernel });
}
