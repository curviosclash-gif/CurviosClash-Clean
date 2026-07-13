import { SNAPSHOT_NOOP } from './MenuMultiplayerBridgeCas.js';

const MULTIPLAYER_MAX_PLAYERS = 10;

function snapshotHasPeer(snapshot, peerId, normalizeString) {
    const normalizedPeerId = normalizeString(peerId, '');
    if (!normalizedPeerId || !Array.isArray(snapshot?.members)) return false;
    return snapshot.members.some((member) => normalizeString(member?.peerId, '') === normalizedPeerId);
}

export function hostMultiplayerLobby(bridge, options, helpers) {
    const actorId = helpers.normalizeString(options.actorId, 'host');
    const requestedLobbyCode = helpers.normalizeLobbyCode(
        options.lobbyCode,
        helpers.generateLobbyCode(bridge._now, bridge._random)
    );
    if (bridge._activeLobbyCode && bridge._activeLobbyCode !== requestedLobbyCode) {
        bridge.leave({ silent: true });
    }

    let hostConflict = false;
    const persistedSnapshot = bridge._updateActiveSnapshot((existingSnapshot) => {
        const existingHostPeerId = helpers.normalizeString(existingSnapshot?.hostPeerId, '');
        const hostStillPresent = existingHostPeerId
            && snapshotHasPeer(existingSnapshot, existingHostPeerId, helpers.normalizeString);
        if (hostStillPresent && existingHostPeerId !== bridge._peerId) {
            hostConflict = true;
            return SNAPSHOT_NOOP;
        }

        const now = bridge._now();
        const preservedMembers = Array.isArray(existingSnapshot?.members)
            ? existingSnapshot.members
                .filter((member) => member.peerId !== bridge._peerId)
                .map((member) => ({
                    ...member,
                    role: 'client',
                    ready: false,
                    lastSeenAt: now,
                }))
            : [];
        return {
            schemaVersion: helpers.sessionSchemaVersion,
            lobbyCode: requestedLobbyCode,
            hostPeerId: bridge._peerId,
            hostActorId: actorId,
            revision: Math.max(0, Math.floor(Number(existingSnapshot?.revision) || 0)),
            updatedAt: now,
            members: [
                {
                    peerId: bridge._peerId,
                    actorId,
                    role: 'host',
                    ready: false,
                    joinedAt: now,
                    lastSeenAt: now,
                },
                ...preservedMembers,
            ],
            hostSettingsSnapshot: helpers.deepClone(existingSnapshot?.hostSettingsSnapshot),
            pendingMatchStart: null,
        };
    }, 'host', {
        lobbyCode: requestedLobbyCode,
    });
    if (hostConflict) {
        return bridge._fail(`Lobby bereits aktiv: ${requestedLobbyCode}`, 'lobby_taken');
    }
    if (!persistedSnapshot || helpers.normalizeString(persistedSnapshot.hostPeerId, '') !== bridge._peerId) {
        return bridge._fail(`Lobby konnte nicht persistent erstellt werden: ${requestedLobbyCode}`, 'lobby_persist_failed');
    }
    bridge._setStatus(`Lobby erstellt: ${requestedLobbyCode}`);
    const event = bridge._emit(helpers.eventTypes.HOST, {
        actorId,
        lobbyCode: requestedLobbyCode,
        mode: 'host',
        peerId: bridge._peerId,
    });
    return {
        ok: true,
        lobbyCode: requestedLobbyCode,
        event,
        sessionState: bridge.getSessionState(),
        snapshot: helpers.deepClone(persistedSnapshot),
    };
}

export function joinMultiplayerLobby(bridge, options, helpers) {
    const actorId = helpers.normalizeString(options.actorId, 'player');
    const requestedLobbyCode = helpers.normalizeLobbyCode(options.lobbyCode, '');
    if (!requestedLobbyCode) {
        return bridge._fail('Lobby-Code fehlt.', 'missing_lobby_code');
    }
    if (bridge._activeLobbyCode && bridge._activeLobbyCode !== requestedLobbyCode) {
        bridge.leave({ silent: true });
    }

    let lobbyMissing = false;
    let lobbyFull = false;
    let hostUnavailable = false;
    const persistedSnapshot = bridge._updateActiveSnapshot((existingSnapshot) => {
        if (!existingSnapshot?.hostPeerId) {
            lobbyMissing = true;
            return SNAPSHOT_NOOP;
        }
        const hostAvailable = snapshotHasPeer(existingSnapshot, existingSnapshot.hostPeerId, helpers.normalizeString);
        if (!hostAvailable) {
            hostUnavailable = true;
            return SNAPSHOT_NOOP;
        }

        const now = bridge._now();
        const existingMembers = Array.isArray(existingSnapshot.members) ? existingSnapshot.members : [];
        const existingLocalMember = existingMembers.find((member) => member.peerId === bridge._peerId);
        if (!existingLocalMember && existingMembers.length >= MULTIPLAYER_MAX_PLAYERS) {
            lobbyFull = true;
            return SNAPSHOT_NOOP;
        }
        return {
            ...existingSnapshot,
            members: [
                ...existingMembers.filter((member) => member.peerId !== bridge._peerId),
                {
                    peerId: bridge._peerId,
                    actorId,
                    role: existingSnapshot.hostPeerId === bridge._peerId ? 'host' : 'client',
                    ready: false,
                    joinedAt: existingLocalMember?.joinedAt || now,
                    lastSeenAt: now,
                },
            ],
        };
    }, 'join', {
        lobbyCode: requestedLobbyCode,
    });
    if (lobbyMissing) {
        return bridge._fail(`Lobby nicht gefunden: ${requestedLobbyCode}`, 'lobby_not_found');
    }
    if (lobbyFull) {
        return bridge._fail(`Lobby ist voll (max. ${MULTIPLAYER_MAX_PLAYERS} Spieler).`, 'lobby_full');
    }
    if (hostUnavailable) {
        return bridge._fail(`Lobby hat aktuell keinen aktiven Host: ${requestedLobbyCode}`, 'host_unavailable');
    }
    if (!persistedSnapshot) {
        return bridge._fail(`Lobby nicht verfuegbar: ${requestedLobbyCode}`, 'lobby_not_found');
    }
    if (!snapshotHasPeer(persistedSnapshot, bridge._peerId, helpers.normalizeString)) {
        return bridge._fail(`Lobby konnte nicht persistent beigetreten werden: ${requestedLobbyCode}`, 'join_persist_failed');
    }

    bridge._setStatus(`Lobby beigetreten: ${requestedLobbyCode}`);
    const event = bridge._emit(helpers.eventTypes.JOIN, {
        actorId,
        lobbyCode: requestedLobbyCode,
        mode: 'join',
        peerId: bridge._peerId,
    });
    return {
        ok: true,
        lobbyCode: requestedLobbyCode,
        event,
        sessionState: bridge.getSessionState(),
        snapshot: helpers.deepClone(persistedSnapshot),
    };
}

export function toggleReadyMultiplayerLobby(bridge, options, helpers) {
    if (!bridge._activeLobbyCode) {
        return bridge._fail('Noch keiner Lobby beigetreten.', 'not_in_lobby');
    }

    let currentActorId = helpers.normalizeString(options.actorId, 'player');
    let ready = false;
    let failureCode = '';
    let failureMessage = '';
    const persistedSnapshot = bridge._updateActiveSnapshot((existingSnapshot) => {
        if (!existingSnapshot) {
            failureCode = 'lobby_not_found';
            failureMessage = 'Lobby nicht mehr verfuegbar.';
            return SNAPSHOT_NOOP;
        }

        const localMember = existingSnapshot.members.find((member) => member.peerId === bridge._peerId);
        if (!localMember) {
            failureCode = 'not_in_lobby';
            failureMessage = 'Noch keiner Lobby beigetreten.';
            return SNAPSHOT_NOOP;
        }

        currentActorId = helpers.normalizeString(options.actorId, localMember.actorId || 'player');
        ready = typeof options.ready === 'boolean' ? options.ready : !localMember.ready;
        return {
            ...existingSnapshot,
            members: existingSnapshot.members.map((member) => (
                member.peerId === bridge._peerId
                    ? {
                        ...member,
                        actorId: currentActorId,
                        ready,
                        lastSeenAt: bridge._now(),
                    }
                    : member
            )),
        };
    }, 'ready_toggle');
    if (failureCode) {
        return bridge._fail(failureMessage, failureCode);
    }
    bridge._setStatus(ready ? 'Ready gesetzt' : 'Ready entfernt');
    const event = bridge._emit(helpers.eventTypes.READY_TOGGLE, {
        actorId: currentActorId,
        ready,
        lobbyCode: bridge._activeLobbyCode,
        peerId: bridge._peerId,
    });
    return {
        ok: true,
        ready,
        event,
        sessionState: bridge.getSessionState(),
        snapshot: helpers.deepClone(persistedSnapshot),
    };
}

export function invalidateMultiplayerReadyForAll(bridge, reason, helpers) {
    if (!bridge._activeLobbyCode) return null;
    let shouldEmit = false;
    const persistedSnapshot = bridge._updateActiveSnapshot((existingSnapshot) => {
        if (!existingSnapshot || existingSnapshot.hostPeerId !== bridge._peerId) return SNAPSHOT_NOOP;
        const hadReady = existingSnapshot.members.some((member) => member.ready === true);
        if (!hadReady) return SNAPSHOT_NOOP;
        shouldEmit = true;
        return {
            ...existingSnapshot,
            members: existingSnapshot.members.map((member) => ({
                ...member,
                ready: false,
                lastSeenAt: member.peerId === bridge._peerId ? bridge._now() : member.lastSeenAt,
            })),
        };
    }, 'ready_invalidated');
    if (!shouldEmit || !persistedSnapshot) return null;
    bridge._setStatus('Ready-Status zurueckgesetzt (Host-Aenderung)');
    const event = bridge._emit(helpers.eventTypes.READY_INVALIDATED, {
        reason: helpers.normalizeString(reason, 'host_settings_changed'),
        lobbyCode: bridge._activeLobbyCode,
        peerId: bridge._peerId,
    });
    return {
        ok: true,
        event,
        sessionState: bridge.getSessionState(),
        snapshot: helpers.deepClone(persistedSnapshot),
    };
}

export function publishMultiplayerHostSettings(bridge, settingsSnapshot, helpers) {
    if (!bridge._activeLobbyCode) return null;
    return bridge._updateActiveSnapshot((existingSnapshot) => {
        if (!existingSnapshot || existingSnapshot.hostPeerId !== bridge._peerId) return SNAPSHOT_NOOP;
        return {
            ...existingSnapshot,
            hostActorId: existingSnapshot.hostActorId,
            hostSettingsSnapshot: helpers.deepClone(settingsSnapshot),
        };
    }, 'host_settings_sync');
}

export function requestMultiplayerMatchStart(bridge, options, helpers) {
    if (!bridge._activeLobbyCode) {
        return bridge._fail('Lobby fehlt.', 'not_in_lobby');
    }
    let commandId = '';
    let participantCount = 0;
    let failureCode = '';
    let failureMessage = '';
    const persistedSnapshot = bridge._updateActiveSnapshot((existingSnapshot) => {
        if (!existingSnapshot) {
            failureCode = 'lobby_not_found';
            failureMessage = 'Lobby nicht mehr verfuegbar.';
            return SNAPSHOT_NOOP;
        }
        const sessionState = helpers.deriveSessionState(existingSnapshot, bridge._peerId);
        if (!sessionState.isHost) {
            failureCode = 'host_required';
            failureMessage = 'Nur der Host kann starten.';
            return SNAPSHOT_NOOP;
        }
        if (sessionState.memberCount < 2) {
            failureCode = 'not_enough_members';
            failureMessage = 'Mindestens zwei Teilnehmer werden benoetigt.';
            return SNAPSHOT_NOOP;
        }
        if (!sessionState.allReady) {
            failureCode = 'members_not_ready';
            failureMessage = 'Alle Teilnehmer muessen Ready sein.';
            return SNAPSHOT_NOOP;
        }

        commandId = `match-${helpers.buildRuntimeId(bridge._now, bridge._random, 5)}`;
        participantCount = sessionState.memberCount;
        const command = {
            commandId,
            lobbyCode: bridge._activeLobbyCode,
            hostPeerId: bridge._peerId,
            issuedAt: bridge._now(),
            settingsSnapshot: helpers.deepClone(options.settingsSnapshot),
        };
        return {
            ...existingSnapshot,
            hostSettingsSnapshot: helpers.deepClone(options.settingsSnapshot),
            pendingMatchStart: command,
        };
    }, 'match_start');
    if (failureCode) {
        return bridge._fail(failureMessage, failureCode);
    }
    if (!persistedSnapshot || !commandId) {
        return bridge._fail('Match-Start konnte nicht persistiert werden.', 'match_start_conflict');
    }
    bridge._schedulePendingMatchCommandClear(bridge._activeLobbyCode, commandId);
    bridge._setStatus(`Match-Start an Lobby gesendet: ${bridge._activeLobbyCode}`);
    const event = bridge._emit(helpers.eventTypes.MATCH_START, {
        lobbyCode: bridge._activeLobbyCode,
        commandId,
        participantCount,
        peerId: bridge._peerId,
    });
    return {
        ok: true,
        commandId,
        event,
        sessionState: bridge.getSessionState(),
        snapshot: helpers.deepClone(persistedSnapshot),
    };
}
