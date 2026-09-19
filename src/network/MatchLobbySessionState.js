import { MULTIPLAYER_SESSION_ROLES } from '../shared/contracts/RuntimeSessionContract.js';
import { normalizeString } from '../shared/contracts/ContractNormalizeUtils.js';
import { normalizePublicLobbyMetadata } from '../shared/contracts/SignalingSessionContract.js';
import { normalizeOptionalMultiplayerPlayerName } from '../shared/contracts/MultiplayerSessionContract.js';
import { normalizeTeamId } from '../shared/contracts/TeamCombatContract.js';

function normalizeBoolean(value) {
    return value === true;
}

function toNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.floor(parsed));
}

export function normalizeLobbyMember(member, fallbackRole = MULTIPLAYER_SESSION_ROLES.CLIENT) {
    const peerId = normalizeString(member?.peerId || member?.id);
    if (!peerId) return null;
    const role = normalizeString(member?.role, fallbackRole) === MULTIPLAYER_SESSION_ROLES.HOST
        ? MULTIPLAYER_SESSION_ROLES.HOST
        : MULTIPLAYER_SESSION_ROLES.CLIENT;
    return {
        peerId,
        id: peerId,
        actorId: normalizeString(member?.actorId || member?.name, role === MULTIPLAYER_SESSION_ROLES.HOST ? 'Host' : peerId),
        name: normalizeString(member?.name || member?.actorId, role === MULTIPLAYER_SESSION_ROLES.HOST ? 'Host' : peerId),
        lobbyName: normalizeOptionalMultiplayerPlayerName(member?.lobbyName),
        teamId: normalizeTeamId(member?.teamId),
        role,
        isHost: role === MULTIPLAYER_SESSION_ROLES.HOST,
        ready: normalizeBoolean(member?.ready),
        joinedAt: toNonNegativeInt(member?.joinedAt, 0),
        lastSeenAt: toNonNegativeInt(member?.lastSeenAt, 0),
    };
}

export function normalizeLobbySessionState(state = {}) {
    const lobbyCode = normalizeString(state?.lobbyCode || state?.code, '');
    const hostPeerId = normalizeString(state?.hostPeerId || state?.hostId, '');
    const members = Array.isArray(state?.members)
        ? state.members
        : (Array.isArray(state?.players) ? state.players : []);

    const normalizedMembers = members
        .map((member) => normalizeLobbyMember(
            member,
            member?.peerId === hostPeerId ? MULTIPLAYER_SESSION_ROLES.HOST : MULTIPLAYER_SESSION_ROLES.CLIENT
        ))
        .filter(Boolean)
        .map((member) => ({
            ...member,
            role: member.peerId === hostPeerId ? MULTIPLAYER_SESSION_ROLES.HOST : member.role,
            isHost: member.peerId === hostPeerId,
        }))
        .sort((left, right) => {
            if (left.isHost !== right.isHost) return left.isHost ? -1 : 1;
            if (left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
            return left.peerId.localeCompare(right.peerId);
        });

    const readyCount = normalizedMembers.filter((member) => member.ready).length;
    const memberCount = normalizedMembers.length;
    return {
        lobbyCode,
        hostPeerId: hostPeerId || normalizeString(normalizedMembers[0]?.peerId, ''),
        memberCount,
        readyCount,
        allReady: memberCount > 0 && readyCount === memberCount,
        maxPlayers: toNonNegativeInt(state?.maxPlayers, 10) || 10,
        revision: toNonNegativeInt(state?.revision, 0),
        settingsRevision: Number.isSafeInteger(state?.settingsRevision) ? state.settingsRevision : null,
        metadata: state?.metadata ? normalizePublicLobbyMetadata(state.metadata) : null,
        members: normalizedMembers,
        players: normalizedMembers.map((member) => ({
            id: member.peerId,
            name: member.name,
            isHost: member.isHost,
            ready: member.ready,
            teamId: member.teamId,
        })),
        pendingMatchStart: state?.pendingMatchStart && typeof state.pendingMatchStart === 'object'
            ? { ...state.pendingMatchStart }
            : null,
        updatedAt: toNonNegativeInt(state?.updatedAt, 0),
    };
}

export function createInitialLobbySessionState() {
    return normalizeLobbySessionState({
        lobbyCode: '',
        hostPeerId: '',
        members: [],
        maxPlayers: 10,
        revision: 0,
        updatedAt: 0,
    });
}
