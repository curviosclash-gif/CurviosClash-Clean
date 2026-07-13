import { GAME_STATE_IDS } from '../contracts/GameStateIds.js';

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeNullableString(value) {
    const normalized = normalizeString(value, '');
    return normalized || null;
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : 0;
}

function resolveUiIntentError(error, handleError) {
    if (typeof handleError !== 'function') {
        throw error;
    }
    return handleError(error);
}

function normalizePauseOverlayIntentLease(source = null, intentType = '') {
    const payload = source && typeof source === 'object' ? source : {};
    const lifecycleState = normalizeString(payload.lifecycleState, 'unknown');
    return {
        intentType: normalizeString(intentType || payload.intentType, ''),
        sessionId: normalizeNullableString(payload.sessionId),
        updatedAt: normalizeTimestamp(payload.updatedAt),
        isPaused: payload.isPaused === true && lifecycleState !== 'disposed',
        canReturnToMenu: payload.canReturnToMenu === true,
        lifecycleState,
        finalizeState: normalizeString(payload.finalizeState, 'idle'),
    };
}

function matchesPauseOverlayLeaseSession(currentSnapshot, leaseSnapshot) {
    if (currentSnapshot.sessionId || leaseSnapshot.sessionId) {
        return currentSnapshot.sessionId === leaseSnapshot.sessionId;
    }
    return true;
}

function canUsePauseOverlaySnapshot(snapshot, intentType) {
    if (snapshot.isPaused !== true) {
        return false;
    }
    if (snapshot.finalizeState === 'finalizing' || snapshot.finalizeState === 'error') {
        return false;
    }
    if (intentType === PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU && snapshot.canReturnToMenu !== true) {
        return false;
    }
    return true;
}

export const PAUSE_OVERLAY_INTENT_TYPES = Object.freeze({
    RESUME_MATCH: 'resume_match',
    RETURN_TO_MENU: 'return_to_menu',
});

export function createDeferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    promise.catch(() => {});
    return { promise, resolve, reject };
}

export function executeAtomicUiIntent(options = {}) {
    const currentPromise = options.currentPromise || null;
    if (currentPromise) {
        return currentPromise;
    }
    const deferred = createDeferred();
    options.assignPendingPromise?.(deferred.promise);
    const clearPending = () => {
        options.clearPendingPromise?.(deferred.promise);
    };
    try {
        const intentResult = options.execute?.();
        if (intentResult && typeof intentResult.then === 'function') {
            Promise.resolve(intentResult)
                .then((resolvedResult) => {
                    clearPending();
                    deferred.resolve(resolvedResult);
                })
                .catch((error) => {
                    clearPending();
                    try {
                        deferred.resolve(resolveUiIntentError(error, options.handleError));
                    } catch (handledError) {
                        deferred.reject(handledError);
                    }
                })
            return deferred.promise;
        }
        deferred.resolve(intentResult);
        clearPending();
        return intentResult;
    } catch (error) {
        try {
            const handledResult = resolveUiIntentError(error, options.handleError);
            deferred.resolve(handledResult);
            clearPending();
            return handledResult;
        } catch (handledError) {
            deferred.reject(handledError);
            clearPending();
            throw handledError;
        }
    }
}

export function createPauseOverlayIntentSnapshot(matchFlowSnapshot = null, gameStateId = '') {
    if (matchFlowSnapshot) {
        return matchFlowSnapshot;
    }
    return {
        sessionId: null,
        updatedAt: 0,
        isPaused: gameStateId === GAME_STATE_IDS.PAUSED,
        canReturnToMenu: gameStateId !== GAME_STATE_IDS.MENU,
        lifecycleState: gameStateId || 'unknown',
        finalizeState: 'idle',
    };
}

export function createPauseOverlayIntentLease(snapshot = null, intentType = '') {
    const normalizedLease = normalizePauseOverlayIntentLease(snapshot, intentType);
    if (!normalizedLease.intentType) {
        return null;
    }
    if (!canUsePauseOverlaySnapshot(normalizedLease, normalizedLease.intentType)) {
        return null;
    }
    return Object.freeze(normalizedLease);
}

export function capturePauseOverlayIntentLease(matchFlowSnapshot = null, gameStateId = '', intentType = '') {
    return createPauseOverlayIntentLease(
        createPauseOverlayIntentSnapshot(matchFlowSnapshot, gameStateId),
        intentType
    );
}

export function canExecutePauseOverlayIntent(snapshot = null, lease = null, intentType = '') {
    const normalizedIntentType = normalizeString(intentType || lease?.intentType, '');
    if (!normalizedIntentType) {
        return false;
    }
    const currentSnapshot = normalizePauseOverlayIntentLease(snapshot, normalizedIntentType);
    if (!canUsePauseOverlaySnapshot(currentSnapshot, normalizedIntentType)) {
        return false;
    }
    if (!lease) {
        return true;
    }
    const normalizedLease = normalizePauseOverlayIntentLease(lease, normalizedIntentType);
    if (!canUsePauseOverlaySnapshot(normalizedLease, normalizedIntentType)) {
        return false;
    }
    if (!matchesPauseOverlayLeaseSession(currentSnapshot, normalizedLease)) {
        return false;
    }
    return currentSnapshot.updatedAt === normalizedLease.updatedAt;
}

export function canExecutePauseOverlayIntentFromSource(matchFlowSnapshot = null, gameStateId = '', lease = null, intentType = '') {
    return canExecutePauseOverlayIntent(
        createPauseOverlayIntentSnapshot(matchFlowSnapshot, gameStateId),
        lease,
        intentType
    );
}
