// ============================================
// RoundStateTickSystem.js - round/match-end tick orchestration
// ============================================

import { CONTINUE_INTENT_KEY } from '../shared/input/ContinueIntentOps.js';
import { deriveRoundEndCountdownUiState } from '../shared/contracts/MatchUiStateContract.js';
import {
    ROUND_END_INPUT_LOCK_PHASES,
    armRoundEndInputLock,
    createRoundEndInputLock,
    readLatchedContinuePress,
    readRoundEndInputLockState,
    releaseRoundEndInputLock,
} from './RoundEndInputLockOps.js';

export class RoundStateTickSystem {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this._readLifecyclePort = typeof deps.getLifecyclePort === 'function'
            ? deps.getLifecyclePort
            : () => deps.lifecyclePort || null;
        this._readRuntimeIntentPort = typeof deps.getRuntimeIntentPort === 'function'
            ? deps.getRuntimeIntentPort
            : () => deps.runtimeIntentPort || null;
        this._readSessionSnapshot = typeof deps.getSessionSnapshot === 'function'
            ? deps.getSessionSnapshot
            : () => deps.sessionSnapshot || null;
        this._arenaWavesTransitionRestartRequested = false;
        // Board lock for the controller path; the kernel keeps its own and reports it.
        this._inputLock = createRoundEndInputLock();
        this._continueBlocked = false;
        // Identity of the board the lock belongs to: a new match brings a new kernel,
        // a new round raises its roundIndex - both mean "a different board".
        this._lockKernel = null;
        this._lockRoundIndex = -1;
    }

    /**
     * Opening a board drops the pending "continue" press and starts the lock.
     * The session role is read once per board, not once per frame.
     */
    _syncInputLockPhase(phase) {
        const kernel = this._getKernelAdapter()?.kernel || null;
        const roundIndex = Number(kernel?.roundIndex) || 0;
        const sameBoard = this._inputLock.phase === phase
            && this._lockKernel === kernel
            && this._lockRoundIndex === roundIndex;
        if (sameBoard) return false;
        armRoundEndInputLock(this._inputLock, phase);
        this._lockKernel = kernel;
        this._lockRoundIndex = roundIndex;
        this._continueBlocked = this._isRemoteSessionClient();
        this.game?.input?.clearContinueIntent?.();
        return true;
    }

    /**
     * resetRoundEndInputLock – the board was closed. Called by the state dispatch on
     * every frame outside ROUND_END/MATCH_END, so exits that never reach a tick action
     * (overlay buttons, a host kick, an arcade run advance) also drop the lock.
     */
    resetRoundEndInputLock() {
        if (this._inputLock.phase === '' && this._lockKernel === null) return;
        releaseRoundEndInputLock(this._inputLock);
        this._lockKernel = null;
        this._lockRoundIndex = -1;
        this._continueBlocked = false;
    }

    /** Replicas never own the match: a client must not start a round or a match. */
    _isRemoteSessionClient() {
        const snapshot = this._readSessionSnapshot();
        return snapshot?.isNetworkSession === true && snapshot?.isHost !== true;
    }

    /** Lock snapshot for the result board: remaining seconds, full duration and board. */
    getRoundEndInputLockState() {
        return readRoundEndInputLockState(this._inputLock);
    }

    _applyStepInputLock(tickStep) {
        if (!tickStep || typeof tickStep.nextInputLockRemaining !== 'number') return;
        this._inputLock.remaining = Math.max(0, tickStep.nextInputLockRemaining);
        if (typeof tickStep.inputLockTotal === 'number' && tickStep.inputLockTotal > 0) {
            this._inputLock.total = tickStep.inputLockTotal;
        }
    }

    /**
     * The kernel reads the board keys itself, so a replica's veto has to reach it
     * before the tick: it then still consumes the keys, but acts on neither.
     */
    _tickKernelRoundStateWithInputPolicy(dt, expectedLifecycle) {
        this._getKernelAdapter()?.kernel?.setRoundStateContinueBlocked?.(this._continueBlocked);
        const kernelStep = this._tickKernelRoundState(dt, expectedLifecycle);
        if (kernelStep) {
            this._inputLock.remaining = Math.max(0, Number(kernelStep.inputLockRemaining) || 0);
            if (Number(kernelStep.inputLockTotal) > 0) {
                this._inputLock.total = Number(kernelStep.inputLockTotal);
            }
        }
        return kernelStep;
    }

    /**
     * One read per frame and key: the continue intent polls the gamepads while it is
     * asked. Enter runs through the same edge latch, so a held key neither piles up
     * during the lock nor fires on every frame afterwards.
     */
    _readBoardPress() {
        const enterRead = this.game.input.wasPressed('Enter') === true;
        const continueRead = this.game.input.wasPressed(CONTINUE_INTENT_KEY) === true;
        const boardPress = readLatchedContinuePress(this._inputLock, enterRead || continueRead)
            && !this._continueBlocked;
        return { continuePressed: boardPress, enterPressed: enterRead && boardPress };
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
            this.resetRoundEndInputLock();
            lifecyclePort?.returnToMenu?.({ reason: 'round_state_return_to_menu' });
            return true;
        }
        if (action === 'START_ROUND') {
            this.resetRoundEndInputLock();
            lifecyclePort?.restartRound?.();
            return true;
        }
        if (action === 'RESTART_MATCH') {
            this.resetRoundEndInputLock();
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
            ...this._readBoardPress(),
            escapePressed: game.input.wasPressed('Escape'),
            inputLockRemaining: this._inputLock.remaining,
        };
    }

    _readMatchEndTickInputs(dt = 0) {
        return {
            dt,
            ...this._readBoardPress(),
            escapePressed: this.game.input.wasPressed('Escape'),
            inputLockRemaining: this._inputLock.remaining,
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
        this._syncInputLockPhase(ROUND_END_INPUT_LOCK_PHASES.ROUND_END);
        // The kernel step reads Enter/Escape/Continue itself, so the keys are read here only
        // when no kernel step owns them; reading them first would leave the kernel an empty press.
        const arenaWavesRun = this._readArcadeSurfaceState()?.runType === 'arena_waves';
        if (!arenaWavesRun && !this.game.roundStateController?.isArcadeRoundStateController) {
            this._arenaWavesTransitionRestartRequested = false;
            const kernelStep = this._tickKernelRoundStateWithInputPolicy(dt, 'round_end');
            if (kernelStep) return kernelStep;
        }
        const inputs = this._readRoundEndTickInputs(dt);
        const arenaWavesStep = this._deriveArenaWavesRoundEndStep(inputs);
        if (arenaWavesStep) return arenaWavesStep;
        const tickStep = this.game.roundStateController.deriveRoundEndTick(inputs);
        this._applyStepInputLock(tickStep);
        return tickStep;
    }

    _deriveControllerMatchEndTickStep(dt) {
        const tickStep = this.game.roundStateController.deriveMatchEndTick(
            this._readMatchEndTickInputs(dt)
        );
        this._applyStepInputLock(tickStep);
        return tickStep;
    }

    _deriveMatchEndTickStep(dt) {
        this._syncInputLockPhase(ROUND_END_INPUT_LOCK_PHASES.MATCH_END);
        if (this.game.roundStateController?.isArcadeRoundStateController) {
            return this._deriveControllerMatchEndTickStep(dt);
        }
        return this._tickKernelRoundStateWithInputPolicy(dt, 'match_end')
            || this._deriveControllerMatchEndTickStep(dt);
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
