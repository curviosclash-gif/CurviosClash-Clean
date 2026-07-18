// ============================================
// signaling-server.js - WebSocket signaling server for Internet play
// ============================================

import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    SIGNALING_SESSION_CONTRACT_VERSION,
    createSignalingEnvelope,
    normalizeSignalingEnvelope,
    resolveSignalingCommandRole,
} from '../src/shared/contracts/SignalingSessionContract.js';

function generateLobbyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i += 1) {
        code += chars[randomBytes[i] % chars.length];
    }
    return code;
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateMatchCommandId() {
    return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const lobbies = new Map();
const peerToLobby = new Map();
const reconnectLeases = new Map();

const HEARTBEAT_INTERVAL = 4000;
const STALE_TIMEOUT = 15000;
const LOBBY_TIMEOUT = 30 * 60 * 1000;
const RECONNECT_WINDOW_MS = 30_000;
const MAX_SIGNALING_PAYLOAD_BYTES = 16 * 1024;
const MAX_LOBBY_PLAYERS = 10;
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_SOCKET = 120;
const MAX_MESSAGES_PER_IP = 600;
const MAX_LOBBIES = 1_000;
const MAX_CONNECTIONS_PER_IP = 32;
const MAX_LOBBIES_PER_IP = 8;
const MAX_PUBLIC_LOBBIES = 50;
const UNASSIGNED_SOCKET_TIMEOUT_MS = 10_000;

let nextPeerId = 1;

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeLobbyCode(value, fallback = '') {
    return normalizeString(value, fallback).toUpperCase();
}

function resolveAllowedOrigins(configuredOrigins) {
    const source = Array.isArray(configuredOrigins)
        ? configuredOrigins
        : String(process.env.CURVIOS_SIGNALING_ALLOWED_ORIGINS || '').split(',');
    return new Set(source.map((entry) => {
        try { return new URL(String(entry || '').trim()).origin; } catch { return ''; }
    }).filter(Boolean));
}

export function isAllowedSignalingOrigin(origin, configuredOrigins = undefined) {
    const normalizedOrigin = normalizeString(origin, '');
    if (!normalizedOrigin) return true;
    try {
        const parsed = new URL(normalizedOrigin);
        const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
        return resolveAllowedOrigins(configuredOrigins).has(parsed.origin);
    } catch {
        return false;
    }
}

function isValidSessionToken(expectedToken, providedToken) {
    const expected = Buffer.from(normalizeString(expectedToken, ''), 'utf8');
    const provided = Buffer.from(normalizeString(providedToken, ''), 'utf8');
    return expected.length > 0
        && expected.length === provided.length
        && crypto.timingSafeEqual(expected, provided);
}

function sendJson(ws, data) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

function sendSignaling(ws, type, payload = null) {
    sendJson(ws, createSignalingEnvelope(type, payload));
}

function broadcastToLobby(lobby, type, payload = null, excludeWs = null) {
    for (const player of lobby.players) {
        if (player.ws === excludeWs) continue;
        sendSignaling(player.ws, type, payload);
    }
}

function touchLobbyActivity(lobby, timestamp = Date.now()) {
    if (!lobby) return;
    lobby.lastActivityAt = timestamp;
}

function getSocketPeerId(ws) {
    return normalizeString(ws?._peerId, '');
}

function buildReconnectLeaseKey(lobbyCode, peerId) {
    const normalizedLobbyCode = normalizeLobbyCode(lobbyCode, '');
    const normalizedPeerId = normalizeString(peerId, '');
    if (!normalizedLobbyCode || !normalizedPeerId) return '';
    return `${normalizedLobbyCode}:${normalizedPeerId}`;
}

function clearReconnectLease(lobbyCode, peerId) {
    const leaseKey = buildReconnectLeaseKey(lobbyCode, peerId);
    if (!leaseKey) return;
    reconnectLeases.delete(leaseKey);
}

function clearLobbyReconnectLeases(lobbyCode) {
    const normalizedLobbyCode = normalizeLobbyCode(lobbyCode, '');
    if (!normalizedLobbyCode) return;
    for (const leaseKey of reconnectLeases.keys()) {
        if (leaseKey.startsWith(`${normalizedLobbyCode}:`)) {
            reconnectLeases.delete(leaseKey);
        }
    }
}

function createLobbyPlayer({
    peerId,
    ws,
    isHost = false,
    ready = false,
    actorId = '',
    name = '',
    joinedAt = Date.now(),
    lastSeenAt = Date.now(),
    sessionToken = generateSessionToken(),
} = {}) {
    const normalizedPeerId = normalizeString(peerId, '');
    const fallbackName = isHost === true ? 'Host' : normalizedPeerId;
    return {
        peerId: normalizedPeerId,
        ws,
        isHost: isHost === true,
        ready: ready === true,
        actorId: normalizeString(actorId, fallbackName),
        name: normalizeString(name || actorId, fallbackName),
        sessionToken: normalizeString(sessionToken, ''),
        joinedAt: Number.isFinite(Number(joinedAt)) ? Math.max(0, Math.floor(Number(joinedAt))) : Date.now(),
        lastSeenAt: Number.isFinite(Number(lastSeenAt)) ? Math.max(0, Math.floor(Number(lastSeenAt))) : Date.now(),
    };
}

function bumpLobbyState(lobby) {
    if (!lobby) return;
    lobby.updatedAt = Date.now();
    touchLobbyActivity(lobby, lobby.updatedAt);
    lobby.revision = Number.isFinite(Number(lobby.revision))
        ? Math.max(0, Math.floor(Number(lobby.revision))) + 1
        : 1;
}

function buildLobbyState(lobby) {
    if (!lobby) return null;
    const members = lobby.players.map((player) => ({
        peerId: player.peerId,
        playerId: player.peerId,
        actorId: player.actorId,
        name: player.name,
        role: player.isHost === true ? 'host' : 'client',
        isHost: player.isHost === true,
        ready: player.ready === true,
        joinedAt: Number(player.joinedAt || lobby.createdAt || 0),
        lastSeenAt: Number(player.lastSeenAt || lobby.updatedAt || lobby.createdAt || 0),
    }));
    return {
        contractVersion: SIGNALING_SESSION_CONTRACT_VERSION,
        lobbyCode: lobby.code,
        hostPeerId: lobby.hostPeerId,
        maxPlayers: lobby.maxPlayers,
        createdAt: lobby.createdAt,
        updatedAt: Number(lobby.updatedAt || lobby.createdAt || Date.now()),
        revision: Number(lobby.revision || 0),
        pendingMatchStart: lobby.pendingMatchStart || null,
        members,
        players: members,
    };
}

function buildOpenLobbyList() {
    return [...lobbies.values()]
        .filter((lobby) => (
            !lobby.pendingMatchStart
            && lobby.players.length < lobby.maxPlayers
            && lobby.players.some((player) => (
                player.peerId === lobby.hostPeerId
                && player.ws?.readyState === 1
            ))
        ))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
        .slice(0, MAX_PUBLIC_LOBBIES)
        .map((lobby) => ({
            lobbyCode: lobby.code,
            memberCount: lobby.players.length,
            maxPlayers: lobby.maxPlayers,
            createdAt: lobby.createdAt,
            updatedAt: lobby.updatedAt,
        }));
}

function setReconnectLease(lobbyCode, player) {
    const leaseKey = buildReconnectLeaseKey(lobbyCode, player?.peerId);
    if (!leaseKey || !player) return;
    reconnectLeases.set(leaseKey, {
        lobbyCode: normalizeLobbyCode(lobbyCode, ''),
        peerId: normalizeString(player.peerId, ''),
        isHost: player.isHost === true,
        ready: player.ready === true,
        actorId: normalizeString(player.actorId, ''),
        name: normalizeString(player.name, ''),
        sessionToken: normalizeString(player.sessionToken, ''),
        joinedAt: Number(player.joinedAt || Date.now()),
        expiresAt: Date.now() + RECONNECT_WINDOW_MS,
    });
}

function removePeerFromLobby(ws, options = {}) {
    const lobbyCode = peerToLobby.get(ws);
    if (!lobbyCode) return;

    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
        peerToLobby.delete(ws);
        return;
    }

    // Match-transport socket closing (adapter teardown at match end or crash):
    // only detach the transport, the player stays in the lobby via its primary
    // (menu) socket.
    const transportOwner = lobby.players.find((entry) => entry.transportWs === ws);
    if (transportOwner && transportOwner.ws !== ws) {
        transportOwner.transportWs = null;
        peerToLobby.delete(ws);
        bumpLobbyState(lobby);
        return;
    }

    const socketPeerId = getSocketPeerId(ws);
    const player = lobby.players.find((entry) => entry.ws === ws)
        || lobby.players.find((entry) => entry.peerId === socketPeerId && entry.ws?.readyState !== 1);
    if (!player) {
        peerToLobby.delete(ws);
        return;
    }

    // Primary (menu) socket closing while the match transport is still alive:
    // promote the transport socket so the in-match player is not kicked.
    if (player.transportWs && player.transportWs !== ws && player.transportWs.readyState === 1) {
        peerToLobby.delete(ws);
        player.ws = player.transportWs;
        player.transportWs = null;
        bumpLobbyState(lobby);
        return;
    }

    lobby.players = lobby.players.filter((entry) => entry !== player);
    peerToLobby.delete(ws);
    if (player.transportWs) {
        peerToLobby.delete(player.transportWs);
    }
    if (options.allowResume === true) {
        // Hosts get a resume lease too — otherwise a host signaling drop leaves
        // the lobby permanently headless.
        setReconnectLease(lobbyCode, player);
    } else {
        clearReconnectLease(lobbyCode, player.peerId);
    }
    bumpLobbyState(lobby);

    broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.PLAYER_LEFT, {
        peerId: player.peerId,
        sessionState: buildLobbyState(lobby),
    });

    if (lobby.players.length === 0) {
        clearLobbyReconnectLeases(lobbyCode);
        lobbies.delete(lobbyCode);
    }
}

function findSignalingRoute(senderWs, targetPeerId, commandType) {
    const lobbyCode = peerToLobby.get(senderWs);
    if (!lobbyCode) return null;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return null;
    const senderPeerId = getSocketPeerId(senderWs);
    const sender = lobby.players.find((entry) => entry.peerId === senderPeerId);
    const target = lobby.players.find((entry) => entry.peerId === targetPeerId);
    if (!sender || !target || sender === target || sender.isHost === target.isHost) return null;
    const requiredRole = resolveSignalingCommandRole(commandType);
    if (requiredRole === 'host' && sender.isHost !== true) return null;
    if (requiredRole === 'client' && sender.isHost === true) return null;
    // WebRTC signaling (offer/answer/ice) belongs to the match transport when
    // one is attached; lobby traffic keeps using the primary socket.
    if (target.transportWs && target.transportWs.readyState === 1) {
        return target.transportWs;
    }
    return target?.ws || null;
}

export function createSignalingServer(port = 9090, options = {}) {
    const connectionLimit = Number.isFinite(Number(options.maxConnectionsPerIp))
        ? Math.max(1, Math.floor(Number(options.maxConnectionsPerIp)))
        : MAX_CONNECTIONS_PER_IP;
    const lobbyLimit = Number.isFinite(Number(options.maxLobbiesPerIp))
        ? Math.max(1, Math.floor(Number(options.maxLobbiesPerIp)))
        : MAX_LOBBIES_PER_IP;
    const unassignedTimeoutMs = Number.isFinite(Number(options.unassignedSocketTimeoutMs))
        ? Math.max(1, Math.floor(Number(options.unassignedSocketTimeoutMs)))
        : UNASSIGNED_SOCKET_TIMEOUT_MS;
    const ipConnectionCounts = new Map();
    const wss = new WebSocketServer({
        port,
        maxPayload: MAX_SIGNALING_PAYLOAD_BYTES,
        verifyClient: ({ origin }) => isAllowedSignalingOrigin(origin, options.allowedOrigins),
    });
    const ipMessageRates = new Map();

    wss.on('connection', (ws, request) => {
        ws._peerId = `peer-${nextPeerId++}`;
        ws._lastPong = Date.now();
        ws._messageWindowStartedAt = Date.now();
        ws._messageCount = 0;
        ws._remoteAddress = String(request?.socket?.remoteAddress || 'unknown');
        ws.isAlive = true;
        ipConnectionCounts.set(ws._remoteAddress, (ipConnectionCounts.get(ws._remoteAddress) || 0) + 1);
        if (ipConnectionCounts.get(ws._remoteAddress) > connectionLimit) {
            ipConnectionCounts.set(ws._remoteAddress, connectionLimit);
            ws.close(1008, 'connection_limit_exceeded');
            return;
        }
        const unassignedTimer = setTimeout(() => {
            if (!peerToLobby.has(ws) && ws.readyState === 1) {
                ws.close(1008, 'lobby_assignment_timeout');
            }
        }, unassignedTimeoutMs);

        const releaseConnection = () => {
            if (ws._connectionCountReleased) return;
            ws._connectionCountReleased = true;
            clearTimeout(unassignedTimer);
            const remaining = Math.max(0, (ipConnectionCounts.get(ws._remoteAddress) || 1) - 1);
            if (remaining === 0) ipConnectionCounts.delete(ws._remoteAddress);
            else ipConnectionCounts.set(ws._remoteAddress, remaining);
        };

        ws.on('pong', () => {
            ws._lastPong = Date.now();
            ws.isAlive = true;
            // Live sockets keep their lobby from expiring; the lobby timeout is
            // inactivity-based, not age-based.
            const lobbyCode = peerToLobby.get(ws);
            if (lobbyCode) {
                touchLobbyActivity(lobbies.get(lobbyCode));
            }
        });

        ws.on('error', () => {
            removePeerFromLobby(ws, { allowResume: true });
            releaseConnection();
        });

        ws.on('message', (raw) => {
            const timestamp = Date.now();
            if (timestamp - ws._messageWindowStartedAt >= MESSAGE_RATE_WINDOW_MS) {
                ws._messageWindowStartedAt = timestamp;
                ws._messageCount = 0;
            }
            let ipRate = ipMessageRates.get(ws._remoteAddress);
            if (!ipRate || timestamp - ipRate.windowStartedAt >= MESSAGE_RATE_WINDOW_MS) {
                ipRate = { windowStartedAt: timestamp, count: 0 };
                ipMessageRates.set(ws._remoteAddress, ipRate);
            }
            ws._messageCount += 1;
            ipRate.count += 1;
            if (ws._messageCount > MAX_MESSAGES_PER_SOCKET || ipRate.count > MAX_MESSAGES_PER_IP) {
                sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Rate limit exceeded' });
                ws.close(1008, 'rate_limit_exceeded');
                return;
            }

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return;
            }
            const envelope = normalizeSignalingEnvelope(parsed);
            const msg = envelope.payload;
            const peerId = getSocketPeerId(ws);

            if (
                peerToLobby.has(ws)
                && (envelope.type === SIGNALING_COMMAND_TYPES.CREATE_LOBBY
                    || envelope.type === SIGNALING_COMMAND_TYPES.JOIN_LOBBY)
            ) {
                sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Socket already assigned to a lobby' });
                return;
            }

            switch (envelope.type) {
            case SIGNALING_COMMAND_TYPES.LIST_LOBBIES:
                sendSignaling(ws, SIGNALING_EVENT_TYPES.LOBBY_LIST, {
                    lobbies: buildOpenLobbyList(),
                });
                break;

            case SIGNALING_COMMAND_TYPES.CREATE_LOBBY: {
                if (lobbies.size >= MAX_LOBBIES) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Lobby capacity reached' });
                    break;
                }
                const ownedLobbyCount = [...lobbies.values()]
                    .filter((entry) => entry.ownerAddress === ws._remoteAddress).length;
                if (ownedLobbyCount >= lobbyLimit) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'IP lobby capacity reached' });
                    break;
                }
                const code = generateLobbyCode();
                const requestedMaxPlayers = Number(msg.maxPlayers);
                const maxPlayers = Number.isFinite(requestedMaxPlayers)
                    ? Math.min(Math.max(Math.floor(requestedMaxPlayers), 2), MAX_LOBBY_PLAYERS)
                    : MAX_LOBBY_PLAYERS;
                const createdAt = Date.now();
                const lobby = {
                    code,
                    maxPlayers,
                    hostPeerId: peerId,
                    players: [createLobbyPlayer({
                        peerId,
                        ws,
                        isHost: true,
                        ready: true,
                        actorId: normalizeString(msg.actorId, 'Host'),
                        name: normalizeString(msg.name || msg.actorId, 'Host'),
                        joinedAt: createdAt,
                        lastSeenAt: createdAt,
                    })],
                    createdAt,
                    updatedAt: createdAt,
                    lastActivityAt: createdAt,
                    revision: 1,
                    pendingMatchStart: null,
                    ownerAddress: ws._remoteAddress,
                };
                lobbies.set(code, lobby);
                peerToLobby.set(ws, code);
                sendSignaling(ws, SIGNALING_EVENT_TYPES.LOBBY_CREATED, {
                    lobbyCode: code,
                    playerId: peerId,
                    sessionToken: lobby.players[0].sessionToken,
                    maxPlayers,
                    sessionState: buildLobbyState(lobby),
                });
                break;
            }

            case SIGNALING_COMMAND_TYPES.JOIN_LOBBY: {
                const requestedLobbyCode = normalizeLobbyCode(msg.lobbyCode, '');
                const lobby = lobbies.get(requestedLobbyCode);
                if (!lobby) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Lobby not found' });
                    return;
                }
                if (lobby.players.length >= lobby.maxPlayers) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Lobby full' });
                    return;
                }
                const player = createLobbyPlayer({
                    peerId,
                    ws,
                    isHost: false,
                    ready: false,
                    actorId: normalizeString(msg.actorId, peerId),
                    name: normalizeString(msg.name || msg.actorId, peerId),
                });
                lobby.players.push(player);
                bumpLobbyState(lobby);
                peerToLobby.set(ws, requestedLobbyCode);
                sendSignaling(ws, SIGNALING_EVENT_TYPES.LOBBY_JOINED, {
                    playerId: peerId,
                    lobbyCode: requestedLobbyCode,
                    sessionToken: player.sessionToken,
                    sessionState: buildLobbyState(lobby),
                });
                broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.PLAYER_JOINED, {
                    peerId,
                    name: msg.name || peerId,
                    sessionState: buildLobbyState(lobby),
                }, ws);
                break;
            }

            case SIGNALING_COMMAND_TYPES.RESUME_CONNECTION: {
                const lobbyCode = normalizeLobbyCode(msg.lobbyCode, '');
                const resumePeerId = normalizeString(msg.playerId, '');
                const lobby = lobbyCode ? lobbies.get(lobbyCode) : null;
                const leaseKey = buildReconnectLeaseKey(lobbyCode, resumePeerId);
                const lease = leaseKey ? reconnectLeases.get(leaseKey) : null;
                if (!lobby || !lease) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Connection resume failed' });
                    break;
                }
                if (lease.expiresAt <= Date.now()) {
                    reconnectLeases.delete(leaseKey);
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Reconnect window expired' });
                    break;
                }
                if (!isValidSessionToken(lease.sessionToken, msg.sessionToken)) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Connection resume failed' });
                    break;
                }
                if (lobby.players.some((entry) => entry.peerId === resumePeerId)) {
                    reconnectLeases.delete(leaseKey);
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Player already connected' });
                    break;
                }

                ws._peerId = resumePeerId;
                const resumedAt = Date.now();
                lobby.players.push(createLobbyPlayer({
                    peerId: resumePeerId,
                    ws,
                    isHost: lease.isHost === true,
                    ready: lease.ready === true,
                    actorId: lease.actorId,
                    name: lease.name,
                    sessionToken: lease.sessionToken,
                    joinedAt: lease.joinedAt,
                    lastSeenAt: resumedAt,
                }));
                peerToLobby.set(ws, lobbyCode);
                reconnectLeases.delete(leaseKey);
                bumpLobbyState(lobby);
                sendSignaling(ws, SIGNALING_EVENT_TYPES.CONNECTION_RESUMED, {
                    lobbyCode,
                    playerId: resumePeerId,
                    sessionToken: lease.sessionToken,
                    sessionState: buildLobbyState(lobby),
                });
                broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.PLAYER_RECONNECTED, {
                    peerId: resumePeerId,
                    name: normalizeString(lease.name || lease.actorId, resumePeerId),
                    sessionState: buildLobbyState(lobby),
                }, ws);
                break;
            }

            case SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT: {
                // A match-runtime adapter attaches a second (transport) socket to an
                // existing lobby membership instead of creating/joining a new lobby.
                // This keeps host and clients in the SAME lobby for the WebRTC
                // handshake and avoids double slot usage.
                const lobbyCode = normalizeLobbyCode(msg.lobbyCode, '');
                const attachPeerId = normalizeString(msg.playerId, '');
                const lobby = lobbyCode ? lobbies.get(lobbyCode) : null;
                const player = lobby
                    ? lobby.players.find((entry) => entry.peerId === attachPeerId)
                    : null;
                if (!lobby || !player || !isValidSessionToken(player.sessionToken, msg.sessionToken)) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Transport attach failed' });
                    break;
                }
                if (player.transportWs && player.transportWs !== ws && player.transportWs.readyState === 1) {
                    try { player.transportWs.close(); } catch { /* replace stale transport */ }
                    peerToLobby.delete(player.transportWs);
                }
                ws._peerId = attachPeerId;
                ws._isTransport = true;
                player.transportWs = ws;
                player.lastSeenAt = Date.now();
                peerToLobby.set(ws, lobbyCode);
                bumpLobbyState(lobby);

                const attachedPeerIds = lobby.players
                    .filter((entry) => entry.peerId !== attachPeerId
                        && entry.transportWs && entry.transportWs.readyState === 1)
                    .map((entry) => entry.peerId);
                sendSignaling(ws, SIGNALING_EVENT_TYPES.TRANSPORT_ATTACHED, {
                    playerId: attachPeerId,
                    lobbyCode,
                    sessionToken: player.sessionToken,
                    isHost: player.isHost === true,
                    hostPeerId: lobby.hostPeerId,
                    attachedPeerIds,
                    sessionState: buildLobbyState(lobby),
                });
                // Notify already-attached transports (the host offers to clients as
                // they attach; attach order host/client is race-free either way).
                for (const entry of lobby.players) {
                    if (entry.peerId === attachPeerId) continue;
                    if (!entry.transportWs || entry.transportWs.readyState !== 1) continue;
                    sendSignaling(entry.transportWs, SIGNALING_EVENT_TYPES.PLAYER_TRANSPORT_ATTACHED, {
                        peerId: attachPeerId,
                        isHost: player.isHost === true,
                        hostPeerId: lobby.hostPeerId,
                    });
                }
                break;
            }

            case SIGNALING_COMMAND_TYPES.OFFER: {
                const target = findSignalingRoute(ws, msg.targetPeerId, envelope.type);
                if (target) {
                    sendSignaling(target, SIGNALING_COMMAND_TYPES.OFFER, {
                        fromPeerId: peerId,
                        offer: msg.offer,
                    });
                } else sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Signaling role violation' });
                break;
            }

            case SIGNALING_COMMAND_TYPES.ANSWER: {
                const target = findSignalingRoute(ws, msg.targetPeerId, envelope.type);
                if (target) {
                    sendSignaling(target, SIGNALING_COMMAND_TYPES.ANSWER, {
                        fromPeerId: peerId,
                        answer: msg.answer,
                    });
                } else sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Signaling role violation' });
                break;
            }

            case SIGNALING_COMMAND_TYPES.ICE: {
                const target = findSignalingRoute(ws, msg.targetPeerId, envelope.type);
                if (target) {
                    sendSignaling(target, SIGNALING_COMMAND_TYPES.ICE, {
                        fromPeerId: peerId,
                        candidate: msg.candidate,
                    });
                } else sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'Signaling role violation' });
                break;
            }

            case SIGNALING_COMMAND_TYPES.READY: {
                const lobbyCode = peerToLobby.get(ws);
                const lobby = lobbyCode ? lobbies.get(lobbyCode) : null;
                if (!lobby) break;
                const player = lobby.players.find((entry) => entry.peerId === peerId);
                if (player) {
                    player.ready = msg.ready === true;
                    player.lastSeenAt = Date.now();
                    bumpLobbyState(lobby);
                }
                broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.PLAYER_READY, {
                    peerId,
                    ready: msg.ready === true,
                    sessionState: buildLobbyState(lobby),
                });
                break;
            }

            case SIGNALING_COMMAND_TYPES.INVALIDATE_READY: {
                const lobbyCode = peerToLobby.get(ws);
                const lobby = lobbyCode ? lobbies.get(lobbyCode) : null;
                if (!lobby || lobby.hostPeerId !== peerId) break;
                const invalidatedPeerIds = [];
                for (const player of lobby.players) {
                    if (player.isHost === true || player.ready !== true) continue;
                    player.ready = false;
                    player.lastSeenAt = Date.now();
                    invalidatedPeerIds.push(player.peerId);
                }
                if (invalidatedPeerIds.length > 0) {
                    bumpLobbyState(lobby);
                    for (const peerIdToInvalidate of invalidatedPeerIds) {
                        broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.PLAYER_READY, {
                            peerId: peerIdToInvalidate,
                            ready: false,
                            sessionState: buildLobbyState(lobby),
                        });
                    }
                }
                break;
            }

            case SIGNALING_COMMAND_TYPES.START_MATCH: {
                const lobbyCode = peerToLobby.get(ws);
                const lobby = lobbyCode ? lobbies.get(lobbyCode) : null;
                if (!lobby || lobby.hostPeerId !== peerId) break;
                if (lobby.players.length < 2) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'At least two players are required' });
                    break;
                }
                if (lobby.players.some((player) => player.ready !== true)) {
                    sendSignaling(ws, SIGNALING_EVENT_TYPES.ERROR, { message: 'All players must be ready' });
                    break;
                }
                lobby.pendingMatchStart = {
                    commandId: String(msg.commandId || '').trim() || generateMatchCommandId(),
                    lobbyCode: lobby.code,
                    hostPeerId: lobby.hostPeerId,
                    issuedAt: Date.now(),
                    settingsSnapshot: msg.settingsSnapshot ?? null,
                };
                bumpLobbyState(lobby);
                broadcastToLobby(lobby, SIGNALING_EVENT_TYPES.MATCH_START, {
                    pendingMatchStart: lobby.pendingMatchStart,
                    sessionState: buildLobbyState(lobby),
                });
                break;
            }

            case SIGNALING_COMMAND_TYPES.LEAVE:
                removePeerFromLobby(ws, { allowResume: false });
                break;

            default:
                break;
            }
        });

        ws.on('close', () => {
            removePeerFromLobby(ws, { allowResume: true });
            releaseConnection();
        });
    });

    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive || Date.now() - ws._lastPong > STALE_TIMEOUT) {
                removePeerFromLobby(ws, { allowResume: true });
                ws.terminate();
                return;
            }
            ws.isAlive = false;
            ws.ping();
        });

        const now = Date.now();
        for (const [address, rate] of ipMessageRates.entries()) {
            if (now - rate.windowStartedAt >= MESSAGE_RATE_WINDOW_MS) {
                ipMessageRates.delete(address);
            }
        }
        for (const [leaseKey, lease] of reconnectLeases.entries()) {
            if (Number(lease?.expiresAt || 0) <= now) {
                reconnectLeases.delete(leaseKey);
            }
        }
        for (const [code, lobby] of lobbies) {
            // Inactivity-based expiry: connected sockets bump lastActivityAt via
            // ws pong, so active lobbies/matches never expire mid-session.
            const lastActivityAt = Math.max(
                Number(lobby.createdAt || 0),
                Number(lobby.lastActivityAt || 0)
            );
            const hostPresent = lobby.players.some((entry) => entry.peerId === lobby.hostPeerId);
            const hostLease = reconnectLeases.get(buildReconnectLeaseKey(code, lobby.hostPeerId));
            const headless = !hostPresent && !hostLease;
            if (!headless && now - lastActivityAt <= LOBBY_TIMEOUT) continue;
            const closeMessage = headless ? 'Host left permanently' : 'Lobby expired';
            for (const player of lobby.players) {
                sendSignaling(player.ws, SIGNALING_EVENT_TYPES.ERROR, { message: closeMessage });
                peerToLobby.delete(player.ws);
                if (player.transportWs) {
                    peerToLobby.delete(player.transportWs);
                }
            }
            clearLobbyReconnectLeases(code);
            lobbies.delete(code);
        }
    }, HEARTBEAT_INTERVAL);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    console.log(`Signaling Server running on ws://0.0.0.0:${port}`);
    return wss;
}

if (process.argv[1] && process.argv[1].endsWith('signaling-server.js')) {
    const port = parseInt(process.argv[2] || '9090', 10);
    createSignalingServer(port);
}
