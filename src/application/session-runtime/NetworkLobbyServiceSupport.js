import { LOBBY_SERVICE_TRANSPORTS, normalizeLobbyServiceTransport } from '../../shared/contracts/LobbyServiceContract.js';
import { tryCloneJsonValue } from '../../shared/utils/JsonClone.js';

export function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function normalizeLobbyCode(value, fallback = '') {
    const normalized = normalizeString(value, fallback)
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
    return normalized || fallback;
}

export function deepClone(value) {
    return tryCloneJsonValue(value, null);
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createIdleSessionState(lobbyCode = '', transport = LOBBY_SERVICE_TRANSPORTS.LAN) {
    return {
        peerId: '',
        joined: false,
        connected: false,
        lobbyCode: normalizeLobbyCode(lobbyCode, ''),
        role: 'offline',
        isHost: false,
        localReady: false,
        memberCount: 0,
        readyCount: 0,
        allReady: false,
        canStart: false,
        hostPeerId: '',
        hostConnected: false,
        pendingMatchCommandId: '',
        signalingUrl: '',
        transport,
        members: [],
    };
}

export function buildSessionState(lobbyState, options = {}) {
    const signalingUrl = normalizeString(options.signalingUrl, '');
    const localPeerId = normalizeString(options.localPeerId, '');
    const localActorId = normalizeString(options.actorId, '');
    const transport = normalizeLobbyServiceTransport(options.transport, LOBBY_SERVICE_TRANSPORTS.LAN);
    if (!lobbyState || typeof lobbyState !== 'object') {
        return createIdleSessionState('', transport);
    }

    const members = Array.isArray(lobbyState.members) ? lobbyState.members : [];
    const hostPeerId = normalizeString(lobbyState.hostPeerId, '');
    const hostConnected = members.some((member) => normalizeString(member?.peerId, '') === hostPeerId);
    const normalizedMembers = members.map((member) => {
        const peerId = normalizeString(member?.peerId, '');
        const isLocal = peerId === localPeerId;
        return {
            ...member,
            actorId: isLocal && localActorId ? localActorId : normalizeString(member?.actorId, peerId || 'Spieler'),
            isLocal,
            isHost: peerId === hostPeerId,
        };
    });
    const localMember = normalizedMembers.find((member) => member.isLocal) || null;
    const joined = !!localMember;
    const isHost = joined && localMember.isHost === true;
    const memberCount = normalizedMembers.length;
    const readyCount = normalizedMembers.filter((member) => member.ready === true).length;
    const allReady = memberCount > 0 && readyCount === memberCount;

    return {
        peerId: localPeerId,
        joined,
        connected: joined && (isHost || hostConnected),
        lobbyCode: normalizeLobbyCode(lobbyState.lobbyCode, ''),
        role: joined ? (isHost ? 'host' : 'client') : 'offline',
        isHost,
        localReady: localMember?.ready === true,
        memberCount,
        readyCount,
        allReady,
        canStart: joined && isHost && hostConnected && memberCount >= 2 && allReady,
        hostPeerId,
        hostConnected,
        pendingMatchCommandId: normalizeString(lobbyState?.pendingMatchStart?.commandId, ''),
        signalingUrl,
        transport,
        members: normalizedMembers,
    };
}

export function normalizeSignalingUrl(value) {
    const text = normalizeString(value, '');
    if (!text) return '';
    if (text.includes('://')) return text;
    return `http://${text}`;
}

export function normalizeHostPort(value, fallback = 0) {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return Number.isInteger(Number(fallback)) ? Number(fallback) : 0;
    }
    return port;
}

export function normalizeDiscoveryHostEntry(host, now = Date.now()) {
    if (!host || typeof host !== 'object') return null;
    const ip = normalizeString(host.ip, '');
    const lobbyCode = normalizeLobbyCode(host.lobbyCode, '');
    const port = normalizeHostPort(host.port, 0);
    if (!ip || !lobbyCode || port <= 0) {
        return null;
    }
    return {
        ip,
        port,
        lobbyCode,
        hostName: normalizeString(host.hostName, ''),
        playerCount: Math.max(0, Math.floor(Number(host.playerCount) || 0)),
        lastSeen: Math.max(0, Math.floor(Number(host.lastSeen) || now)),
    };
}

export function compareDiscoveryHostEntries(left, right) {
    const leftLastSeen = Math.max(0, Math.floor(Number(left?.lastSeen) || 0));
    const rightLastSeen = Math.max(0, Math.floor(Number(right?.lastSeen) || 0));
    if (leftLastSeen !== rightLastSeen) {
        return rightLastSeen - leftLastSeen;
    }
    const leftLobbyCode = normalizeLobbyCode(left?.lobbyCode, '');
    const rightLobbyCode = normalizeLobbyCode(right?.lobbyCode, '');
    if (leftLobbyCode !== rightLobbyCode) {
        return leftLobbyCode.localeCompare(rightLobbyCode);
    }
    const leftIp = normalizeString(left?.ip, '');
    const rightIp = normalizeString(right?.ip, '');
    if (leftIp !== rightIp) {
        return leftIp.localeCompare(rightIp);
    }
    return normalizeHostPort(left?.port, 0) - normalizeHostPort(right?.port, 0);
}

export function tryParseManualSignalingUrl(rawValue, options = {}) {
    const value = normalizeString(rawValue, '');
    if (!value) return '';
    const hasScheme = value.includes('://');
    if (!hasScheme
        && !/^localhost(?::\d+)?$/i.test(value)
        && !/^\d{1,3}(\.\d{1,3}){3}(?::\d+)?$/.test(value)
        && !/^[a-z0-9.-]+:\d+$/i.test(value)
        && !/^\[[0-9a-f:.]+\]:\d+$/i.test(value)) {
        return '';
    }
    let parsedUrl = null;
    try {
        parsedUrl = new URL(hasScheme ? value : `http://${value}`);
    } catch {
        return '';
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return '';
    if (!normalizeString(parsedUrl.hostname, '')) return '';
    if (options?.requirePort === true && !parsedUrl.port) return '';
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return '';
    return parsedUrl.origin;
}

export function defaultJoinLobby(lobby, options = {}) {
    return lobby.join({
        signalingUrl: options.signalingUrl,
        lobbyCode: options.lobbyCode,
    });
}
