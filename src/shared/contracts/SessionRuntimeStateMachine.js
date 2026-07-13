import { GAME_STATE_IDS, normalizeGameStateId } from './GameStateIds.js';
import { SESSION_RUNTIME_EVENT_TYPES } from './SessionRuntimeEventContract.js';

export const SESSION_RUNTIME_STATE_MACHINE_VERSION = 'session-runtime-state-machine.v2';

export const SESSION_RUNTIME_STATES = Object.freeze({
    MENU: 'menu',
    STARTING: 'starting',
    PLAYING: 'playing',
    PAUSED: 'paused',
    ROUND_END: 'round_end',
    MATCH_END: 'match_end',
    FINALIZING: 'finalizing',
    DISPOSED: 'disposed',
});

const VALID_SESSION_RUNTIME_STATE_SET = new Set(Object.values(SESSION_RUNTIME_STATES));

const GAME_STATE_TO_RUNTIME_STATE = Object.freeze({
    [GAME_STATE_IDS.MENU]: SESSION_RUNTIME_STATES.MENU,
    [GAME_STATE_IDS.PLAYING]: SESSION_RUNTIME_STATES.PLAYING,
    [GAME_STATE_IDS.PAUSED]: SESSION_RUNTIME_STATES.PAUSED,
    [GAME_STATE_IDS.ROUND_END]: SESSION_RUNTIME_STATES.ROUND_END,
    [GAME_STATE_IDS.MATCH_END]: SESSION_RUNTIME_STATES.MATCH_END,
});

const ALLOWED_SESSION_RUNTIME_TRANSITIONS = Object.freeze({
    [SESSION_RUNTIME_STATES.MENU]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.STARTING,
        SESSION_RUNTIME_STATES.PLAYING,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.STARTING]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.STARTING,
        SESSION_RUNTIME_STATES.PLAYING,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.PLAYING]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.PLAYING,
        SESSION_RUNTIME_STATES.PAUSED,
        SESSION_RUNTIME_STATES.ROUND_END,
        SESSION_RUNTIME_STATES.MATCH_END,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.PAUSED]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.PLAYING,
        SESSION_RUNTIME_STATES.PAUSED,
        SESSION_RUNTIME_STATES.ROUND_END,
        SESSION_RUNTIME_STATES.MATCH_END,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.ROUND_END]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.PLAYING,
        SESSION_RUNTIME_STATES.ROUND_END,
        SESSION_RUNTIME_STATES.MATCH_END,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.MATCH_END]: Object.freeze([
        SESSION_RUNTIME_STATES.MENU,
        SESSION_RUNTIME_STATES.MATCH_END,
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.FINALIZING]: Object.freeze([
        SESSION_RUNTIME_STATES.FINALIZING,
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
    [SESSION_RUNTIME_STATES.DISPOSED]: Object.freeze([
        SESSION_RUNTIME_STATES.DISPOSED,
    ]),
});

const FINALIZING_MENU_COMPLETION_EVENT_TYPE_SET = new Set([
    SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED,
    SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED,
]);

function normalizeSessionRuntimeCompletionEventType(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isFinalizingMenuTransition(currentState, nextState) {
    return currentState === SESSION_RUNTIME_STATES.FINALIZING
        && nextState === SESSION_RUNTIME_STATES.MENU;
}

function canCompleteFinalizingMenuTransition(sessionRuntime, currentState, nextState, options = undefined) {
    if (!isFinalizingMenuTransition(currentState, nextState)) {
        return false;
    }
    const completionEventType = normalizeSessionRuntimeCompletionEventType(options?.completionEventType);
    const finalizeStatus = typeof sessionRuntime?.finalize?.status === 'string'
        ? sessionRuntime.finalize.status.trim().toLowerCase()
        : '';
    return finalizeStatus === 'finalized'
        && FINALIZING_MENU_COMPLETION_EVENT_TYPE_SET.has(completionEventType);
}

export function normalizeSessionRuntimeState(value, fallback = SESSION_RUNTIME_STATES.MENU) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VALID_SESSION_RUNTIME_STATE_SET.has(normalized)
        ? normalized
        : fallback;
}

export function deriveSessionRuntimeStateFromGameStateId(gameStateId, fallback = SESSION_RUNTIME_STATES.MENU) {
    const normalizedGameStateId = normalizeGameStateId(gameStateId, GAME_STATE_IDS.MENU);
    return GAME_STATE_TO_RUNTIME_STATE[normalizedGameStateId]
        || normalizeSessionRuntimeState(fallback, SESSION_RUNTIME_STATES.MENU);
}

export function canTransitionSessionRuntimeState(currentState, nextState) {
    const normalizedCurrentState = normalizeSessionRuntimeState(currentState, SESSION_RUNTIME_STATES.MENU);
    const normalizedNextState = normalizeSessionRuntimeState(nextState, normalizedCurrentState);
    const allowedTransitions = ALLOWED_SESSION_RUNTIME_TRANSITIONS[normalizedCurrentState];
    return Array.isArray(allowedTransitions) && allowedTransitions.includes(normalizedNextState);
}

export function ensureSessionRuntimeLifecycleState(sessionRuntime) {
    const lifecycle = sessionRuntime?.lifecycle;
    if (!lifecycle || typeof lifecycle !== 'object') {
        return null;
    }

    lifecycle.machineVersion = SESSION_RUNTIME_STATE_MACHINE_VERSION;
    lifecycle.disposed = lifecycle.disposed === true;
    lifecycle.gameStateId = normalizeGameStateId(lifecycle.gameStateId, GAME_STATE_IDS.MENU);
    lifecycle.status = lifecycle.disposed
        ? SESSION_RUNTIME_STATES.DISPOSED
        : normalizeSessionRuntimeState(
            lifecycle.status,
            deriveSessionRuntimeStateFromGameStateId(lifecycle.gameStateId, SESSION_RUNTIME_STATES.MENU)
        );
    lifecycle.updatedAt = Number.isFinite(lifecycle.updatedAt) ? lifecycle.updatedAt : Date.now();
    return lifecycle;
}

export function applySessionRuntimeLifecycleTransition(sessionRuntime, nextState, options = {}) {
    const lifecycle = ensureSessionRuntimeLifecycleState(sessionRuntime);
    if (!lifecycle) {
        return null;
    }

    const currentState = normalizeSessionRuntimeState(lifecycle.status, SESSION_RUNTIME_STATES.MENU);
    const requestedNextState = normalizeSessionRuntimeState(nextState, currentState);
    const shouldDispose = lifecycle.disposed || requestedNextState === SESSION_RUNTIME_STATES.DISPOSED || options?.disposed === true;
    const normalizedNextState = shouldDispose ? SESSION_RUNTIME_STATES.DISPOSED : requestedNextState;
    const allowFinalizeCompletion = canCompleteFinalizingMenuTransition(
        sessionRuntime,
        currentState,
        normalizedNextState,
        options
    );

    if (!shouldDispose && isFinalizingMenuTransition(currentState, normalizedNextState) && !allowFinalizeCompletion) {
        return {
            changed: false,
            currentState,
            nextState: currentState,
            lifecycle,
        };
    }

    if (
        !shouldDispose
        && options?.allowFromAny !== true
        && !allowFinalizeCompletion
        && !canTransitionSessionRuntimeState(currentState, normalizedNextState)
    ) {
        return {
            changed: false,
            currentState,
            nextState: currentState,
            lifecycle,
        };
    }

    if (shouldDispose) {
        lifecycle.disposed = true;
    }
    if (options?.gameStateId !== undefined) {
        lifecycle.gameStateId = normalizeGameStateId(options.gameStateId, lifecycle.gameStateId);
    }
    lifecycle.status = normalizedNextState;
    lifecycle.updatedAt = Date.now();

    return {
        changed: currentState !== lifecycle.status,
        currentState,
        nextState: lifecycle.status,
        lifecycle,
    };
}

export function syncSessionRuntimeLifecycleWithGameState(sessionRuntime, gameStateId) {
    const lifecycle = ensureSessionRuntimeLifecycleState(sessionRuntime);
    if (!lifecycle || lifecycle.disposed) {
        return null;
    }
    const normalizedGameStateId = normalizeGameStateId(gameStateId, lifecycle.gameStateId);
    return applySessionRuntimeLifecycleTransition(
        sessionRuntime,
        deriveSessionRuntimeStateFromGameStateId(normalizedGameStateId, lifecycle.status),
        { gameStateId: normalizedGameStateId }
    );
}

export function syncSessionRuntimeLifecycleDisposed(sessionRuntime, disposed = true) {
    const lifecycle = ensureSessionRuntimeLifecycleState(sessionRuntime);
    if (!lifecycle) {
        return null;
    }
    if (lifecycle.disposed && disposed !== true) {
        return {
            changed: false,
            currentState: SESSION_RUNTIME_STATES.DISPOSED,
            nextState: SESSION_RUNTIME_STATES.DISPOSED,
            lifecycle,
        };
    }
    return applySessionRuntimeLifecycleTransition(
        sessionRuntime,
        disposed ? SESSION_RUNTIME_STATES.DISPOSED : lifecycle.status,
        {
            disposed: disposed === true,
            allowFromAny: disposed === true,
        }
    );
}
