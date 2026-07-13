import {
    createIdleSessionState,
    deepClone,
    deriveSessionState,
    normalizeSessionSnapshot,
    normalizeString,
    toTimestamp,
} from './StorageLobbyServiceSupport.js';

const MATCH_START_MAX_AGE_MS = 12000;

export function createStorageLobbySessionStateProjection(options = {}) {
    const peerId = normalizeString(options.peerId, '');
    const now = typeof options.now === 'function' ? options.now : Date.now;
    let activeLobbyCode = '';
    let sessionSnapshot = null;
    let sessionState = createIdleSessionState(peerId);
    let lastHandledMatchCommandId = '';

    function getSessionState() {
        return deepClone(sessionState) || createIdleSessionState(peerId, activeLobbyCode);
    }

    function shouldHandleMatchStartCommand(command) {
        if (!sessionState.joined) return false;
        const commandId = normalizeString(command?.commandId, '');
        if (!commandId || commandId === lastHandledMatchCommandId) return false;
        const issuedAt = toTimestamp(command?.issuedAt, 0);
        if (issuedAt <= 0) return false;
        return (now() - issuedAt) <= MATCH_START_MAX_AGE_MS;
    }

    function syncSnapshot(snapshot, syncOptions = {}) {
        const nextSnapshot = snapshot ? normalizeSessionSnapshot(snapshot, now()) : null;
        const previousLobbyCode = activeLobbyCode;

        sessionSnapshot = nextSnapshot;
        activeLobbyCode = nextSnapshot?.lobbyCode || '';
        sessionState = deriveSessionState(nextSnapshot, peerId);

        if (sessionState.joined) {
            options.startHeartbeat?.();
        } else {
            options.stopHeartbeat?.();
            if (!nextSnapshot && previousLobbyCode && syncOptions.preserveLobbyCode === true) {
                sessionState = createIdleSessionState(peerId, previousLobbyCode);
            }
        }

        options.onStateChanged?.(getSessionState());

        const pendingMatchStart = nextSnapshot?.pendingMatchStart || null;
        if (pendingMatchStart && shouldHandleMatchStartCommand(pendingMatchStart)) {
            lastHandledMatchCommandId = pendingMatchStart.commandId;
            options.onMatchStart?.(deepClone(pendingMatchStart), getSessionState());
        }
    }

    return Object.freeze({
        syncSnapshot,
        getActiveLobbyCode: () => activeLobbyCode,
        getSessionState,
        getSnapshot: () => deepClone(sessionSnapshot),
    });
}
