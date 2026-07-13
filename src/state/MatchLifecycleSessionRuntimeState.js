import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { SESSION_RUNTIME_STATES } from '../shared/contracts/SessionRuntimeStateMachine.js';

export function createFallbackSessionRuntimeState() {
    return {
        session: {
            sequence: 0,
            activeSessionId: null,
        },
        finalize: {
            status: 'idle',
            pendingOperation: null,
            lastReason: null,
            lastTrigger: null,
            lastCompletedReason: null,
            errorMessage: null,
            updatedAt: Date.now(),
        },
        lifecycle: {
            gameStateId: GAME_STATE_IDS.MENU,
            disposed: false,
            pendingSessionInit: null,
            status: SESSION_RUNTIME_STATES.MENU,
            updatedAt: Date.now(),
        },
        observability: {
            sequence: 0,
            events: [],
            lastEventType: '',
            updatedAt: Date.now(),
        },
    };
}

export function readRuntimeStatePath(source, path = []) {
    let cursor = source;
    for (const segment of path) {
        if (!cursor || typeof cursor !== 'object') {
            return undefined;
        }
        cursor = cursor[segment];
    }
    return cursor;
}

export function writeRuntimeStatePath(source, path = [], value) {
    if (!source || typeof source !== 'object' || !Array.isArray(path) || path.length === 0) {
        return;
    }
    let cursor = source;
    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index];
        if (!cursor[segment] || typeof cursor[segment] !== 'object') {
            cursor[segment] = {};
        }
        cursor = cursor[segment];
    }
    cursor[path[path.length - 1]] = value;
}
