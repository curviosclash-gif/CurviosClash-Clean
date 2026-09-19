// ============================================
// lan-signaling.js - HTTP-based LAN signaling server
// ============================================

import http from 'node:http';
import { isLobbySettingsRevisionCurrent } from '../src/shared/contracts/LobbyMatchSummaryContract.js';
import {
    normalizeMultiplayerPlayerName,
    normalizeOptionalMultiplayerPlayerName,
    resolveDefaultMultiplayerPlayerName,
} from '../src/shared/contracts/MultiplayerSessionContract.js';
import crypto from 'node:crypto';
import {
    SIGNALING_HTTP_ROUTES,
    SIGNALING_SESSION_CONTRACT_VERSION,
    isMobileLanParticipantMetadata,
    normalizeSignalingParticipantMetadata,
    normalizePublicLobbyMetadata,
    validateMobileLanLobbyMetadata,
    validateMobileLanLobbyMatchConsistency,
    validateMobileLanMatchSettingsSnapshot,
    validateMobileLanParticipantMetadata,
} from '../src/shared/contracts/SignalingSessionContract.js';
import { isLocalNetworkHostname } from '../src/shared/contracts/LocalNetworkAddressContract.js';

const DEFAULT_MAX_PLAYERS = 10;
const DEFAULT_GHOST_PLAYER_TIMEOUT_MS = 60_000;
const DEFAULT_GHOST_CLEANUP_INTERVAL_MS = 5_000;
const DEFAULT_RECONNECT_LEASE_MS = 60_000;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_ICE_CANDIDATES_PER_ROUTE = 200;
const REQUEST_RATE_WINDOW_MS = 10_000;
const MAX_REQUESTS_PER_IP = 300;
const REQUEST_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 5_000;

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopbackRequest(req) {
    const remoteAddress = String(req?.socket?.remoteAddress || '').trim();
    return LOOPBACK_ADDRESSES.has(remoteAddress);
}

/**
 * The name other players see for this lobby in the network search: the host's
 * chosen lobby name, otherwise "<profile name> 1" like in the member list.
 */
export function resolveLanLobbyPublicHostName(lobby) {
    const profileName = String(lobby?.metadata?.hostName || lobby?.hostName || '').trim();
    return normalizeMultiplayerPlayerName(lobby?.hostLobbyName, resolveDefaultMultiplayerPlayerName(profileName, 1));
}

function normalizeLobbyCode(value) {
    return String(value || '').trim().toUpperCase();
}

function toPlayerId(value) {
    return String(value || '').trim();
}

function generateLobbyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i += 1) {
        code += chars[randomBytes[i] % chars.length];
    }
    return code;
}

function generateAccessToken(prefix = 'tok') {
    return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

function resolveCorsOrigin(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return '';
    try {
        const { protocol, hostname: rawHostname } = new URL(origin);
        const hostname = rawHostname.replace(/^\[|\]$/g, '').toLowerCase();
        return (protocol === 'http:' || protocol === 'https:')
            && isLocalNetworkHostname(hostname)
            ? origin
            : null;
    } catch {
        return null;
    }
}

function jsonResponse(res, data, status = 200) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (res.corsOrigin) {
        headers['Access-Control-Allow-Origin'] = res.corsOrigin;
        headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify({
        contractVersion: SIGNALING_SESSION_CONTRACT_VERSION,
        ...data,
    }));
}

function rejectOversizedRequest(req, res) {
    res.once('finish', () => req.destroy());
    jsonResponse(res, { ok: false, message: 'payload_too_large' }, 413);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        req.on('data', (chunk) => {
            if (settled) return;
            const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
            totalBytes += chunkBuffer.length;
            if (totalBytes > MAX_REQUEST_BODY_BYTES) {
                req.pause();
                settle({ __tooLarge: true });
                return;
            }
            chunks.push(chunkBuffer);
        });
        req.on('end', () => {
            if (settled) return;
            if (chunks.length === 0) {
                settle({});
                return;
            }
            try {
                const bodyString = Buffer.concat(chunks).toString('utf-8');
                settle(JSON.parse(bodyString));
            } catch {
                settle({ __badJson: true });
            }
        });
        req.on('error', () => settle({ __badJson: true }));
    });
}

function buildLobbyState(lobby) {
    return {
        lobbyCode: lobby.code,
        hostPeerId: 'host',
        hostReady: lobby.hostReady === true,
        hostActorId: String(lobby.hostActorId || 'Host').trim() || 'Host',
        hostName: String(lobby.hostName || lobby.hostActorId || 'Host').trim() || 'Host',
        hostLobbyName: normalizeOptionalMultiplayerPlayerName(lobby.hostLobbyName),
        maxPlayers: Number(lobby.maxPlayers || DEFAULT_MAX_PLAYERS),
        metadata: { ...lobby.metadata },
        settingsRevision: lobby.settingsRevision,
        updatedAt: Date.now(),
        players: lobby.players.map((player) => ({
            peerId: player.playerId,
            playerId: player.playerId,
            ready: player.ready === true,
            isHost: false,
            actorId: String(player.actorId || player.playerId).trim(),
            name: String(player.name || player.actorId || player.playerId).trim(),
            lobbyName: normalizeOptionalMultiplayerPlayerName(player.lobbyName),
            participantMetadata: { ...player.participantMetadata },
        })),
        pendingPlayers: lobby.pendingPlayers.map((entry) => ({ playerId: entry.playerId })),
        pendingMatchStart: lobby.pendingMatchStart
            ? {
                commandId: String(lobby.pendingMatchStart.commandId || '').trim(),
                lobbyCode: String(lobby.pendingMatchStart.lobbyCode || lobby.code).trim(),
                hostPeerId: String(lobby.pendingMatchStart.hostPeerId || 'host').trim() || 'host',
                issuedAt: Number(lobby.pendingMatchStart.issuedAt || Date.now()),
                settingsSnapshot: lobby.pendingMatchStart.settingsSnapshot ?? null,
            }
            : null,
    };
}

function isHostPeerId(value) {
    return toPlayerId(value) === 'host';
}

function countLobbyMembers(lobby) {
    // Host is always represented as a virtual member in this signaling model.
    return 1 + lobby.players.length;
}

export function createLANSignalingServer(port = 9090, options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const resolveDiagnostics = typeof options.resolveDiagnostics === 'function'
        ? options.resolveDiagnostics
        : null;
    const ghostPlayerTimeoutMs = Number.isFinite(Number(options.ghostPlayerTimeoutMs))
        ? Math.max(1, Math.floor(Number(options.ghostPlayerTimeoutMs)))
        : DEFAULT_GHOST_PLAYER_TIMEOUT_MS;
    const ghostCleanupIntervalMs = Number.isFinite(Number(options.ghostCleanupIntervalMs))
        ? Math.max(0, Math.floor(Number(options.ghostCleanupIntervalMs)))
        : DEFAULT_GHOST_CLEANUP_INTERVAL_MS;

    const reconnectLeaseMs = Number.isFinite(Number(options.reconnectLeaseMs))
        ? Math.max(1, Math.floor(Number(options.reconnectLeaseMs)))
        : DEFAULT_RECONNECT_LEASE_MS;
    const requestRateWindowMs = Number.isFinite(Number(options.requestRateWindowMs))
        ? Math.max(1, Math.floor(Number(options.requestRateWindowMs)))
        : REQUEST_RATE_WINDOW_MS;
    const maxRequestsPerIp = Number.isFinite(Number(options.maxRequestsPerIp))
        ? Math.max(1, Math.floor(Number(options.maxRequestsPerIp)))
        : MAX_REQUESTS_PER_IP;
    const requestRates = new Map();

    const lobby = {
        code: generateLobbyCode(),
        hostToken: generateAccessToken('host'),
        hostReady: true,
        settingsRevision: 1,
        hostActorId: 'Host',
        hostName: 'Host',
        maxPlayers: DEFAULT_MAX_PLAYERS,
        metadata: normalizePublicLobbyMetadata(),
        players: [],
        pendingPlayers: [],
        offers: new Map(),
        answers: new Map(),
        // key: target playerId, value: Array<{ fromPlayerId: string, candidate: any }>
        ice: new Map(),
        pendingMatchStart: null,
        // key: playerId, value: { token, ready, expiresAt } — allows a ghost-cleaned
        // or dropped player to rejoin with its original playerId (host-side
        // reconnect window relies on stable playerIds).
        reconnectLeases: new Map(),
    };

    let nextPlayerId = 1;

    const isValidHostToken = (token) => {
        const normalized = String(token || '');
        return normalized !== '' && normalized === String(lobby.hostToken || '');
    };

    const findActivePlayer = (playerId) => lobby.players.find((entry) => entry.playerId === playerId);

    const isValidPlayerToken = (playerId, token) => {
        const player = findActivePlayer(toPlayerId(playerId));
        const normalized = String(token || '');
        return !!player && normalized !== '' && normalized === String(player.token || '');
    };

    // Signaling participants are either the host (hostToken) or a joined
    // player (its playerToken). Without this check anyone on the LAN could
    // consume offers or inject ICE candidates for other players.
    const isAuthorizedSignalingActor = (actorId, token) => {
        const normalizedActorId = toPlayerId(actorId);
        if (normalizedActorId === 'host') {
            return isValidHostToken(token);
        }
        return isValidPlayerToken(normalizedActorId, token);
    };

    const touchPlayerActivity = (playerId) => {
        const normalizedPlayerId = toPlayerId(playerId);
        if (!normalizedPlayerId) return;
        const timestamp = now();
        const player = lobby.players.find((entry) => entry.playerId === normalizedPlayerId);
        if (player) {
            player.lastActivityAt = timestamp;
        }
        const pendingEntry = lobby.pendingPlayers.find((entry) => entry.playerId === normalizedPlayerId);
        if (pendingEntry) {
            pendingEntry.lastActivityAt = timestamp;
        }
    };

    const removePlayerFromIceQueues = (playerId) => {
        for (const [targetPlayerId, queue] of lobby.ice.entries()) {
            if (targetPlayerId === playerId) {
                lobby.ice.delete(targetPlayerId);
                continue;
            }
            const remaining = queue.filter((entry) => entry.fromPlayerId !== playerId);
            if (remaining.length <= 0) {
                lobby.ice.delete(targetPlayerId);
            } else if (remaining.length !== queue.length) {
                lobby.ice.set(targetPlayerId, remaining);
            }
        }
    };

    const removePlayer = (playerId) => {
        const normalizedPlayerId = toPlayerId(playerId);
        if (!normalizedPlayerId) return;
        lobby.players = lobby.players.filter((entry) => entry.playerId !== normalizedPlayerId);
        lobby.pendingPlayers = lobby.pendingPlayers.filter((entry) => entry.playerId !== normalizedPlayerId);
        lobby.offers.delete(normalizedPlayerId);
        lobby.answers.delete(normalizedPlayerId);
        removePlayerFromIceQueues(normalizedPlayerId);
    };

    const cleanupGhostPlayers = (timestamp = now()) => {
        if (lobby.players.length > 0) {
            const stalePlayers = lobby.players
                .filter((entry) => timestamp - Number(entry.lastActivityAt || entry.joinedAt || 0) >= ghostPlayerTimeoutMs);
            for (const stalePlayer of stalePlayers) {
                // Ghost removal keeps a rejoin lease so the player can return
                // with the same playerId via /lobby/rejoin.
                lobby.reconnectLeases.set(stalePlayer.playerId, {
                    token: stalePlayer.token,
                    ready: stalePlayer.ready === true,
                    actorId: stalePlayer.actorId,
                    name: stalePlayer.name,
                    participantMetadata: stalePlayer.participantMetadata,
                    expiresAt: timestamp + reconnectLeaseMs,
                });
                removePlayer(stalePlayer.playerId);
            }
        }
        if (lobby.pendingPlayers.length > 0) {
            lobby.pendingPlayers = lobby.pendingPlayers.filter(
                (entry) => timestamp - Number(entry.lastActivityAt || 0) < ghostPlayerTimeoutMs
            );
        }
        for (const [leasePlayerId, lease] of lobby.reconnectLeases.entries()) {
            if (Number(lease?.expiresAt || 0) <= timestamp) {
                lobby.reconnectLeases.delete(leasePlayerId);
            }
        }
    };

    const cleanupIntervalId = ghostCleanupIntervalMs > 0
        ? setInterval(() => cleanupGhostPlayers(), ghostCleanupIntervalMs)
        : null;

    const server = http.createServer(async (req, res) => {
        const timestamp = Date.now();
        const remoteAddress = String(req.socket?.remoteAddress || 'unknown');
        let requestRate = requestRates.get(remoteAddress);
        if (!requestRate || timestamp - requestRate.windowStartedAt >= requestRateWindowMs) {
            requestRate = { windowStartedAt: timestamp, count: 0 };
            requestRates.set(remoteAddress, requestRate);
        }
        requestRate.count += 1;
        if (requestRate.count > maxRequestsPerIp) {
            req.resume();
            jsonResponse(res, { ok: false, message: 'rate_limit_exceeded' }, 429);
            return;
        }

        const corsOrigin = resolveCorsOrigin(req);
        if (corsOrigin === null) {
            jsonResponse(res, { ok: false, message: 'origin_not_allowed' }, 403);
            return;
        }
        res.corsOrigin = corsOrigin;

        if (req.method === 'OPTIONS') {
            jsonResponse(res, {});
            return;
        }

        let url;
        try {
            url = new URL(req.url, `http://localhost:${port}`);
        } catch {
            req.resume();
            jsonResponse(res, { ok: false, message: 'invalid_request_url' }, 400);
            return;
        }
        const path = url.pathname;

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_CREATE) {
            // The embedded server runs inside the host's app; only the host itself
            // (loopback) may create/reset the lobby. Without this check any LAN
            // participant could reset the lobby and kick every player.
            if (!isLoopbackRequest(req)) {
                jsonResponse(res, { ok: false, message: 'host_required' }, 403);
                return;
            }
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const requestedMaxPlayers = Number(body.maxPlayers);
            lobby.code = generateLobbyCode();
            lobby.hostToken = generateAccessToken('host');
            lobby.hostReady = true;
            lobby.hostActorId = String(body.actorId || body.name || 'Host').trim() || 'Host';
            lobby.hostName = String(body.name || body.actorId || 'Host').trim() || 'Host';
            lobby.hostLobbyName = normalizeOptionalMultiplayerPlayerName(body.lobbyName);
            lobby.maxPlayers = Number.isFinite(requestedMaxPlayers)
                ? Math.max(2, Math.min(DEFAULT_MAX_PLAYERS, Math.floor(requestedMaxPlayers)))
                : DEFAULT_MAX_PLAYERS;
            lobby.metadata = normalizePublicLobbyMetadata(body.metadata, lobby.hostName);
            lobby.settingsRevision = 1;
            lobby.players = [];
            lobby.pendingPlayers = [];
            lobby.offers.clear();
            lobby.answers.clear();
            lobby.ice.clear();
            lobby.pendingMatchStart = null;
            lobby.reconnectLeases.clear();
            jsonResponse(res, {
                ok: true,
                lobbyCode: lobby.code,
                hostToken: lobby.hostToken,
                sessionState: buildLobbyState(lobby),
            });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_JOIN) {
            cleanupGhostPlayers();
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const requestedLobbyCode = normalizeLobbyCode(body.lobbyCode);
            if (!requestedLobbyCode || requestedLobbyCode !== normalizeLobbyCode(lobby.code)) {
                jsonResponse(res, { ok: false, message: 'lobby_not_found' }, 404);
                return;
            }
            if (countLobbyMembers(lobby) >= Number(lobby.maxPlayers || DEFAULT_MAX_PLAYERS)) {
                jsonResponse(res, { ok: false, message: 'lobby_full' }, 409);
                return;
            }
            const playerId = `player-${nextPlayerId++}`;
            const playerToken = generateAccessToken('player');
            const timestamp = now();
            lobby.players.push({
                playerId,
                token: playerToken,
                ready: false,
                actorId: String(body.actorId || body.name || playerId).trim() || playerId,
                name: String(body.name || body.actorId || playerId).trim() || playerId,
                lobbyName: normalizeOptionalMultiplayerPlayerName(body.lobbyName),
                participantMetadata: normalizeSignalingParticipantMetadata(body.participantMetadata),
                joinedAt: timestamp,
                lastActivityAt: timestamp,
            });
            lobby.pendingPlayers.push({ playerId, lastActivityAt: timestamp });
            jsonResponse(res, {
                playerId,
                playerToken,
                lobbyCode: lobby.code,
                sessionState: buildLobbyState(lobby),
            });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_NAME) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            // Each player renames only itself: the token must belong to the named seat.
            const playerId = toPlayerId(body.playerId);
            const lobbyName = normalizeOptionalMultiplayerPlayerName(body.lobbyName);
            if (isHostPeerId(playerId)) {
                if (String(body.hostToken || '') !== String(lobby.hostToken || '')) {
                    jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                    return;
                }
                lobby.hostLobbyName = lobbyName;
                jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
                return;
            }
            const player = lobby.players.find((entry) => entry.playerId === playerId);
            if (!player) {
                jsonResponse(res, { ok: false, message: 'player_not_found' }, 404);
                return;
            }
            if (String(body.playerToken || '') !== String(player.token || '')) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            player.lobbyName = lobbyName;
            touchPlayerActivity(playerId);
            jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_READY) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const playerId = toPlayerId(body.playerId);
            const ready = body.ready === true;
            if (isHostPeerId(playerId)) {
                if (String(body.hostToken || '') !== String(lobby.hostToken || '')) {
                    jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                    return;
                }
                lobby.hostReady = true;
                jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
                return;
            }
            const player = lobby.players.find((entry) => entry.playerId === playerId);
            if (!player) {
                jsonResponse(res, { ok: false, message: 'player_not_found' }, 404);
                return;
            }
            if (String(body.playerToken || '') !== String(player.token || '')) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            if (ready && isMobileLanParticipantMetadata(player.participantMetadata)) {
                const participantCompatibility = validateMobileLanParticipantMetadata(player.participantMetadata);
                const lobbyCompatibility = validateMobileLanLobbyMetadata(lobby.metadata);
                const compatibility = participantCompatibility.compatible
                    ? lobbyCompatibility
                    : participantCompatibility;
                if (!compatibility.compatible) {
                    jsonResponse(res, { ok: false, message: compatibility.code }, 409);
                    return;
                }
            }
            if (!isLobbySettingsRevisionCurrent(body.settingsRevision, lobby.settingsRevision)) {
                jsonResponse(res, { ok: false, message: 'settings_revision_mismatch' }, 409);
                return;
            }
            player.ready = ready;
            touchPlayerActivity(playerId);
            jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_LEAVE) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const playerId = toPlayerId(body.playerId);
            if (!playerId) {
                jsonResponse(res, { ok: false, message: 'player_id_missing' }, 400);
                return;
            }
            if (isHostPeerId(playerId)) {
                if (String(body.hostToken || '') !== String(lobby.hostToken || '')) {
                    jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                    return;
                }
                lobby.code = generateLobbyCode();
                lobby.hostToken = generateAccessToken('host');
                lobby.hostReady = true;
                lobby.players = [];
                lobby.pendingPlayers = [];
                lobby.offers.clear();
                lobby.answers.clear();
                lobby.ice.clear();
                lobby.pendingMatchStart = null;
                lobby.reconnectLeases.clear();
                jsonResponse(res, {
                    ok: true,
                    lobbyCode: lobby.code,
                    sessionState: buildLobbyState(lobby),
                });
                return;
            }
            const player = lobby.players.find((entry) => entry.playerId === playerId);
            if (!player) {
                jsonResponse(res, { ok: false, message: 'player_not_found' }, 404);
                return;
            }
            if (String(body.playerToken || '') !== String(player.token || '')) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            removePlayer(playerId);
            jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_INVALIDATE_READY) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const hostPeerId = toPlayerId(body.hostPeerId || body.playerId);
            if (!isHostPeerId(hostPeerId)) {
                jsonResponse(res, { ok: false, message: 'host_required' }, 403);
                return;
            }
            if (String(body.hostToken || '') !== String(lobby.hostToken || '')) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            lobby.hostReady = true;
            lobby.players = lobby.players.map((entry) => ({
                ...entry,
                ready: false,
            }));
            jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_METADATA) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            if (!isHostPeerId(body.hostPeerId || body.playerId)) {
                jsonResponse(res, { ok: false, message: 'host_required' }, 403);
                return;
            }
            if (!isValidHostToken(body.hostToken)) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            if (lobby.pendingMatchStart) {
                jsonResponse(res, { ok: false, message: 'match_start_pending' }, 409);
                return;
            }
            lobby.metadata = normalizePublicLobbyMetadata(body.metadata, lobby.hostName);
            lobby.settingsRevision += 1;
            lobby.hostReady = true;
            for (const player of lobby.players) player.ready = false;
            jsonResponse(res, { ok: true, sessionState: buildLobbyState(lobby) });
            return;
        }

        if (req.method === 'GET' && path === SIGNALING_HTTP_ROUTES.LOBBY_STATUS) {
            const playerId = toPlayerId(url.searchParams.get('playerId'));
            if (!isAuthorizedSignalingActor(playerId, url.searchParams.get('token'))) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            // The periodic lobby status poll is the liveness signal of menu
            // clients — without this touch, idle players were ghost-cleaned
            // after 60s even though they were still connected and polling.
            touchPlayerActivity(playerId);
            cleanupGhostPlayers();
            const pending = lobby.pendingPlayers.map((entry) => ({ playerId: entry.playerId }));
            const lobbyState = buildLobbyState(lobby);
            jsonResponse(res, {
                sessionState: {
                    ...lobbyState,
                    pendingPlayers: pending,
                },
                ...lobbyState,
                pendingPlayers: pending,
            });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_ACK_PENDING) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            if (!isValidHostToken(body.hostToken)) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            const playerId = toPlayerId(body.playerId);
            if (playerId) {
                lobby.pendingPlayers = lobby.pendingPlayers.filter((entry) => entry.playerId !== playerId);
                touchPlayerActivity(playerId);
            }
            jsonResponse(res, { ok: true });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_REJOIN) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const playerId = toPlayerId(body.playerId);
            const playerToken = String(body.playerToken || '');
            if (!playerId || isHostPeerId(playerId)) {
                jsonResponse(res, { ok: false, message: 'player_id_missing' }, 400);
                return;
            }
            const timestamp = now();
            let player = findActivePlayer(playerId);
            if (player) {
                if (playerToken === '' || playerToken !== String(player.token || '')) {
                    jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                    return;
                }
                player.lastActivityAt = timestamp;
            } else {
                const lease = lobby.reconnectLeases.get(playerId);
                if (!lease || Number(lease.expiresAt || 0) <= timestamp) {
                    jsonResponse(res, { ok: false, message: 'reconnect_window_expired' }, 410);
                    return;
                }
                if (playerToken === '' || playerToken !== String(lease.token || '')) {
                    jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                    return;
                }
                lobby.reconnectLeases.delete(playerId);
                player = {
                    playerId,
                    token: lease.token,
                    ready: lease.ready === true,
                    actorId: lease.actorId || playerId,
                    name: lease.name || lease.actorId || playerId,
                    participantMetadata: lease.participantMetadata,
                    joinedAt: timestamp,
                    lastActivityAt: timestamp,
                };
                lobby.players.push(player);
            }
            // Re-register as pending so the host adapter creates a fresh offer
            // for the SAME playerId (this is what lets the host resolve its
            // 30s reconnect window instead of treating the peer as new).
            if (!lobby.pendingPlayers.some((entry) => entry.playerId === playerId)) {
                lobby.pendingPlayers.push({ playerId, lastActivityAt: timestamp });
            }
            lobby.offers.delete(playerId);
            lobby.answers.delete(playerId);
            jsonResponse(res, {
                ok: true,
                playerId,
                lobbyCode: lobby.code,
                sessionState: buildLobbyState(lobby),
            });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.LOBBY_MATCH_START) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const hostPeerId = toPlayerId(body.hostPeerId || body.playerId || 'host');
            if (!isHostPeerId(hostPeerId)) {
                jsonResponse(res, { ok: false, message: 'host_required' }, 403);
                return;
            }
            if (String(body.hostToken || '') !== String(lobby.hostToken || '')) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            const hasMobileClient = lobby.players.some((player) => (
                isMobileLanParticipantMetadata(player.participantMetadata)
            ));
            if (!isLobbySettingsRevisionCurrent(body.settingsRevision, lobby.settingsRevision)) {
                jsonResponse(res, { ok: false, message: 'settings_revision_mismatch' }, 409);
                return;
            }
            if (hasMobileClient) {
                const participantCompatibility = lobby.players
                    .filter((player) => isMobileLanParticipantMetadata(player.participantMetadata))
                    .map((player) => validateMobileLanParticipantMetadata(player.participantMetadata))
                    .find((result) => !result.compatible);
                const lobbyCompatibility = validateMobileLanLobbyMetadata(lobby.metadata);
                const settingsCompatibility = validateMobileLanMatchSettingsSnapshot(body.settingsSnapshot);
                const consistency = validateMobileLanLobbyMatchConsistency(lobby.metadata, body.settingsSnapshot);
                const compatibility = participantCompatibility || (
                    lobbyCompatibility.compatible
                        ? (settingsCompatibility.compatible ? consistency : settingsCompatibility)
                        : lobbyCompatibility
                );
                if (!compatibility.compatible) {
                    jsonResponse(res, { ok: false, message: compatibility.code }, 409);
                    return;
                }
            }
            if (lobby.pendingMatchStart) {
                jsonResponse(res, {
                    ok: true,
                    pendingMatchStart: lobby.pendingMatchStart,
                    sessionState: buildLobbyState(lobby),
                });
                return;
            }
            if (countLobbyMembers(lobby) < 2) {
                jsonResponse(res, { ok: false, message: 'not_enough_members' }, 409);
                return;
            }
            if (lobby.hostReady !== true || lobby.players.some((entry) => entry.ready !== true)) {
                jsonResponse(res, { ok: false, message: 'members_not_ready' }, 409);
                return;
            }
            const timestamp = now();
            const requestedCommandId = String(body.commandId || '').trim();
            lobby.pendingMatchStart = {
                commandId: requestedCommandId || `match-${timestamp}`,
                lobbyCode: lobby.code,
                hostPeerId: 'host',
                issuedAt: timestamp,
                settingsSnapshot: body?.settingsSnapshot ?? null,
                settingsRevision: lobby.settingsRevision,
            };
            jsonResponse(res, {
                ok: true,
                pendingMatchStart: lobby.pendingMatchStart,
                sessionState: buildLobbyState(lobby),
            });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.SIGNALING_OFFER) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            // Offers flow host → client only.
            if (!isValidHostToken(body.hostToken)) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            const targetPlayerId = toPlayerId(body.targetPlayerId);
            if (targetPlayerId) {
                lobby.offers.set(targetPlayerId, body.offer);
                touchPlayerActivity(targetPlayerId);
            }
            jsonResponse(res, { ok: true });
            return;
        }

        if (req.method === 'GET' && path === SIGNALING_HTTP_ROUTES.SIGNALING_OFFER) {
            const playerId = toPlayerId(url.searchParams.get('playerId'));
            // The GET consumes the offer — without auth anyone knowing the
            // predictable playerId could steal it.
            if (!isValidPlayerToken(playerId, url.searchParams.get('token'))) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            const offer = lobby.offers.get(playerId);
            lobby.offers.delete(playerId);
            touchPlayerActivity(playerId);
            jsonResponse(res, { offer: offer || null });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.SIGNALING_ANSWER) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const playerId = toPlayerId(body.playerId);
            // Answers flow client → host; the sending client authenticates itself.
            if (!isValidPlayerToken(playerId, body.playerToken)) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            lobby.answers.set(playerId, body.answer);
            touchPlayerActivity(playerId);
            jsonResponse(res, { ok: true });
            return;
        }

        if (req.method === 'GET' && path === SIGNALING_HTTP_ROUTES.SIGNALING_ANSWER) {
            // Only the host polls answers.
            if (!isValidHostToken(url.searchParams.get('token'))) {
                jsonResponse(res, { ok: false, message: 'host_auth_failed' }, 403);
                return;
            }
            const playerId = toPlayerId(url.searchParams.get('playerId'));
            const answer = lobby.answers.get(playerId);
            lobby.answers.delete(playerId);
            touchPlayerActivity(playerId);
            jsonResponse(res, { answer: answer || null });
            return;
        }

        if (req.method === 'POST' && path === SIGNALING_HTTP_ROUTES.SIGNALING_ICE) {
            const body = await readBody(req);
            if (body?.__tooLarge === true) {
                rejectOversizedRequest(req, res);
                return;
            }
            if (body?.__badJson === true) {
                jsonResponse(res, { ok: false, message: 'bad_json' }, 400);
                return;
            }
            const fromPlayerId = toPlayerId(body.playerId);
            if (!isAuthorizedSignalingActor(fromPlayerId, body.token ?? body.playerToken ?? body.hostToken)) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            const targetPlayerId = toPlayerId(body.targetPlayerId);
            if (!targetPlayerId) {
                jsonResponse(res, { ok: false, message: 'target_player_missing' }, 400);
                return;
            }
            const isValidRoute = fromPlayerId === 'host'
                ? !!findActivePlayer(targetPlayerId)
                : targetPlayerId === 'host';
            if (!isValidRoute) {
                jsonResponse(res, { ok: false, message: 'signaling_route_invalid' }, 403);
                return;
            }
            if (!lobby.ice.has(targetPlayerId)) {
                lobby.ice.set(targetPlayerId, []);
            }
            const iceQueue = lobby.ice.get(targetPlayerId);
            let routeQueueSize = 0;
            for (const entry of iceQueue) {
                if (entry.fromPlayerId === fromPlayerId) routeQueueSize += 1;
            }
            if (routeQueueSize >= MAX_ICE_CANDIDATES_PER_ROUTE) {
                jsonResponse(res, { ok: false, message: 'ice_queue_full' }, 429);
                return;
            }
            iceQueue.push({
                fromPlayerId: fromPlayerId || 'unknown',
                candidate: body.candidate,
            });
            touchPlayerActivity(fromPlayerId);
            touchPlayerActivity(targetPlayerId);
            jsonResponse(res, { ok: true });
            return;
        }

        if (req.method === 'GET' && path === SIGNALING_HTTP_ROUTES.SIGNALING_ICE) {
            const playerId = toPlayerId(url.searchParams.get('playerId'));
            if (!isAuthorizedSignalingActor(playerId, url.searchParams.get('token'))) {
                jsonResponse(res, { ok: false, message: 'player_auth_failed' }, 403);
                return;
            }
            const fromPlayerId = toPlayerId(url.searchParams.get('fromPlayerId'));
            touchPlayerActivity(playerId);

            const queue = lobby.ice.get(playerId) || [];
            if (!fromPlayerId) {
                const candidates = queue.map((entry) => entry.candidate);
                lobby.ice.delete(playerId);
                jsonResponse(res, { candidates });
                return;
            }

            const candidates = [];
            const remaining = [];
            for (const entry of queue) {
                if (entry.fromPlayerId === fromPlayerId) {
                    candidates.push(entry.candidate);
                } else {
                    remaining.push(entry);
                }
            }
            if (remaining.length <= 0) {
                lobby.ice.delete(playerId);
            } else {
                lobby.ice.set(playerId, remaining);
            }
            jsonResponse(res, { candidates });
            return;
        }

        if (req.method === 'GET' && path === SIGNALING_HTTP_ROUTES.DISCOVERY_INFO) {
            cleanupGhostPlayers();
            const diagnostics = resolveDiagnostics ? resolveDiagnostics() : null;
            const hostIp = String(diagnostics?.hostIp || diagnostics?.localIps?.[0] || '').trim();
            const requestedLobbyCode = normalizeLobbyCode(url.searchParams.get('lobbyCode'));
            jsonResponse(res, {
                matchesLobby: requestedLobbyCode !== '' && requestedLobbyCode === normalizeLobbyCode(lobby.code),
                playerCount: countLobbyMembers(lobby),
                maxPlayers: Number(lobby.maxPlayers || DEFAULT_MAX_PLAYERS),
                hostName: resolveLanLobbyPublicHostName(lobby),
                mapKey: lobby.metadata.mapKey,
                gameMode: lobby.metadata.gameMode,
                modePath: lobby.metadata.modePath,
                winsNeeded: lobby.metadata.winsNeeded,
                ip: hostIp || undefined,
                hostIp: hostIp || undefined,
                diagnostics,
            });
            return;
        }

        jsonResponse(res, { error: 'Not found' }, 404);
    });

    server.requestTimeout = Number.isFinite(Number(options.requestTimeoutMs))
        ? Math.max(1, Math.floor(Number(options.requestTimeoutMs)))
        : REQUEST_TIMEOUT_MS;
    server.headersTimeout = Math.min(
        server.requestTimeout,
        Number.isFinite(Number(options.headersTimeoutMs))
            ? Math.max(1, Math.floor(Number(options.headersTimeoutMs)))
            : HEADERS_TIMEOUT_MS,
    );

    server.on('close', () => {
        if (cleanupIntervalId) {
            clearInterval(cleanupIntervalId);
        }
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`LAN Signaling Server running on port ${port}, lobby code: ${lobby.code}`);
    });

    return { server, lobby, cleanupGhostPlayers };
}

if (process.argv[1] && process.argv[1].endsWith('lan-signaling.js')) {
    const port = parseInt(process.argv[2] || '9090', 10);
    createLANSignalingServer(port);
}
