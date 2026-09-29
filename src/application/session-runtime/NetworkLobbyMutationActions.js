import { LOBBY_SERVICE_EVENT_TYPES } from '../../shared/contracts/LobbyServiceContract.js';
import { deepClone, normalizeString } from './NetworkLobbyServiceSupport.js';

export async function toggleNetworkLobbyReady(service, options = {}) {
    const sessionState = service.getSessionState();
    if (!service._transportSession.hasLobby() || !sessionState.joined) {
        return service._fail('Noch keiner Lobby beigetreten.', 'not_in_lobby');
    }
    if (sessionState.isHost) {
        return { ok: true, event: null, sessionState, snapshot: service.getSnapshot() };
    }
    if (service._readyMutationPending) {
        return service._fail('Bereitschaft wird bereits aktualisiert.', 'ready_pending');
    }

    const requestedReady = typeof options.ready === 'boolean' ? options.ready : !sessionState.localReady;
    service._readyMutationPending = true;
    service.onStateChanged?.(service.getSessionState());
    try {
        await service._transportSession.setReady(requestedReady);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Bereitschaft konnte nicht gesetzt werden.';
        return service._fail(message, normalizeString(error?.code, 'ready_failed'));
    } finally {
        service._readyMutationPending = false;
        service.onStateChanged?.(service.getSessionState());
    }

    const updatedSessionState = service.getSessionState();
    const event = service._emit(LOBBY_SERVICE_EVENT_TYPES.READY_TOGGLE, {
        actorId: normalizeString(options.actorId, service._actorId || 'Spieler'),
        lobbyCode: updatedSessionState.lobbyCode,
        ready: requestedReady,
        peerId: updatedSessionState.peerId,
    });
    service._setStatus(requestedReady ? 'Du bist bereit.' : 'Du bist nicht mehr bereit.');
    return { ok: true, event, sessionState: service.getSessionState(), snapshot: service.getSnapshot() };
}

export async function setNetworkLobbyName(service, lobbyName) {
    if (!service._transportSession.hasLobby() || !service.getSessionState().joined) {
        return service._fail('Noch keiner Lobby beigetreten.', 'not_in_lobby');
    }
    try {
        await service._transportSession.setLobbyName(lobbyName);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Name konnte nicht gesetzt werden.';
        return service._fail(message, normalizeString(error?.code, 'lobby_name_failed'));
    }
    service.onStateChanged?.(service.getSessionState());
    return { ok: true, sessionState: service.getSessionState(), snapshot: service.getSnapshot() };
}

export function requestNetworkLobbyMatchStart(service, options = {}) {
    const sessionState = service.getSessionState();
    if (!service._transportSession.hasLobby() || !sessionState.joined) {
        return service._fail('Lobby fehlt.', 'not_in_lobby');
    }
    if (!sessionState.isHost) return service._fail('Nur der Host kann starten.', 'host_required');
    if (service._matchStartPending || sessionState.pendingMatchCommandId) {
        return service._fail('Match wird bereits gestartet.', 'match_start_pending');
    }
    if (sessionState.settingsSyncPending || sessionState.settingsSyncError) {
        return service._fail('Match-Einstellungen müssen zuerst übertragen werden.', 'settings_sync_pending');
    }
    if (sessionState.settingsRevision != null && options.settingsSnapshot
        && JSON.stringify(options.settingsSnapshot) !== JSON.stringify(service._hostSettingsSnapshot)) {
        void service.publishHostSettings(options.settingsSnapshot);
        return service._fail('Match-Einstellungen werden übertragen. Danach müssen alle erneut bereit sein.', 'settings_sync_pending');
    }
    if (sessionState.memberCount < 2) {
        return service._fail('Mindestens zwei Teilnehmer werden benötigt.', 'not_enough_members');
    }
    if (!sessionState.allReady) {
        return service._fail('Alle Teilnehmer müssen bereit sein.', 'members_not_ready');
    }
    const settingsSnapshot = deepClone(options.settingsSnapshot ?? service._hostSettingsSnapshot);
    service._matchStartPending = true;
    service.onStateChanged?.(service.getSessionState());
    return Promise.resolve(service._transportSession.startMatch({ settingsSnapshot, settingsRevision: sessionState.settingsRevision })).then((response) => {
        const updatedSessionState = service.getSessionState();
        const commandId = normalizeString(
            response?.pendingMatchStart?.commandId || response?.sessionState?.pendingMatchStart?.commandId,
            ''
        );
        const event = service._emit(LOBBY_SERVICE_EVENT_TYPES.MATCH_START, {
            lobbyCode: updatedSessionState.lobbyCode,
            commandId,
            participantCount: updatedSessionState.memberCount,
            peerId: updatedSessionState.peerId,
        });
        service._setStatus(`Match-Start an Lobby gesendet: ${updatedSessionState.lobbyCode}`);
        return { ok: true, commandId, event, sessionState: service.getSessionState(), snapshot: service.getSnapshot() };
    }).catch((error) => service._fail(
        error instanceof Error ? error.message : 'Lobby-Start konnte nicht ausgeliefert werden.',
        normalizeString(error?.code, 'match_start_failed')
    )).finally(() => {
        service._matchStartPending = false;
        service.onStateChanged?.(service.getSessionState());
    });
}

export function invalidateNetworkLobbyReadyForAll(service, reason = 'host_settings_changed') {
    const sessionState = service.getSessionState();
    if (!service._transportSession.hasLobby() || !sessionState.isHost) return null;
    return Promise.resolve(service._transportSession.invalidateReadyForAll()).then(() => {
        const updatedSessionState = service.getSessionState();
        const event = service._emit(LOBBY_SERVICE_EVENT_TYPES.READY_INVALIDATED, {
            reason: normalizeString(reason, 'host_settings_changed'),
            lobbyCode: updatedSessionState.lobbyCode,
            peerId: updatedSessionState.peerId,
        });
        service._setStatus('Bereitschaft zurückgesetzt, weil der Host etwas geändert hat');
        return {
            ok: true,
            event,
            sessionState: service.getSessionState(),
            snapshot: service.getSnapshot(),
        };
    }).catch((error) => service._fail(
        error instanceof Error ? error.message : 'Bereitschaft konnte nicht zurückgesetzt werden.',
        normalizeString(error?.code, 'ready_invalidation_failed')
    ));
}

/**
 * Reports the last started match as over, once, and only from the host. The
 * server keeps the start command until then, so without this report the lobby
 * refuses joins, settings changes and every further match start.
 */
export function reportNetworkLobbyMatchEnded(service) {
    const commandId = normalizeString(service._lastNotifiedMatchCommandId, '');
    if (!commandId || commandId === service._lastEndedMatchCommandId) return null;
    if (!service._transportSession.hasLobby() || service.getSessionState().isHost !== true) return null;
    service._lastEndedMatchCommandId = commandId;
    return Promise.resolve(service._transportSession.endMatch(commandId)).then(() => ({
        ok: true,
        commandId,
        sessionState: service.getSessionState(),
    })).catch((error) => {
        // Allow the next finalize to try again instead of leaving the lobby locked.
        if (service._lastEndedMatchCommandId === commandId) service._lastEndedMatchCommandId = '';
        return service._fail(
            error instanceof Error ? error.message : 'Matchende konnte nicht an die Lobby gemeldet werden.',
            normalizeString(error?.code, 'match_end_failed')
        );
    });
}
