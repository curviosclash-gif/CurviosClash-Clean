import {
    MATCH_LIFECYCLE_CONTRACT_VERSION,
    MATCH_LIFECYCLE_EVENT_TYPES,
    SESSION_FINALIZE_TRIGGERS,
} from '../shared/contracts/MatchLifecycleContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import {
    applySessionRuntimeLifecycleTransition,
    ensureSessionRuntimeLifecycleState,
    SESSION_RUNTIME_STATES,
} from '../shared/contracts/SessionRuntimeStateMachine.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../shared/contracts/SessionRuntimeEventContract.js';
import {
    hasActiveMatchSessionRefs,
    mergeFinalizeRequest,
} from './MatchLifecycleFinalizeRequest.js';
import { createMatchSessionPort } from './MatchLifecycleSessionPort.js';
import {
    createFallbackSessionRuntimeState,
    readRuntimeStatePath,
    writeRuntimeStatePath,
} from './MatchLifecycleSessionRuntimeState.js';
import { completeSessionRuntimeMenuLifecycle } from './MatchLifecycleSessionTransitionSupport.js';

export { createMatchSessionPort } from './MatchLifecycleSessionPort.js';

export const MATCH_SESSION_PORT_METHODS = Object.freeze([
    'getSessionRuntimeState',
    'getLifecycleState',
    'notifyLifecycleEvent',
    'prepareInitializedMatchSession',
    'wireInitializedMatchRuntime',
    'applyInitializedMatchSession',
    'getCurrentMatchSessionRefs',
    'clearMatchSessionRefs',
    'disposePreparedMatchSession',
    'disposeCurrentMatchSession',
    'settleRecorder',
    'resetRoundRuntime',
]);

export class MatchLifecycleSessionOrchestrator {
    constructor(runtimeOrDeps = null) {
        const runtime = runtimeOrDeps?.runtime || runtimeOrDeps;
        this.deps = runtimeOrDeps?.prepareInitializedMatchSession
            ? runtimeOrDeps
            : createMatchSessionPort(runtime);
        if (this.deps && typeof this.deps === 'object') {
            for (const method of MATCH_SESSION_PORT_METHODS) {
                if (typeof this.deps[method] !== 'function') {
                    console?.warn?.(`[MatchLifecycleSessionOrchestrator] deps missing: ${method}`);
                }
            }
        }
        this._lifecycleContractVersion = MATCH_LIFECYCLE_CONTRACT_VERSION;
        this._sessionRuntimeState = this.deps?.getSessionRuntimeState?.() || createFallbackSessionRuntimeState();
        this._bindRuntimeField('_sessionSequence', ['session', 'sequence'], 0);
        this._bindRuntimeField('_activeSessionId', ['session', 'activeSessionId'], null);
        this._bindRuntimeField('_pendingSessionInit', ['lifecycle', 'pendingSessionInit'], null);
        this._bindRuntimeField('_pendingFinalize', ['finalize', 'pendingOperation'], null);
        this._pendingFinalizePlan = null;
        ensureSessionRuntimeLifecycleState(this._sessionRuntimeState);
        if (!this._sessionRuntimeState?.finalize?.status) {
            this._sessionRuntimeState.finalize.status = 'idle';
        }
    }

    _bindRuntimeField(fieldName, path, defaultValue) {
        if (readRuntimeStatePath(this._sessionRuntimeState, path) === undefined) {
            writeRuntimeStatePath(this._sessionRuntimeState, path, defaultValue);
        }
        Object.defineProperty(this, fieldName, {
            configurable: true,
            enumerable: false,
            get: () => readRuntimeStatePath(this._sessionRuntimeState, path),
            set: (value) => writeRuntimeStatePath(this._sessionRuntimeState, path, value),
        });
    }

    _recordRuntimeEvent(type, payload = null, extra = null, source = 'match_lifecycle_session_orchestrator') {
        this.deps?.recordRuntimeEvent?.(
            type,
            payload,
            source,
            extra && typeof extra === 'object' ? extra : null
        );
    }

    _setLifecycleStatus(status, options = undefined) {
        if (!this._sessionRuntimeState?.lifecycle || typeof status !== 'string' || !status.trim()) {
            return null;
        }
        const transition = applySessionRuntimeLifecycleTransition(this._sessionRuntimeState, status, options);
        if (transition?.changed) {
            this._recordRuntimeEvent(SESSION_RUNTIME_EVENT_TYPES.STATE_TRANSITIONED, {
                previousState: transition.currentState,
                nextState: transition.nextState,
                gameStateId: transition.lifecycle?.gameStateId || '',
                disposed: transition.lifecycle?.disposed === true,
            });
        }
        return transition;
    }

    _setFinalizeStatus(status, extra = null) {
        if (!this._sessionRuntimeState?.finalize || typeof status !== 'string' || !status.trim()) {
            return;
        }
        this._sessionRuntimeState.finalize.status = status;
        if (
            status !== 'error'
            && (!extra || typeof extra !== 'object' || !Object.prototype.hasOwnProperty.call(extra, 'errorMessage'))
        ) {
            this._sessionRuntimeState.finalize.errorMessage = null;
        }
        if (extra && typeof extra === 'object') {
            Object.assign(this._sessionRuntimeState.finalize, extra);
        }
        this._sessionRuntimeState.finalize.updatedAt = Date.now();
    }

    _buildLifecycleContext(extra = null) {
        const lifecycleState = this.deps?.getLifecycleState?.() || {};
        const context = {
            contractVersion: this._lifecycleContractVersion,
            sessionId: this._activeSessionId,
            mapKey: lifecycleState.mapKey || null,
            numHumans: Number(lifecycleState.numHumans) || 0,
            numBots: Number(lifecycleState.numBots) || 0,
            winsNeeded: Number(lifecycleState.winsNeeded) || 0,
            activeGameMode: lifecycleState.activeGameMode || null,
        };
        if (extra && typeof extra === 'object') {
            Object.assign(context, extra);
        }
        return context;
    }

    _emitLifecycleEvent(type, extra = null) {
        this.deps?.notifyLifecycleEvent?.(type, this._buildLifecycleContext(extra));
    }

    _startLifecycleSession(extra = null) {
        if (!this._activeSessionId) {
            this._sessionSequence += 1;
            this._activeSessionId = `match-${this._sessionSequence}`;
        }
        this._setLifecycleStatus(SESSION_RUNTIME_STATES.PLAYING);
        this._setFinalizeStatus('idle', {
            lastReason: null,
            lastTrigger: null,
            errorMessage: null,
        });
        this._recordRuntimeEvent(
            SESSION_RUNTIME_EVENT_TYPES.SESSION_INITIALIZED,
            {
                previousSessionId: extra?.previousSessionId || null,
                mapKey: extra?.mapKey || null,
                numHumans: Number(extra?.numHumans) || 0,
                numBots: Number(extra?.numBots) || 0,
                winsNeeded: Number(extra?.winsNeeded) || 0,
                activeGameMode: extra?.activeGameMode || null,
            },
            {
                sessionId: this._activeSessionId,
            }
        );
        this._emitLifecycleEvent(MATCH_LIFECYCLE_EVENT_TYPES.MATCH_STARTED, extra);
    }

    _endLifecycleSession(reason = 'match_teardown') {
        if (!this._activeSessionId) return;
        this._emitLifecycleEvent(MATCH_LIFECYCLE_EVENT_TYPES.MATCH_ENDED, { reason });
        this._activeSessionId = null;
    }

    notifyMenuOpened(extra = null) {
        completeSessionRuntimeMenuLifecycle(
            this._sessionRuntimeState,
            this._setLifecycleStatus.bind(this),
            SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED
        );
        this._recordRuntimeEvent(SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED, {
            reason: extra?.reason || '',
            targetView: 'main_menu',
        });
        this._emitLifecycleEvent(MATCH_LIFECYCLE_EVENT_TYPES.MENU_OPENED, extra);
    }

    _buildRecorderFinalizeTrigger(reason, context = undefined) {
        const normalizedReason = typeof reason === 'string' && reason.trim()
            ? reason.trim()
            : SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU;
        const normalizedContext = context && typeof context === 'object'
            ? { ...context }
            : {};
        if (!normalizedContext.reason) {
            normalizedContext.reason = normalizedReason;
        }
        return {
            type: normalizedReason,
            context: normalizedContext,
        };
    }

    _buildFinalizeRequest(options = undefined) {
        const request = typeof options === 'string'
            ? { reason: options }
            : (options && typeof options === 'object' ? options : {});
        const reason = typeof request.reason === 'string' && request.reason.trim()
            ? request.reason.trim()
            : SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU;
        return {
            reason,
            awaitPendingInit: request.awaitPendingInit !== false,
            notifyMenuOpened: request.notifyMenuOpened !== false,
            clearScene: request.clearScene !== false,
            recorderTrigger: request.recorderTrigger || this._buildRecorderFinalizeTrigger(
                reason,
                request.recorderContext
            ),
        };
    }

    _hasCurrentSessionRefs() {
        const currentSession = this.deps?.getCurrentMatchSessionRefs?.();
        // Menu bootstrap keeps a standalone particle system alive before the first
        // real match session exists. Particles alone must not trigger stale-session
        // finalization for a new match start.
        return hasActiveMatchSessionRefs(currentSession);
    }

    async _disposePreparedMatch(initializedMatch, reason = SESSION_FINALIZE_TRIGGERS.STALE_SESSION_INIT) {
        if (!initializedMatch) return;
        try {
            await Promise.resolve(this.deps?.disposePreparedMatchSession?.(initializedMatch, {
                reason,
                clearScene: true,
            }));
        } catch {
            // Best-effort cleanup for discarded async init results.
        }
    }

    async _applyInitializedMatch(initializedMatch, expectedSessionId, lifecycleHandlers = {}, previousSessionId = null) {
        if (expectedSessionId && this._activeSessionId !== expectedSessionId) {
            this._recordRuntimeEvent(
                SESSION_RUNTIME_EVENT_TYPES.SESSION_INIT_FAILED,
                {
                    reason: SESSION_FINALIZE_TRIGGERS.STALE_SESSION_INIT,
                    previousSessionId,
                },
                {
                    sessionId: expectedSessionId,
                }
            );
            await this._disposePreparedMatch(initializedMatch, SESSION_FINALIZE_TRIGGERS.STALE_SESSION_INIT);
            return null;
        }

        const wiredMatch = await Promise.resolve(
            this.deps?.wireInitializedMatchRuntime?.(initializedMatch, lifecycleHandlers) || initializedMatch
        );
        if (expectedSessionId && this._activeSessionId !== expectedSessionId) {
            this._recordRuntimeEvent(
                SESSION_RUNTIME_EVENT_TYPES.SESSION_INIT_FAILED,
                {
                    reason: SESSION_FINALIZE_TRIGGERS.STALE_SESSION_INIT,
                    previousSessionId,
                },
                {
                    sessionId: expectedSessionId,
                }
            );
            await this._disposePreparedMatch(wiredMatch, SESSION_FINALIZE_TRIGGERS.STALE_SESSION_INIT);
            return null;
        }

        try {
            this.deps?.applyInitializedMatchSession?.(wiredMatch);
        } catch (applyError) {
            await this._disposePreparedMatch(wiredMatch, SESSION_FINALIZE_TRIGGERS.APPLY_FAILED);
            throw applyError;
        }
        const lifecycleState = this.deps?.getLifecycleState?.() || {};
        this._startLifecycleSession({
            previousSessionId,
            mapKey: wiredMatch?.session?.effectiveMapKey || lifecycleState.mapKey || null,
            numHumans: wiredMatch?.session?.numHumans || lifecycleState.numHumans || 0,
            numBots: wiredMatch?.session?.numBots || lifecycleState.numBots || 0,
            winsNeeded: wiredMatch?.session?.winsNeeded || lifecycleState.winsNeeded || 0,
        });
        return wiredMatch;
    }

    _assertCanStartAfterFinalize(shouldStartAfterFinalize) {
        if (!shouldStartAfterFinalize) {
            return;
        }
        const completedReason = typeof this._sessionRuntimeState?.finalize?.lastCompletedReason === 'string'
            ? this._sessionRuntimeState.finalize.lastCompletedReason.trim()
            : '';
        if (!completedReason || completedReason === SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION) {
            return;
        }
        const startBlockedError = new Error(`match_start_blocked:${completedReason}`);
        startBlockedError.code = 'MATCH_START_BLOCKED';
        throw startBlockedError;
    }

    createMatchSession({ onPlayerFeedback, onPlayerDied, onRoundEnd } = {}) {
        if (!this.deps?.prepareInitializedMatchSession) {
            throw new Error('MatchLifecycleSessionOrchestrator requires runtime context');
        }
        const shouldStartAfterFinalize = !!(
            this._pendingFinalize
            || this._activeSessionId
            || this._hasCurrentSessionRefs()
        );
        const finalizeExistingSession = this._pendingFinalize
            ? Promise.resolve(this._pendingFinalize)
            : (
                this._activeSessionId || this._hasCurrentSessionRefs()
                    ? Promise.resolve(this.finalizeMatchSession({
                        reason: SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION,
                        notifyMenuOpened: false,
                        awaitPendingInit: false,
                    }))
                    : null
            );

        const previousSessionId = this._activeSessionId;
        this._sessionSequence += 1;
        const provisionalId = `match-${this._sessionSequence}`;
        this._activeSessionId = provisionalId;
        this._setLifecycleStatus(SESSION_RUNTIME_STATES.STARTING);
        this._setFinalizeStatus('idle', {
            lastReason: null,
            lastTrigger: null,
            errorMessage: null,
        });
        const lifecycleHandlers = {
            onPlayerFeedback,
            onPlayerDied,
            onRoundEnd,
        };

        const runPendingInit = () => Promise.resolve(finalizeExistingSession)
            .then(() => {
                this._assertCanStartAfterFinalize(shouldStartAfterFinalize);
                return this.deps.prepareInitializedMatchSession(lifecycleHandlers);
            })
            .then((resolvedMatch) => this._applyInitializedMatch(
                resolvedMatch,
                provisionalId,
                lifecycleHandlers,
                previousSessionId
            ));

        const queuedInit = this._pendingSessionInit
            ? Promise.resolve(this._pendingSessionInit).catch(() => null).then(runPendingInit)
            : runPendingInit();

        const trackedInit = Promise.resolve(queuedInit)
            .catch((error) => {
                if (this._activeSessionId === provisionalId) {
                    this._activeSessionId = null;
                }
                this.deps?.clearMatchSessionRefs?.();
                this._setLifecycleStatus(
                    this._sessionRuntimeState?.lifecycle?.disposed ? SESSION_RUNTIME_STATES.DISPOSED : SESSION_RUNTIME_STATES.MENU,
                    { gameStateId: GAME_STATE_IDS.MENU }
                );
                this._recordRuntimeEvent(
                    SESSION_RUNTIME_EVENT_TYPES.SESSION_INIT_FAILED,
                    {
                        reason: error instanceof Error ? error.message : 'session_init_failed',
                        previousSessionId,
                    },
                    {
                        sessionId: provisionalId,
                    }
                );
                throw error;
            })
            .finally(() => {
                if (this._pendingSessionInit === trackedInit) {
                    this._pendingSessionInit = null;
                }
            });
        this._pendingSessionInit = trackedInit;
        return trackedInit;
    }

    bindHuntEventHandlers({ onHuntFeedEvent, onHuntDamageEvent } = {}) {
        const entityManager = this.deps?.getCurrentMatchSessionRefs?.()?.entityManager || null;
        if (!entityManager) return;
        entityManager.onHuntFeedEvent = typeof onHuntFeedEvent === 'function' ? onHuntFeedEvent : null;
        entityManager.onHuntDamageEvent = typeof onHuntDamageEvent === 'function' ? onHuntDamageEvent : null;
    }

    resetRoundRuntime() {
        this.deps?.resetRoundRuntime?.();
    }

    finalizeRound() {
        this.deps?.settleRecorder?.(this._buildRecorderFinalizeTrigger(SESSION_FINALIZE_TRIGGERS.ROUND_FINALIZE));
        this.deps?.resetRoundRuntime?.();
    }

    async finalizeMatchSession(options = undefined) {
        const request = this._buildFinalizeRequest(options);
        if (this._pendingFinalize) {
            this._pendingFinalizePlan = mergeFinalizeRequest(this._pendingFinalizePlan, request);
            this._setFinalizeStatus('finalizing', {
                lastReason: this._pendingFinalizePlan?.reason || request.reason,
                lastTrigger: this._pendingFinalizePlan?.recorderTrigger?.type || request.recorderTrigger?.type || request.reason,
            });
            return this._pendingFinalize;
        }
        this._pendingFinalizePlan = request;
        const finalizedSessionId = this._activeSessionId;
        this._setFinalizeStatus('finalizing', {
            lastReason: request.reason,
            lastTrigger: request.recorderTrigger?.type || request.reason,
        });
        this._setLifecycleStatus(SESSION_RUNTIME_STATES.FINALIZING);
        const resolveActiveRequest = () => this._pendingFinalizePlan || request;
        const trackedFinalize = (async () => {
            let activeRequest = resolveActiveRequest();
            this._endLifecycleSession(activeRequest.reason);
            if (this._activeSessionId === finalizedSessionId) {
                this._activeSessionId = null;
            }
            if (activeRequest.awaitPendingInit && this._pendingSessionInit) {
                await Promise.resolve(this._pendingSessionInit).catch(() => null);
            }

            let finalizeError = null;
            try {
                activeRequest = resolveActiveRequest();
                await Promise.resolve(this.deps?.settleRecorder?.(activeRequest.recorderTrigger));
            } catch (error) {
                finalizeError = error;
            }

            try {
                activeRequest = resolveActiveRequest();
                this.deps?.disposeCurrentMatchSession?.({
                    reason: activeRequest.reason,
                    clearScene: activeRequest.clearScene,
                });
            } catch (error) {
                if (!finalizeError) {
                    finalizeError = error;
                }
            }

            try {
                this.deps?.clearMatchSessionRefs?.();
            } catch (error) {
                if (!finalizeError) {
                    finalizeError = error;
                }
            }

            if (finalizeError) {
                throw finalizeError;
            }

            activeRequest = resolveActiveRequest();
            this._setFinalizeStatus('finalized', {
                lastReason: activeRequest.reason,
                lastTrigger: activeRequest.recorderTrigger?.type || activeRequest.reason,
                lastCompletedReason: activeRequest.reason,
            });
            this._recordRuntimeEvent(
                SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED,
                {
                    reason: activeRequest.reason,
                    notifyMenuOpened: activeRequest.notifyMenuOpened === true,
                    clearScene: activeRequest.clearScene === true,
                },
                {
                    sessionId: finalizedSessionId,
                }
            );
            if (activeRequest.notifyMenuOpened) {
                this.notifyMenuOpened({ reason: activeRequest.reason });
            } else {
                completeSessionRuntimeMenuLifecycle(
                    this._sessionRuntimeState,
                    this._setLifecycleStatus.bind(this),
                    SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED
                );
            }
            return activeRequest.reason;
        })().catch((error) => {
            const failedRequest = resolveActiveRequest();
            this._setFinalizeStatus('error', {
                lastReason: failedRequest.reason,
                lastTrigger: failedRequest.recorderTrigger?.type || failedRequest.reason,
                errorMessage: error instanceof Error ? error.message : 'match_finalize_failed',
            });
            this._recordRuntimeEvent(
                SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZE_FAILED,
                {
                    reason: failedRequest.reason,
                    errorMessage: error instanceof Error ? error.message : 'match_finalize_failed',
                },
                {
                    sessionId: finalizedSessionId,
                }
            );
            throw error;
        }).finally(() => {
            if (this._pendingFinalize === trackedFinalize) {
                this._pendingFinalize = null;
                this._pendingFinalizePlan = null;
            }
        });
        this._pendingFinalize = trackedFinalize;
        return trackedFinalize;
    }

    async teardownMatchSession(options = undefined) {
        return this.finalizeMatchSession(options);
    }
}
