import assert from 'node:assert/strict';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';

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

test('LAN signaling enforces maxPlayers on join requests', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 2 });
        assert.equal(created.ok, true);

        const joinedFirst = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        assert.equal(joinedFirst.ok, true);
        assert.ok(String(joinedFirst.payload?.playerId || '').startsWith('player-'));

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

test('LAN signaling requires host token for host-only mutating routes', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const hostToken = String(created.payload?.hostToken || '').trim();
        assert.equal(created.ok, true);
        assert.ok(hostToken.length > 0);

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

        const hostReady = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId: 'host',
            hostToken,
            ready: true,
        });
        assert.equal(hostReady.ok, true);

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
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
        });
        const playerId = String(joined.payload?.playerId || '');
        const playerToken = String(joined.payload?.playerToken || '');

        // Player idles past the ghost timeout, but keeps polling the status route.
        currentTime += 900;
        const polled = await fetch(`${lanServer.baseUrl}/lobby/status?playerId=${playerId}`);
        assert.equal(polled.status, 200);
        currentTime += 900;
        lanServer.cleanupGhostPlayers();
        const statusAfterPoll = await (await fetch(`${lanServer.baseUrl}/lobby/status`)).json();
        assert.equal(statusAfterPoll.players.length, 1, 'status poll must count as liveness');

        // Without any liveness signal the player is ghost-cleaned...
        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();
        const statusAfterGhost = await (await fetch(`${lanServer.baseUrl}/lobby/status`)).json();
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
        const statusAfterRejoin = await (await fetch(`${lanServer.baseUrl}/lobby/status`)).json();
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
