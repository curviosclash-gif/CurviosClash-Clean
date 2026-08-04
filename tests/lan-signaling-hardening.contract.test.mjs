import assert from 'node:assert/strict';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { selectJoinSignalingUrlFromDiscoveredHosts } from '../src/application/session-runtime/NetworkLobbyDiscoveryResolver.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';

async function startLanServer(options = {}) {
    const bundle = createLANSignalingServer(0, options);
    await new Promise((resolve) => bundle.server.once('listening', resolve));
    const address = bundle.server.address();
    const port = Number(address?.port || 0);
    return {
        ...bundle,
        baseUrl: `http://127.0.0.1:${port}`,
    };
}

async function stopLanServer(server) {
    if (!server || !server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
}

async function postJson(baseUrl, path, body = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    return {
        ok: response.ok,
        status: response.status,
        payload,
    };
}

async function postRaw(baseUrl, path, rawBody) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    });
    const payload = await response.json().catch(() => ({}));
    return {
        ok: response.ok,
        status: response.status,
        payload,
    };
}

function statusUrl(baseUrl, playerId, token) {
    return `${baseUrl}/lobby/status?${new URLSearchParams({ playerId, token })}`;
}

test('LAN discovery hides join data, status requires a token, and CORS rejects public origins', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 3 });
        const lobbyCode = String(created.payload?.lobbyCode || '');
        const hostToken = String(created.payload?.hostToken || '');

        const discoveryResponse = await fetch(`${lanServer.baseUrl}/discovery/info`);
        const discovery = await discoveryResponse.json();
        assert.equal(discovery.matchesLobby, false);
        assert.equal('lobbyCode' in discovery, false);
        assert.equal('sessionState' in discovery, false);

        const matchingDiscovery = await (
            await fetch(`${lanServer.baseUrl}/discovery/info?${new URLSearchParams({ lobbyCode })}`)
        ).json();
        assert.equal(matchingDiscovery.matchesLobby, true);
        assert.equal('lobbyCode' in matchingDiscovery, false);
        const port = Number(new URL(lanServer.baseUrl).port);
        const resolvedDiscovery = await selectJoinSignalingUrlFromDiscoveredHosts({
            lobbyCode,
            hosts: [{ ip: '127.0.0.1', port, lobbyCode, lastSeen: Date.now() }],
        });
        assert.equal(resolvedDiscovery.signalingUrl, lanServer.baseUrl);

        const unauthenticatedStatus = await fetch(`${lanServer.baseUrl}/lobby/status`);
        assert.equal(unauthenticatedStatus.status, 403);
        const authenticatedStatus = await fetch(statusUrl(lanServer.baseUrl, 'host', hostToken));
        assert.equal(authenticatedStatus.status, 200);

        const blockedJoin = await fetch(`${lanServer.baseUrl}/lobby/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
                Origin: 'https://attacker.example',
            },
            body: JSON.stringify({ lobbyCode }),
        });
        assert.equal(blockedJoin.status, 403);
        assert.equal(blockedJoin.headers.get('access-control-allow-origin'), null);

        const allowedOrigin = 'http://127.0.0.1:5173';
        const allowedJoin = await fetch(`${lanServer.baseUrl}/lobby/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: allowedOrigin,
            },
            body: JSON.stringify({ lobbyCode }),
        });
        assert.equal(allowedJoin.status, 200);
        assert.equal(allowedJoin.headers.get('access-control-allow-origin'), allowedOrigin);
        assert.notEqual(allowedJoin.headers.get('access-control-allow-origin'), '*');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling enforces maxPlayers on join requests', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', {
            maxPlayers: 2,
            actorId: 'Captain',
        });
        assert.equal(created.ok, true);
        assert.equal(created.payload.sessionState.hostActorId, 'Captain');

        const joinedFirst = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
            actorId: 'Wingman',
        });
        assert.equal(joinedFirst.ok, true);
        assert.ok(String(joinedFirst.payload?.playerId || '').startsWith('player-'));
        assert.equal(joinedFirst.payload.sessionState.players[0].actorId, 'Wingman');

        const joinedSecond = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        assert.equal(joinedSecond.ok, false);
        assert.equal(joinedSecond.status, 409);
        assert.equal(joinedSecond.payload?.message, 'lobby_full');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN match start is idempotent while a start command is pending', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 2 });
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
            actorId: 'Client',
        });
        await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId: joined.payload.playerId,
            playerToken: joined.payload.playerToken,
            ready: true,
        });
        const first = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            commandId: 'match-first',
        });
        const duplicate = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            commandId: 'match-second',
        });

        assert.equal(first.ok, true);
        assert.equal(duplicate.ok, true);
        assert.equal(duplicate.payload.pendingMatchStart.commandId, 'match-first');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling rejects oversized JSON payloads with 413', async () => {
    const lanServer = await startLanServer();
    try {
        const oversizedPayload = JSON.stringify({
            maxPlayers: 4,
            padding: 'x'.repeat(20 * 1024),
        });

        const oversizedCreate = await postRaw(lanServer.baseUrl, '/lobby/create', oversizedPayload);
        assert.equal(oversizedCreate.ok, false);
        assert.equal(oversizedCreate.status, 413);
        assert.equal(oversizedCreate.payload?.message, 'payload_too_large');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN lobby preserves server error codes for failed joins', async () => {
    const lanServer = await startLanServer();
    try {
        await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 2 });
        const lobby = new LANMatchLobby({ signalingUrl: lanServer.baseUrl });
        await assert.rejects(
            lobby.join({ signalingUrl: lanServer.baseUrl, lobbyCode: 'WRONG' }),
            (error) => error?.code === 'lobby_not_found'
        );
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling applies per-IP request limits and slow-request timeouts', async () => {
    const lanServer = await startLanServer({
        maxRequestsPerIp: 2,
        requestRateWindowMs: 10_000,
        requestTimeoutMs: 1_200,
        headersTimeoutMs: 600,
    });
    try {
        assert.equal(lanServer.server.requestTimeout, 1_200);
        assert.equal(lanServer.server.headersTimeout, 600);
        assert.equal((await fetch(`${lanServer.baseUrl}/discovery/info`)).status, 200);
        assert.equal((await fetch(`${lanServer.baseUrl}/discovery/info`)).status, 200);
        const limited = await fetch(`${lanServer.baseUrl}/discovery/info`);
        assert.equal(limited.status, 429);
        assert.equal((await limited.json()).message, 'rate_limit_exceeded');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling requires host token for host-only mutating routes', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const hostToken = String(created.payload?.hostToken || '').trim();
        assert.equal(created.ok, true);
        assert.ok(hostToken.length > 0);
        assert.equal(created.payload?.sessionState?.hostReady, true);

        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        const playerId = String(joined.payload?.playerId || '').trim();
        const playerToken = String(joined.payload?.playerToken || '').trim();
        assert.equal(joined.ok, true);
        assert.ok(playerId.length > 0);
        assert.ok(playerToken.length > 0);

        const clientReady = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId,
            playerToken,
            ready: true,
        });
        assert.equal(clientReady.ok, true);

        const invalidateDenied = await postJson(lanServer.baseUrl, '/lobby/invalidate-ready', {
            hostPeerId: 'host',
        });
        assert.equal(invalidateDenied.ok, false);
        assert.equal(invalidateDenied.status, 403);
        assert.equal(invalidateDenied.payload?.message, 'host_auth_failed');

        const invalidateAllowed = await postJson(lanServer.baseUrl, '/lobby/invalidate-ready', {
            hostPeerId: 'host',
            hostToken,
        });
        assert.equal(invalidateAllowed.ok, true);
        assert.equal(invalidateAllowed.payload?.sessionState?.hostReady, true);
        assert.equal(invalidateAllowed.payload?.sessionState?.players?.[0]?.ready, false);

        const startDenied = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
        });
        assert.equal(startDenied.ok, false);
        assert.equal(startDenied.status, 403);
        assert.equal(startDenied.payload?.message, 'host_auth_failed');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling rejects join with missing or wrong lobby code', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        assert.equal(created.ok, true);

        const missingCode = await postJson(lanServer.baseUrl, '/lobby/join', {});
        assert.equal(missingCode.ok, false);
        assert.equal(missingCode.status, 404);

        const wrongCode = await postJson(lanServer.baseUrl, '/lobby/join', { lobbyCode: 'WRONGCODE' });
        assert.equal(wrongCode.ok, false);
        assert.equal(wrongCode.status, 404);
        assert.equal(wrongCode.payload?.message, 'lobby_not_found');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling requires tokens on signaling and ack-pending routes', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const hostToken = String(created.payload?.hostToken || '');
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        const playerId = String(joined.payload?.playerId || '');
        const playerToken = String(joined.payload?.playerToken || '');

        const offerNoToken = await postJson(lanServer.baseUrl, '/signaling/offer', {
            targetPlayerId: playerId,
            offer: { type: 'offer' },
        });
        assert.equal(offerNoToken.status, 403);

        const offerWithToken = await postJson(lanServer.baseUrl, '/signaling/offer', {
            targetPlayerId: playerId,
            offer: { type: 'offer', sdp: 'x' },
            hostToken,
        });
        assert.equal(offerWithToken.ok, true);

        const offerGetNoToken = await fetch(`${lanServer.baseUrl}/signaling/offer?playerId=${playerId}`);
        assert.equal(offerGetNoToken.status, 403);

        const offerGetWithToken = await fetch(
            `${lanServer.baseUrl}/signaling/offer?playerId=${playerId}&token=${playerToken}`
        );
        const offerPayload = await offerGetWithToken.json();
        assert.equal(offerGetWithToken.status, 200);
        assert.equal(offerPayload?.offer?.sdp, 'x');

        const answerNoToken = await postJson(lanServer.baseUrl, '/signaling/answer', {
            playerId,
            answer: { type: 'answer' },
        });
        assert.equal(answerNoToken.status, 403);

        const answerWithToken = await postJson(lanServer.baseUrl, '/signaling/answer', {
            playerId,
            playerToken,
            answer: { type: 'answer' },
        });
        assert.equal(answerWithToken.ok, true);

        const answerGetNoToken = await fetch(`${lanServer.baseUrl}/signaling/answer?playerId=${playerId}`);
        assert.equal(answerGetNoToken.status, 403);

        const answerGetWithToken = await fetch(
            `${lanServer.baseUrl}/signaling/answer?playerId=${playerId}&token=${hostToken}`
        );
        assert.equal(answerGetWithToken.status, 200);

        const iceNoToken = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId,
            targetPlayerId: 'host',
            candidate: { candidate: 'c' },
        });
        assert.equal(iceNoToken.status, 403);

        const iceWithToken = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId,
            token: playerToken,
            targetPlayerId: 'host',
            candidate: { candidate: 'c' },
        });
        assert.equal(iceWithToken.ok, true);

        const iceGetNoToken = await fetch(`${lanServer.baseUrl}/signaling/ice?playerId=host`);
        assert.equal(iceGetNoToken.status, 403);

        const ackNoToken = await postJson(lanServer.baseUrl, '/lobby/ack-pending', { playerId });
        assert.equal(ackNoToken.status, 403);

        const ackWithToken = await postJson(lanServer.baseUrl, '/lobby/ack-pending', {
            playerId,
            hostToken,
        });
        assert.equal(ackWithToken.ok, true);
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling counts the status poll as liveness and offers rejoin leases after ghost cleanup', async () => {
    let currentTime = 1_000_000;
    const lanServer = await startLanServer({
        now: () => currentTime,
        ghostPlayerTimeoutMs: 1_000,
        ghostCleanupIntervalMs: 0,
        reconnectLeaseMs: 60_000,
    });
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const hostToken = String(created.payload?.hostToken || '');
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        const playerId = String(joined.payload?.playerId || '');
        const playerToken = String(joined.payload?.playerToken || '');

        // Player idles past the ghost timeout, but keeps polling the status route.
        currentTime += 900;
        const polled = await fetch(statusUrl(lanServer.baseUrl, playerId, playerToken));
        assert.equal(polled.status, 200);
        currentTime += 900;
        lanServer.cleanupGhostPlayers();
        const statusAfterPoll = await (await fetch(statusUrl(lanServer.baseUrl, 'host', hostToken))).json();
        assert.equal(statusAfterPoll.players.length, 1, 'status poll must count as liveness');

        // Without any liveness signal the player is ghost-cleaned...
        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();
        const statusAfterGhost = await (await fetch(statusUrl(lanServer.baseUrl, 'host', hostToken))).json();
        assert.equal(statusAfterGhost.players.length, 0);

        // ...but can rejoin with the SAME playerId via the reconnect lease.
        const rejoinWrongToken = await postJson(lanServer.baseUrl, '/lobby/rejoin', {
            playerId,
            playerToken: 'wrong',
        });
        assert.equal(rejoinWrongToken.status, 403);

        const rejoined = await postJson(lanServer.baseUrl, '/lobby/rejoin', {
            playerId,
            playerToken,
        });
        assert.equal(rejoined.ok, true);
        assert.equal(rejoined.payload?.playerId, playerId);
        const statusAfterRejoin = await (await fetch(statusUrl(lanServer.baseUrl, playerId, playerToken))).json();
        assert.equal(statusAfterRejoin.players.length, 1);
        assert.deepEqual(statusAfterRejoin.pendingPlayers, [{ playerId }]);
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling requires player token for player mutating routes', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const lobbyCode = String(created.payload?.lobbyCode || '').trim();
        assert.equal(created.ok, true);

        const joined = await postJson(lanServer.baseUrl, '/lobby/join', { lobbyCode });
        const playerId = String(joined.payload?.playerId || '').trim();
        const playerToken = String(joined.payload?.playerToken || '').trim();
        assert.equal(joined.ok, true);
        assert.ok(playerId.length > 0);
        assert.ok(playerToken.length > 0);

        const readyDenied = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId,
            ready: true,
        });
        assert.equal(readyDenied.ok, false);
        assert.equal(readyDenied.status, 403);
        assert.equal(readyDenied.payload?.message, 'player_auth_failed');

        const readyAllowed = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId,
            playerToken,
            ready: true,
        });
        assert.equal(readyAllowed.ok, true);

        const leaveDenied = await postJson(lanServer.baseUrl, '/lobby/leave', {
            playerId,
        });
        assert.equal(leaveDenied.ok, false);
        assert.equal(leaveDenied.status, 403);
        assert.equal(leaveDenied.payload?.message, 'player_auth_failed');

        const leaveAllowed = await postJson(lanServer.baseUrl, '/lobby/leave', {
            playerId,
            playerToken,
        });
        assert.equal(leaveAllowed.ok, true);
    } finally {
        await stopLanServer(lanServer.server);
    }
});
