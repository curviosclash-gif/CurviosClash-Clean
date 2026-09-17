// ============================================
// RoundStateTickSystem.js - round/match-end tick orchestration
// ============================================

import { deriveRoundEndCountdownUiState } from '../shared/contracts/MatchUiStateContract.js';

export class RoundStateTickSystem {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this._readLifecyclePort = typeof deps.getLifecyclePort === 'function'
            ? deps.getLifecyclePort
            : () => deps.lifecyclePort || null;
        this._readRuntimeIntentPort = typeof deps.getRuntimeIntentPort === 'function'
            ? deps.getRuntimeIntentPort
            : () => deps.runtimeIntentPort || null;
        this._arenaWavesTransitionRestartRequested = false;
    }

    _getKernelAdapter() {
        return this.game?.playingStateSystem?.getKernelAdapter?.()
            || this.game?.matchSessionRuntimeBridge?.getCurrentMatchKernelAdapter?.()
            || null;
    }

    /**
     * _syncKernelMatchEndLifecycle – the session factory can only signal round end: the
     * match-end decision is derived afterwards by the round state controller. This state
     * is the first place that knows the match is over, so it hands that over to the kernel.
     */
    _syncKernelMatchEndLifecycle(kernel) {
        if (kernel.lifecycle !== 'running' && kernel.lifecycle !== 'round_end') return;
        kernel.signalMatchEnd?.();
    }

    _tickKernelRoundState(dt, expectedLifecycle) {
        const kernelAdapter = this._getKernelAdapter();
        const kernel = kernelAdapter?.kernel || null;
        if (!kernelAdapter || !kernel) return null;
        if (kernel.lifecycle !== expectedLifecycle) {
            if (expectedLifecycle !== 'match_end') return null;
            this._syncKernelMatchEndLifecycle(kernel);
            if (kernel.lifecycle !== expectedLifecycle) return null;
        }
        const renderFrameId = this.game?.gameLoop?.renderFrameId || 0;
        return kernelAdapter.tick(dt, renderFrameId);
    }

    _executeRoundStateTickAction(action) {
        const game = this.game;
        const lifecyclePort = this._readLifecyclePort();
        if (action === 'RETURN_TO_MENU') {
            lifecyclePort?.returnToMenu?.({ reason: 'round_state_return_to_menu' });
            return true;
        }
        if (action === 'START_ROUND') {
            lifecyclePort?.restartRound?.();
            return true;
        }
        if (action === 'RESTART_MATCH') {
            const runtimeIntentPort = this._readRuntimeIntentPort();
            if (runtimeIntentPort) {
                if (typeof runtimeIntentPort.startMatch !== 'function') return false;
                runtimeIntentPort.startMatch({ source: 'round_state_restart_match' });
                return true;
            }
            game.startMatch?.();
            return true;
        }
        return false;
    }

    _readRoundEndTickInputs(dt) {
        const game = this.game;
        return {
            dt,
            roundPause: game.roundPause,
            enterPressed: game.input.wasPressed('Enter'),
            escapePressed: game.input.wasPressed('Escape'),
        };
    }

    _readMatchEndTickInputs() {
        const game = this.game;
        return {
            enterPressed: game.input.wasPressed('Enter'),
            escapePressed: game.input.wasPressed('Escape'),
        };
    }

    _readArcadeSurfaceState() {
        return this.game?.runtimeCoordinator?.getArcadeMenuSurfaceState?.() || null;
    }

    _deriveArenaWavesRoundEndStep(inputs) {
        const surface = this._readArcadeSurfaceState();
        if (surface?.runType !== 'arena_waves') return null;
        const phase = surface.phase;
        // Death on maps 1-4 opens the upgrade choice; the round-end countdown must wait
        // through it (and the finished screen) instead of restarting the old arena.
        if (phase === 'upgrade' || phase === 'finished') {
            this._arenaWavesTransitionRestartRequested = false;
            if (inputs.escapePressed) {
                return { action: 'RETURN_TO_MENU', nextRoundPause: inputs.roundPause,
                    shouldUpdateCameras: false, countdownMessageSub: null };
            }
            return { action: 'WAIT', nextRoundPause: inputs.roundPause,
                shouldUpdateCameras: true, countdownMessageSub: null };
        }
        // Selection advanced the run: consume the pending map transition immediately.
        if (phase === 'transition') {
            if (this._arenaWavesTransitionRestartRequested) {
                return { action: 'WAIT', nextRoundPause: inputs.roundPause,
                    shouldUpdateCameras: true, countdownMessageSub: null };
            }
            this._arenaWavesTransitionRestartRequested = true;
            return { action: 'START_ROUND', nextRoundPause: 0,
                shouldUpdateCameras: true, countdownMessageSub: null };
        }
        this._arenaWavesTransitionRestartRequested = false;
        return null;
    }

    _deriveRoundEndTickStep(dt) {
        // The kernel step reads Enter/Escape itself, so the keys are read here only when no
        // kernel step owns them; reading them first would leave the kernel an empty press.
        const arenaWavesRun = this._readArcadeSurfaceState()?.runType === 'arena_waves';
        if (!arenaWavesRun && !this.game.roundStateController?.isArcadeRoundStateController) {
            this._arenaWavesTransitionRestartRequested = false;
            const kernelStep = this._tickKernelRoundState(dt, 'round_end');
            if (kernelStep) return kernelStep;
        }
        const inputs = this._readRoundEndTickInputs(dt);
        const arenaWavesStep = this._deriveArenaWavesRoundEndStep(inputs);
        if (arenaWavesStep) return arenaWavesStep;
        return this.game.roundStateController.deriveRoundEndTick(inputs);
    }

    _deriveMatchEndTickStep() {
        if (this.game.roundStateController?.isArcadeRoundStateController) {
            return this.game.roundStateController.deriveMatchEndTick(this._readMatchEndTickInputs());
        }
        return this._tickKernelRoundState(0, 'match_end')
            || this.game.roundStateController.deriveMatchEndTick(this._readMatchEndTickInputs());
    }

    _applyRoundEndTickUi(roundEndTick) {
        if (!roundEndTick.countdownMessageSub) return;
        this.game.matchFlowUiController.applyMatchUiState(
            deriveRoundEndCountdownUiState(this.game.roundPause)
        );
    }

    _applyRoundEndTickMutableState(roundEndTick) {
        this.game.roundPause = roundEndTick.nextRoundPause;
        this._applyRoundEndTickUi(roundEndTick);
    }

    _updateRoundStateCamerasIfNeeded(dt, shouldUpdateCameras) {
        if (!shouldUpdateCameras) return;
        this.game.entityManager.updateCameras(dt);
    }

    _updateRoundStateGhostPlayback(dt) {
        this.game.entityManager?.updateLastRoundGhostPlayback?.(dt);
    }

    _runRoundStateTickStepCore(tickStep, dt, hooks = {}) {
        if (typeof hooks.beforeBase === 'function') {
            const shouldStop = hooks.beforeBase(tickStep);
            if (shouldStop) return true;
        }
        if (tickStep.action === 'RETURN_TO_MENU' && this._executeRoundStateTickAction(tickStep.action)) {
            return true;
        }
        this._updateRoundStateCamerasIfNeeded(dt, tickStep.shouldUpdateCameras);
        this._updateRoundStateGhostPlayback(dt);
        if (typeof hooks.afterBase === 'function') {
            const shouldStop = hooks.afterBase(tickStep);
            if (shouldStop) return true;
        }
        return false;
    }

    _applyRoundEndTickStep(roundEndTick, dt) {
        this._applyRoundEndTickMutableState(roundEndTick);
        return this._runRoundStateTickStepCore(roundEndTick, dt, {
            afterBase: (tickStep) => {
                this._executeRoundStateTickAction(tickStep.action);
                return false;
            },
        });
    }

    _applyMatchEndTickStep(matchEndTick, dt) {
        return this._runRoundStateTickStepCore(matchEndTick, dt, {
            beforeBase: (tickStep) => {
                if (tickStep.action === 'RESTART_MATCH') {
                    this._executeRoundStateTickAction(tickStep.action);
                }
                return false;
            },
        });
    }

    _runRoundStateTickUpdate(dt, deriveTickStep, applyTickStep) {
        const tickStep = deriveTickStep.call(this, dt);
        return !!applyTickStep.call(this, tickStep, dt);
    }

    _buildRoundEndStateTickDescriptor() {
        return {
            deriveTickStep: this._deriveRoundEndTickStep,
            applyTickStep: this._applyRoundEndTickStep,
        };
    }

    _buildMatchEndStateTickDescriptor() {
        return {
            deriveTickStep: this._deriveMatchEndTickStep,
            applyTickStep: this._applyMatchEndTickStep,
        };
    }

    _runRoundStateTickDescriptor(dt, descriptor) {
        if (!descriptor) return false;
        return this._runRoundStateTickUpdate(dt, descriptor.deriveTickStep, descriptor.applyTickStep);
    }

    updateRoundEnd(dt) {
        const descriptor = this._buildRoundEndStateTickDescriptor();
        this._runRoundStateTickDescriptor(dt, descriptor);
    }

    updateMatchEnd(dt) {
        const descriptor = this._buildMatchEndStateTickDescriptor();
        this._runRoundStateTickDescriptor(dt, descriptor);
    }
}
