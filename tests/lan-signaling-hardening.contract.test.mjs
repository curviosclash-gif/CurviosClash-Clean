import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { selectJoinSignalingUrlFromDiscoveredHosts } from '../src/application/session-runtime/NetworkLobbyDiscoveryResolver.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import {
    MOBILE_LAN_PARTICIPANT_SURFACE_ID,
    MULTIPLAYER_PROTOCOL_VERSION,
} from '../src/shared/contracts/SignalingSessionContract.js';

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

function sendRawHttpRequest(port, request) {
    return new Promise((resolve, reject) => {
        let response = '';
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setEncoding('utf8');
        socket.setTimeout(2_000, () => socket.destroy(new Error('raw HTTP request timed out')));
        socket.on('connect', () => socket.end(request));
        socket.on('data', (chunk) => { response += chunk; });
        socket.on('end', () => resolve(response));
        socket.on('error', reject);
    });
}

test('LAN signaling rejects malformed request URLs without terminating the server', async () => {
    const source = [
        "import { createLANSignalingServer } from './server/lan-signaling.js';",
        'const bundle = createLANSignalingServer(0, { ghostCleanupIntervalMs: 0 });',
        "bundle.server.once('listening', () => console.log(`ACTUAL_PORT=${bundle.server.address().port}`));",
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    try {
        const port = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`LAN child did not listen: ${stderr}`)), 2_000);
            child.stdout.on('data', () => {
                const match = stdout.match(/ACTUAL_PORT=(\d+)/);
                if (!match) return;
                clearTimeout(timeout);
                resolve(Number(match[1]));
            });
        });
        const malformed = await sendRawHttpRequest(
            port,
            'GET // HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
        );
        assert.match(malformed, /^HTTP\/1\.1 400 /, stderr);

        const probe = await sendRawHttpRequest(
            port,
            'GET /discovery/info HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
        );
        assert.match(probe, /^HTTP\/1\.1 200 /, stderr);
        assert.equal(child.exitCode, null, stderr);
    } finally {
        if (child.exitCode === null) child.kill();
    }
});

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

        const capacitorOrigin = 'http://localhost';
        const capacitorPreflight = await fetch(`${lanServer.baseUrl}/lobby/status`, {
            method: 'OPTIONS',
            headers: { Origin: capacitorOrigin },
        });
        assert.equal(capacitorPreflight.status, 200);
        assert.equal(capacitorPreflight.headers.get('access-control-allow-origin'), capacitorOrigin);
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

test('LAN signaling counts host split-screen seats for capacity, state, discovery, and match start', async () => {
    const lanServer = await startLanServer();
    const lobby = new LANMatchLobby({
        signalingUrl: lanServer.baseUrl,
        pollIntervalMs: 60_000,
    });
    try {
        await lobby.create({
            maxPlayers: 2,
            localPlayerCount: 8,
        });
        assert.equal(lobby.sessionState.localPlayerCount, 2);
        assert.equal(lobby.sessionState.memberCount, 1);
        assert.equal(lobby.sessionState.playerCount, 2);

        const status = await (await fetch(statusUrl(lanServer.baseUrl, 'host', lobby.getLocalPeerToken()))).json();
        assert.equal(status.sessionState.memberCount, 1);
        assert.equal(status.sessionState.playerCount, 2);

        const discovery = await (await fetch(`${lanServer.baseUrl}/discovery/info`)).json();
        assert.equal(discovery.playerCount, 2);

        const rejectedJoin = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: lobby.lobbyCode,
        });
        assert.equal(rejectedJoin.status, 409);
        assert.equal(rejectedJoin.payload.message, 'lobby_full');

        const started = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: lobby.getLocalPeerToken(),
            commandId: 'host-split-screen',
        });
        assert.equal(started.ok, true);
    } finally {
        lobby.leave();
        await stopLanServer(lanServer.server);
    }
});

test('LAN discovery publishes host-inclusive counts and current lobby metadata', async () => {
    const lanServer = await startLanServer();
    const lobby = new LANMatchLobby({
        signalingUrl: lanServer.baseUrl,
        pollIntervalMs: 60_000,
    });
    try {
        await lobby.create({
            maxPlayers: 4,
            actorId: 'Captain',
            name: 'Captain',
            metadata: {
                hostName: 'Captain',
                mapKey: 'maze',
                gameMode: 'HUNT',
                modePath: 'fight',
                winsNeeded: 7,
            },
        });

        const initialDiscovery = await (
            await fetch(`${lanServer.baseUrl}/discovery/info`)
        ).json();
        assert.equal(initialDiscovery.playerCount, 1);
        assert.equal(initialDiscovery.maxPlayers, 4);
        // Without a chosen lobby name the host shows up as "<profile name> <seat>".
        assert.equal(initialDiscovery.hostName, 'Captain 1');
        assert.equal(initialDiscovery.mapKey, 'maze');
        assert.equal(initialDiscovery.gameMode, 'HUNT');
        assert.equal(initialDiscovery.modePath, 'fight');
        assert.equal(initialDiscovery.winsNeeded, 7);

        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: lobby.lobbyCode,
            actorId: 'Wingman',
        });
        assert.equal(joined.ok, true);
        const joinedDiscovery = await (
            await fetch(`${lanServer.baseUrl}/discovery/info`)
        ).json();
        assert.equal(joinedDiscovery.playerCount, 2);

        await lobby.updateSettings({
            metadata: {
                hostName: 'Captain',
                mapKey: 'city',
                gameMode: 'ARCADE',
                modePath: 'normal',
                winsNeeded: 3,
            },
        });
        const updatedDiscovery = await (
            await fetch(`${lanServer.baseUrl}/discovery/info`)
        ).json();
        assert.equal(updatedDiscovery.mapKey, 'city');
        assert.equal(updatedDiscovery.gameMode, 'ARCADE');
        assert.equal(updatedDiscovery.modePath, 'normal');
        assert.equal(updatedDiscovery.winsNeeded, 3);
    } finally {
        lobby.leave();
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

test('LAN signaling accepts a second match after the start command retention window', async () => {
    let currentTime = 1_000_000;
    const lanServer = await startLanServer({
        now: () => currentTime,
        ghostCleanupIntervalMs: 0,
    });
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

        currentTime += 2_500;
        const second = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            commandId: 'match-second',
        });

        assert.equal(first.ok, true);
        assert.equal(second.ok, true);
        assert.equal(second.payload.pendingMatchStart.commandId, 'match-second');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling rejects new joins while a match start is pending', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 3 });
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
        });
        await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId: joined.payload.playerId,
            playerToken: joined.payload.playerToken,
            ready: true,
        });
        await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
        });

        const lateJoin = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
        });
        assert.equal(lateJoin.status, 409);
        assert.equal(lateJoin.payload?.message, 'match_start_pending');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN rejoin cannot exceed the lobby player limit', async () => {
    let currentTime = 1_000_000;
    const lanServer = await startLanServer({
        now: () => currentTime,
        ghostPlayerTimeoutMs: 1_000,
        ghostCleanupIntervalMs: 0,
        reconnectLeaseMs: 60_000,
    });
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 2 });
        const firstJoin = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
        });
        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();
        const replacement = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
        });
        assert.equal(replacement.ok, true);

        const overLimitRejoin = await postJson(lanServer.baseUrl, '/lobby/rejoin', {
            playerId: firstJoin.payload.playerId,
            playerToken: firstJoin.payload.playerToken,
        });
        assert.equal(overLimitRejoin.status, 409);
        assert.equal(overLimitRejoin.payload?.message, 'lobby_full');
    } finally {
        await stopLanServer(lanServer.server);
    }
});

test('LAN signaling gates mobile Ready and Start on the crossplay compatibility contract', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', {
            maxPlayers: 2,
            metadata: {
                mapKey: 'standard',
                gameMode: 'CLASSIC',
                modePath: 'normal',
                protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
            },
        });
        const outdatedClient = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
            actorId: 'Old Android',
            participantMetadata: {
                productSurfaceId: MOBILE_LAN_PARTICIPANT_SURFACE_ID,
                protocolVersion: 'curvios-multiplayer.v0',
            },
        });
        const outdatedReady = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId: outdatedClient.payload.playerId,
            playerToken: outdatedClient.payload.playerToken,
            ready: true,
        });
        assert.equal(outdatedReady.status, 409);
        assert.equal(outdatedReady.payload.message, 'mobile_protocol_incompatible');
        await postJson(lanServer.baseUrl, '/lobby/leave', {
            playerId: outdatedClient.payload.playerId,
            playerToken: outdatedClient.payload.playerToken,
        });

        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload.lobbyCode,
            actorId: 'Android',
            participantMetadata: {
                productSurfaceId: MOBILE_LAN_PARTICIPANT_SURFACE_ID,
                protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
            },
        });
        const readyBody = {
            playerId: joined.payload.playerId,
            playerToken: joined.payload.playerToken,
            ready: true,
        };
        assert.equal((await postJson(lanServer.baseUrl, '/lobby/ready', readyBody)).ok, true);

        await postJson(lanServer.baseUrl, '/lobby/metadata', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            metadata: {
                mapKey: 'city',
                gameMode: 'CLASSIC',
                modePath: 'normal',
                protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
            },
        });
        const incompatibleReady = await postJson(lanServer.baseUrl, '/lobby/ready', readyBody);
        assert.equal(incompatibleReady.status, 409);
        assert.equal(incompatibleReady.payload.message, 'mobile_map_incompatible');

        await postJson(lanServer.baseUrl, '/lobby/metadata', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            metadata: {
                mapKey: 'maze',
                gameMode: 'CLASSIC',
                modePath: 'normal',
                protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
            },
        });
        assert.equal((await postJson(lanServer.baseUrl, '/lobby/ready', readyBody)).ok, true);

        const incompatibleStart = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            settingsSnapshot: {
                gameMode: 'CLASSIC',
                mapKey: 'city',
                localSettings: {
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'lan',
                    modePath: 'normal',
                },
            },
        });
        assert.equal(incompatibleStart.status, 409);
        assert.equal(incompatibleStart.payload.message, 'mobile_map_incompatible');

        const staleReadyStart = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            settingsSnapshot: {
                gameMode: 'CLASSIC',
                mapKey: 'standard',
                localSettings: {
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'lan',
                    modePath: 'normal',
                },
            },
        });
        assert.equal(staleReadyStart.status, 409);
        assert.equal(staleReadyStart.payload.message, 'mobile_settings_mismatch');

        const compatibleStart = await postJson(lanServer.baseUrl, '/lobby/match-start', {
            hostPeerId: 'host',
            hostToken: created.payload.hostToken,
            settingsSnapshot: {
                gameMode: 'CLASSIC',
                mapKey: 'maze',
                localSettings: {
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'lan',
                    modePath: 'normal',
                },
            },
        });
        assert.equal(compatibleStart.ok, true);
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

        const metadataDenied = await postJson(lanServer.baseUrl, '/lobby/metadata', {
            hostPeerId: 'host',
            metadata: { mapKey: 'city' },
        });
        assert.equal(metadataDenied.ok, false);
        assert.equal(metadataDenied.status, 403);
        assert.equal(metadataDenied.payload?.message, 'host_auth_failed');

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

test('LAN signaling bounds ICE queues to valid host-client routes', async () => {
    const lanServer = await startLanServer();
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 3 });
        const lobbyCode = String(created.payload?.lobbyCode || '');
        const firstJoin = await postJson(lanServer.baseUrl, '/lobby/join', { lobbyCode });
        const secondJoin = await postJson(lanServer.baseUrl, '/lobby/join', { lobbyCode });
        const firstPlayerId = String(firstJoin.payload?.playerId || '');
        const firstPlayerToken = String(firstJoin.payload?.playerToken || '');
        const secondPlayerId = String(secondJoin.payload?.playerId || '');
        const secondPlayerToken = String(secondJoin.payload?.playerToken || '');

        const unknownTarget = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId: firstPlayerId,
            token: firstPlayerToken,
            targetPlayerId: 'not-a-lobby-member',
            candidate: { candidate: 'unknown-target' },
        });
        assert.equal(unknownTarget.status, 403);
        assert.equal(unknownTarget.payload?.message, 'signaling_route_invalid');
        assert.equal(lanServer.lobby.ice.has('not-a-lobby-member'), false);

        const clientToClient = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId: firstPlayerId,
            token: firstPlayerToken,
            targetPlayerId: secondPlayerId,
            candidate: { candidate: 'client-to-client' },
        });
        assert.equal(clientToClient.status, 403);
        assert.equal(clientToClient.payload?.message, 'signaling_route_invalid');

        for (let index = 0; index < 200; index += 1) {
            const queued = await postJson(lanServer.baseUrl, '/signaling/ice', {
                playerId: firstPlayerId,
                token: firstPlayerToken,
                targetPlayerId: 'host',
                candidate: { candidate: `first-${index}` },
            });
            assert.equal(queued.ok, true, `candidate ${index} should fit the first route`);
        }

        const firstOverflow = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId: firstPlayerId,
            token: firstPlayerToken,
            targetPlayerId: 'host',
            candidate: { candidate: 'first-overflow' },
        });
        assert.equal(firstOverflow.status, 429);
        assert.equal(firstOverflow.payload?.message, 'ice_queue_full');

        const secondRoute = await postJson(lanServer.baseUrl, '/signaling/ice', {
            playerId: secondPlayerId,
            token: secondPlayerToken,
            targetPlayerId: 'host',
            candidate: { candidate: 'second-route' },
        });
        assert.equal(secondRoute.ok, true, 'one full route must not block another player');
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

test('LAN rejoin clears a leased ready state after settings change', async () => {
    let currentTime = 1_000_000;
    const lanServer = await startLanServer({
        now: () => currentTime,
        ghostPlayerTimeoutMs: 1_000,
        ghostCleanupIntervalMs: 0,
        reconnectLeaseMs: 60_000,
    });
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 3 });
        const lobbyCode = String(created.payload?.lobbyCode || '');
        const hostToken = String(created.payload?.hostToken || '');
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', { lobbyCode });
        const playerId = String(joined.payload?.playerId || '');
        const playerToken = String(joined.payload?.playerToken || '');

        const ready = await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId,
            playerToken,
            ready: true,
            settingsRevision: 1,
        });
        assert.equal(ready.ok, true);

        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();
        const updated = await postJson(lanServer.baseUrl, '/lobby/metadata', {
            hostPeerId: 'host',
            hostToken,
            metadata: { mapKey: 'maze' },
        });
        assert.equal(updated.payload?.sessionState?.settingsRevision, 2);

        const rejoined = await postJson(lanServer.baseUrl, '/lobby/rejoin', {
            playerId,
            playerToken,
        });
        const rejoinedPlayer = rejoined.payload?.sessionState?.players?.find(
            (player) => player.playerId === playerId
        );
        assert.equal(rejoined.ok, true);
        assert.equal(rejoinedPlayer?.ready, false);

        await postJson(lanServer.baseUrl, '/lobby/ready', {
            playerId,
            playerToken,
            ready: true,
            settingsRevision: 2,
        });
        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();
        const sameRevisionRejoin = await postJson(lanServer.baseUrl, '/lobby/rejoin', {
            playerId,
            playerToken,
        });
        const sameRevisionPlayer = sameRevisionRejoin.payload?.sessionState?.players?.find(
            (player) => player.playerId === playerId
        );
        assert.equal(sameRevisionPlayer?.ready, true);
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
