import { createLogger } from '../../shared/logging/Logger.js';
import { SESSION_FINALIZE_TRIGGERS } from '../../shared/contracts/MatchLifecycleContract.js';
import { MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES } from '../../shared/contracts/MultiplayerSessionContract.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import { recordSessionRuntimeEvent } from '../../shared/runtime/SessionRuntimeObservability.js';

const logger = createLogger('MatchFinalizeFlowService');

function buildFinalizeMatchFlowPlan(options = undefined, fallbackReason = SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU) {
    const request = options && typeof options === 'object' ? options : {};
    const reason = typeof request.reason === 'string' && request.reason.trim()
        ? request.reason.trim()
        : fallbackReason;
    return {
        reason,
        clearLastRoundGhost: request.clearLastRoundGhost !== false,
        teardownRuntimeSession: request.teardownRuntimeSession !== false,
        clearPlayerSources: request.clearPlayerSources !== false,
        clearNetworkScoreboard: request.clearNetworkScoreboard !== false,
        resetArcadeRunState: request.resetArcadeRunState !== false,
        applyReturnToMenuUi: request.applyReturnToMenuUi !== false,
        schedulePrewarm: request.schedulePrewarm !== false,
        notifyMenuOpened: request.notifyMenuOpened !== false,
        sessionOptions: {
            reason,
            notifyMenuOpened: request.notifyMenuOpened !== false,
            clearScene: request.clearScene !== false,
            awaitPendingInit: request.awaitPendingInit !== false,
        },
        uiOptions: {
            ...request,
            reason,
        },
    };
}

function mergeFinalizeMatchFlowPlan(currentPlan, nextPlan) {
    if (!currentPlan) return nextPlan;
    if (!nextPlan) return currentPlan;
    const shouldPromoteReason = nextPlan.reason === SESSION_FINALIZE_TRIGGERS.GAME_DISPOSE
        || nextPlan.reason === SESSION_FINALIZE_TRIGGERS.WINDOW_SHUTDOWN;
    return {
        ...currentPlan,
        reason: shouldPromoteReason ? nextPlan.reason : currentPlan.reason,
        applyReturnToMenuUi: currentPlan.applyReturnToMenuUi && nextPlan.applyReturnToMenuUi,
        schedulePrewarm: currentPlan.schedulePrewarm && nextPlan.schedulePrewarm,
        notifyMenuOpened: currentPlan.notifyMenuOpened && nextPlan.notifyMenuOpened,
    };
}

function observeFinalizeFlow(facade, phase, plan, extra = null) {
    recordSessionRuntimeEvent(facade?.getRuntimeBundle?.() || facade?.game, {
        type: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZING,
        source: 'match_finalize_flow_service',
        payload: {
            phase,
            reason: plan?.reason || '',
            trigger: plan?.sessionOptions?.reason || plan?.reason || '',
            applyReturnToMenuUi: plan?.applyReturnToMenuUi === true,
            schedulePrewarm: plan?.schedulePrewarm === true,
            notifyMenuOpened: plan?.notifyMenuOpened === true,
            ...(extra && typeof extra === 'object' ? extra : {}),
        },
    });
}

export function finalizeMatchFlow(facade, options = undefined, fallbackReason = SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU) {
    const requestedPlan = buildFinalizeMatchFlowPlan(options, fallbackReason);
    if (facade?._pendingMatchFinalize) {
        facade._pendingMatchFinalizePlan = mergeFinalizeMatchFlowPlan(
            facade._pendingMatchFinalizePlan,
            requestedPlan
        );
        observeFinalizeFlow(facade, 'merged', facade._pendingMatchFinalizePlan, {
            pending: true,
        });
        return facade._pendingMatchFinalize;
    }

    facade._pendingMatchFinalizePlan = requestedPlan;
    observeFinalizeFlow(facade, 'requested', requestedPlan);
    if (requestedPlan.clearLastRoundGhost) {
        facade?.ports?.sessionPort?.clearLastRoundGhost?.();
    }
    if (requestedPlan.teardownRuntimeSession) {
        // Host broadcasts MATCH_FINALIZED to all connected peers before tearing
        // down the session.  Clients react via their MultiplayerMatchLifecycleKernel
        // and trigger their own finalizing -> match_finalized -> menu_opened path.
        const session = facade?.session;
        if (session?.isHost && session?.isConnected) {
            try {
                session.broadcastLifecycleSignal?.(
                    MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED,
                    { reason: requestedPlan.reason }
                );
            } catch {
                // Best-effort: signal delivery is not guaranteed; teardown proceeds.
            }
        }
        facade?.teardownRuntimeSession?.();
    }
    if (requestedPlan.clearPlayerSources) {
        facade?.ports?.inputPort?.clearPlayerSources?.();
    }
    if (requestedPlan.clearNetworkScoreboard) {
        facade?.game?.hudRuntimeSystem?.clearNetworkScoreboard?.();
    }
    if (requestedPlan.resetArcadeRunState) {
        facade?._resetArcadeRunState?.();
    }

    const sessionFinalizePromise = (() => {
        try {
            return Promise.resolve(
                facade?.ports?.sessionPort?.finalizeMatchSession?.(requestedPlan.sessionOptions)
                    ?? facade?.ports?.sessionPort?.teardownMatchSession?.(requestedPlan.sessionOptions)
            );
        } catch (error) {
            return Promise.reject(error);
        }
    })();

    const trackedFinalize = Promise.resolve(sessionFinalizePromise)
        .catch((error) => {
            logger.error('finalizeMatchFlow session finalize failed:', error);
            return false;
        })
        .then((sessionFinalizeOk) => {
            const activePlan = facade?._pendingMatchFinalizePlan || requestedPlan;
            if (sessionFinalizeOk === false) {
                return false;
            }
            try {
                if (activePlan.applyReturnToMenuUi) {
                    facade?.ports?.matchUiPort?.applyReturnToMenuUi?.(activePlan.uiOptions);
                }
                if (activePlan.schedulePrewarm) {
                    facade?.scheduleMatchPrewarm?.();
                }
            } catch (error) {
                logger.error('finalizeMatchFlow cleanup failed:', error);
                return false;
            }
            return sessionFinalizeOk !== false;
        })
        .finally(() => {
            if (facade?._pendingMatchFinalize === trackedFinalize) {
                facade._pendingMatchFinalize = null;
                facade._pendingMatchFinalizePlan = null;
            }
        });
    facade._pendingMatchFinalize = trackedFinalize;
    return trackedFinalize;
}
