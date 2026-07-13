// ============================================
// MatchSessionRuntimeBridge.js - match session ref apply/clear facade
// ============================================
//
// Contract:
// - Inputs: game runtime + initializedMatch payload from MatchSessionFactory
// - Outputs: stable current-session reference object for lifecycle operations
// - Side effects: applies/clears game runtime refs (arena/entity/powerup/particles)

import {
    applyMatchSessionState,
    clearMatchSessionState,
    getCurrentMatchSessionRefs,
    getSessionRuntimeHandle,
    setSessionRuntimeHandle,
} from './runtime/GameRuntimeBundle.js';
import { createMatchKernelInteractiveAdapter } from './MatchKernelInteractiveAdapter.js';
import { createGameStateSnapshot } from './GameStateSnapshot.js';
import { createMatchKernelConsumerRegistry } from '../state/MatchKernelConsumerAdapters.js';

const MATCH_KERNEL_HANDLE_KEY = 'matchKernel';
const MATCH_KERNEL_ADAPTER_HANDLE_KEY = 'matchKernelAdapter';
const MATCH_KERNEL_CONSUMERS_HANDLE_KEY = 'matchKernelConsumers';

export class MatchSessionRuntimeBridge {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this.ports = deps.ports || null;
        this.runtimeBundle = deps.runtimeBundle || null;
    }

    _getRuntimeHandle(key) {
        return getSessionRuntimeHandle(this.runtimeBundle, key);
    }

    _setRuntimeHandle(key, value) {
        return setSessionRuntimeHandle(this.runtimeBundle, key, value);
    }

    _disposeKernelAdapter() {
        const kernelAdapter = this.getCurrentMatchKernelAdapter();
        this.game?.playingStateSystem?.setKernelAdapter?.(null);
        kernelAdapter?.dispose?.();
        this._setRuntimeHandle(MATCH_KERNEL_ADAPTER_HANDLE_KEY, null);
    }

    _disposeMatchKernel() {
        const matchKernel = this.getCurrentMatchKernel();
        matchKernel?.dispose?.();
        this._setRuntimeHandle(MATCH_KERNEL_HANDLE_KEY, null);
    }

    _disposeKernelConsumers() {
        const kernelConsumers = this.getCurrentMatchKernelConsumers();
        kernelConsumers?.dispose?.();
        this._setRuntimeHandle(MATCH_KERNEL_CONSUMERS_HANDLE_KEY, null);
    }

    applyInitializedMatchSession(initializedMatch) {
        const matchSession = initializedMatch?.session;
        if (!this.game || !this.runtimeBundle || !matchSession) return;
        applyMatchSessionState(this.runtimeBundle, matchSession);

        this._disposeKernelAdapter();
        this._disposeKernelConsumers();
        this._disposeMatchKernel();

        const matchKernel = initializedMatch?.kernel || null;
        if (!matchKernel) return;
        this._setRuntimeHandle(MATCH_KERNEL_HANDLE_KEY, matchKernel);
        const kernelAdapter = createMatchKernelInteractiveAdapter({
            game: this.game,
            kernel: matchKernel,
        });
        this._setRuntimeHandle(MATCH_KERNEL_ADAPTER_HANDLE_KEY, kernelAdapter);
        this.game?.playingStateSystem?.setKernelAdapter?.(kernelAdapter);
        const kernelConsumers = createMatchKernelConsumerRegistry({
            kernel: matchKernel,
            allowKernelTick: false,
            sessionProvider: () => getCurrentMatchSessionRefs(this.runtimeBundle),
            sessionRuntimeProvider: () => this.runtimeBundle?.sessionRuntime || this.game?.sessionRuntime || null,
            gameStateSnapshotProvider: () => {
                const session = getCurrentMatchSessionRefs(this.runtimeBundle);
                if (!session?.entityManager) return null;
                const roundState = this.runtimeBundle?.state?.roundStateController || this.game?.roundStateController || null;
                return createGameStateSnapshot(session.entityManager, roundState);
            },
            profile: {
                matchId: matchSession?.effectiveMapKey || matchKernel?.profile?.matchId || null,
                modeId: matchSession?.entityManager?.activeGameMode || matchKernel?.profile?.modeId || null,
                sessionId: this.runtimeBundle?.sessionRuntime?.session?.activeSessionId || this.game?.sessionRuntime?.session?.activeSessionId || null,
            },
        });
        this._setRuntimeHandle(MATCH_KERNEL_CONSUMERS_HANDLE_KEY, kernelConsumers);
    }

    getCurrentMatchSessionRefs() {
        return getCurrentMatchSessionRefs(this.runtimeBundle);
    }

    getCurrentMatchKernel() {
        return this._getRuntimeHandle(MATCH_KERNEL_HANDLE_KEY) || null;
    }

    getCurrentMatchKernelAdapter() {
        return this._getRuntimeHandle(MATCH_KERNEL_ADAPTER_HANDLE_KEY) || null;
    }

    getCurrentMatchKernelConsumers() {
        return this._getRuntimeHandle(MATCH_KERNEL_CONSUMERS_HANDLE_KEY) || null;
    }

    getCurrentMatchKernelConsumer(consumerId) {
        return this.getCurrentMatchKernelConsumers()?.getAdapter?.(consumerId) || null;
    }

    clearMatchSessionRefs() {
        if (!this.game || !this.runtimeBundle) return;
        this._disposeKernelAdapter();
        this._disposeKernelConsumers();
        this._disposeMatchKernel();
        clearMatchSessionState(this.runtimeBundle);
    }
}
