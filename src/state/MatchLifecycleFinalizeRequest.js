import { SESSION_FINALIZE_TRIGGERS } from '../shared/contracts/MatchLifecycleContract.js';

export function hasActiveMatchSessionRefs(currentSession) {
    return !!(
        currentSession?.arena
        || currentSession?.entityManager
        || currentSession?.powerupManager
    );
}

function shouldPromoteFinalizeReason(currentReason, nextReason) {
    if (nextReason === SESSION_FINALIZE_TRIGGERS.GAME_DISPOSE || nextReason === SESSION_FINALIZE_TRIGGERS.WINDOW_SHUTDOWN) {
        return true;
    }
    return currentReason === SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION && nextReason !== SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION;
}

export function mergeFinalizeRequest(currentRequest, nextRequest) {
    if (!currentRequest) return nextRequest;
    if (!nextRequest) return currentRequest;
    const currentReason = currentRequest.reason || SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU;
    const nextReason = nextRequest.reason || currentReason;
    const promoteReason = shouldPromoteFinalizeReason(currentReason, nextReason);
    const mergedReason = promoteReason ? nextReason : currentReason;
    const currentRecorderContext = currentRequest.recorderTrigger?.context && typeof currentRequest.recorderTrigger.context === 'object'
        ? currentRequest.recorderTrigger.context
        : {};
    const nextRecorderContext = nextRequest.recorderTrigger?.context && typeof nextRequest.recorderTrigger.context === 'object'
        ? nextRequest.recorderTrigger.context
        : {};
    return {
        ...currentRequest,
        reason: mergedReason,
        awaitPendingInit: currentRequest.awaitPendingInit || nextRequest.awaitPendingInit,
        notifyMenuOpened: currentRequest.notifyMenuOpened || nextRequest.notifyMenuOpened,
        clearScene: currentRequest.clearScene || nextRequest.clearScene,
        recorderTrigger: {
            type: promoteReason
                ? (nextRequest.recorderTrigger?.type || nextReason)
                : (currentRequest.recorderTrigger?.type || currentReason),
            context: {
                ...currentRecorderContext,
                ...nextRecorderContext,
                reason: mergedReason,
            },
        },
    };
}
