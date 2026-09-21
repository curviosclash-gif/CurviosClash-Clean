import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createSignalingServer } from '../server/signaling-server.js';
import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';

const MESSAGE_TIMEOUT_MS = 2_000;

function delay(ms = 20) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createClient(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    const queuedMessages = [];
    const waiters = [];

    socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
        if (waiterIndex < 0) {
            queuedMessages.push(message);
            return;
        }
        const [waiter] = waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
    });

    return {
        socket,
        send(type, payload = null) {
            socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
        },
        next(type) {
            const messageIndex = queuedMessages.findIndex((message) => message.type === type);
            if (messageIndex >= 0) {
                return Promise.resolve(queuedMessages.splice(messageIndex, 1)[0]);
            }
            return new Promise((resolve, reject) => {
                const waiter = { type, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    const waiterIndex = waiters.indexOf(waiter);
                    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
                    reject(new Error(`Timed out waiting for signaling message '${type}'`));
                }, MESSAGE_TIMEOUT_MS);
                waiters.push(waiter);
            });
        },
    };
}

function waitForClose(socket) {
    return new Promise((resolve) => {
        socket.once('error', () => {});
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
}

async function createTestServer(options = {}) {
    const wss = createSignalingServer(0, options);
    if (!wss.address()) await once(wss, 'listening');
    return {
        wss,
        url: `ws://127.0.0.1:${wss.address().port}`,
    };
}

async function closeTestServer(wss) {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
}

async function createLobbyPair(url, { maxPlayers = 4 } = {}) {
    const host = await createClient(url);
    host.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers });
    const created = await host.next(SIGNALING_EVENT_TYPES.LOBBY_CREATED);
    const client = await createClient(url);
    client.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode });
    const joined = await client.next(SIGNALING_EVENT_TYPES.LOBBY_JOINED);
    const joinedBroadcast = await host.next(SIGNALING_EVENT_TYPES.PLAYER_JOINED);
    return { host, client, created, joined, joinedBroadcast };
}

test('online signaling requires the private session token for transport attach', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { created, joined, joinedBroadcast } = await createLobbyPair(url);
        assert.ok(created.sessionToken.length >= 43);
        assert.ok(joined.sessionToken.length >= 43);
        assert.notEqual(created.sessionToken, joined.sessionToken);
        assert.equal(JSON.stringify(created.sessionState).includes(created.sessionToken), false);
        assert.equal(JSON.stringify(joinedBroadcast).includes(joined.sessionToken), false);

        const attacker = await createClient(url);
        attacker.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: created.playerId,
        });
        assert.equal((await attacker.next(SIGNALING_EVENT_TYPES.ERROR)).message, 'Transport attach failed');
        attacker.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: created.playerId,
            sessionToken: 'wrong-token',
        });
        assert.equal((await attacker.next(SIGNALING_EVENT_TYPES.ERROR)).message, 'Transport attach failed');

        const hostTransport = await createClient(url);
        hostTransport.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: created.playerId,
            sessionToken: created.sessionToken,
        });
        const attached = await hostTransport.next(SIGNALING_EVENT_TYPES.TRANSPORT_ATTACHED);
        assert.equal(attached.isHost, true);

        attacker.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: created.playerId,
            sessionToken: joined.sessionToken,
        });
        await attacker.next(SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(hostTransport.socket.readyState, WebSocket.OPEN);

        const clientTransport = await createClient(url);
        clientTransport.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        await clientTransport.next(SIGNALING_EVENT_TYPES.TRANSPORT_ATTACHED);
        const notification = await hostTransport.next(SIGNALING_EVENT_TYPES.PLAYER_TRANSPORT_ATTACHED);
        assert.equal(notification.peerId, joined.playerId);
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling rejects missing or wrong resume tokens and accepts the correct token', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { host, client, created, joined } = await createLobbyPair(url);
        client.socket.terminate();
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);

        const attacker = await createClient(url);
        attacker.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
        });
        assert.equal((await attacker.next(SIGNALING_EVENT_TYPES.ERROR)).message, 'Connection resume failed');
        attacker.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: 'wrong-token',
        });
        assert.equal((await attacker.next(SIGNALING_EVENT_TYPES.ERROR)).message, 'Connection resume failed');

        const resumedClient = await createClient(url);
        resumedClient.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        const resumed = await resumedClient.next(SIGNALING_EVENT_TYPES.CONNECTION_RESUMED);
        assert.equal(resumed.playerId, joined.playerId);
        assert.equal(resumed.sessionToken, joined.sessionToken);
        assert.equal(JSON.stringify(resumed.sessionState).includes(joined.sessionToken), false);
    } finally {
        await closeTestServer(wss);
    }
});

test('online resume clears a leased ready state after settings change', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { host, client, created, joined } = await createLobbyPair(url);
        client.send(SIGNALING_COMMAND_TYPES.READY, { ready: true, settingsRevision: 1 });
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_READY);

        client.socket.terminate();
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);
        host.send(SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, {
            metadata: { mapKey: 'maze' },
        });
        const updated = await host.next(SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
        assert.equal(updated.sessionState.settingsRevision, 2);

        const resumedClient = await createClient(url);
        resumedClient.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        const resumed = await resumedClient.next(SIGNALING_EVENT_TYPES.CONNECTION_RESUMED);
        const resumedPlayer = resumed.sessionState.players.find(
            (player) => player.playerId === joined.playerId
        );
        assert.equal(resumedPlayer?.ready, false);

        resumedClient.send(SIGNALING_COMMAND_TYPES.READY, { ready: true, settingsRevision: 2 });
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_READY);
        resumedClient.socket.terminate();
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);

        const sameRevisionClient = await createClient(url);
        sameRevisionClient.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        const sameRevisionResume = await sameRevisionClient.next(SIGNALING_EVENT_TYPES.CONNECTION_RESUMED);
        const sameRevisionPlayer = sameRevisionResume.sessionState.players.find(
            (player) => player.playerId === joined.playerId
        );
        assert.equal(sameRevisionPlayer?.ready, true);
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling rejects new joins while a match start is pending', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { host, client, created } = await createLobbyPair(url, { maxPlayers: 3 });
        client.send(SIGNALING_COMMAND_TYPES.READY, { ready: true, settingsRevision: 1 });
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_READY);
        host.send(SIGNALING_COMMAND_TYPES.START_MATCH, { settingsRevision: 1 });
        await host.next(SIGNALING_EVENT_TYPES.MATCH_START);

        const lateClient = await createClient(url);
        lateClient.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode });
        const error = await lateClient.next(SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(error.code, 'match_start_pending');
    } finally {
        await closeTestServer(wss);
    }
});

test('online resume cannot exceed the lobby player limit', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { host, client, created, joined } = await createLobbyPair(url, { maxPlayers: 2 });
        client.socket.terminate();
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);

        const replacement = await createClient(url);
        replacement.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode });
        await replacement.next(SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_JOINED);

        const resumedClient = await createClient(url);
        resumedClient.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        const error = await resumedClient.next(SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(error.code, 'lobby_full');
    } finally {
        await closeTestServer(wss);
    }
});

test('leave and lobby cleanup invalidate issued session tokens', async () => {
    const { wss, url } = await createTestServer();
    try {
        const { host, client, created, joined } = await createLobbyPair(url);
        client.send(SIGNALING_COMMAND_TYPES.LEAVE);
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);

        const leftClient = await createClient(url);
        leftClient.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        await leftClient.next(SIGNALING_EVENT_TYPES.ERROR);
        leftClient.send(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
            lobbyCode: created.lobbyCode,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
        });
        await leftClient.next(SIGNALING_EVENT_TYPES.ERROR);

        const reconnectingClient = await createClient(url);
        reconnectingClient.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode });
        const reconnectingJoin = await reconnectingClient.next(SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_JOINED);
        reconnectingClient.socket.terminate();
        await host.next(SIGNALING_EVENT_TYPES.PLAYER_LEFT);
        host.send(SIGNALING_COMMAND_TYPES.LEAVE);
        await delay();

        const afterCleanup = await createClient(url);
        afterCleanup.send(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
            lobbyCode: created.lobbyCode,
            playerId: reconnectingJoin.playerId,
            sessionToken: reconnectingJoin.sessionToken,
        });
        await afterCleanup.next(SIGNALING_EVENT_TYPES.ERROR);
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling bounds per-socket message rate', async () => {
    const { wss, url } = await createTestServer();
    try {
        const flooding = new WebSocket(url);
        await once(flooding, 'open');
        const floodingClosed = waitForClose(flooding);
        for (let index = 0; index <= 120; index += 1) {
            flooding.send('{}');
        }
        const floodResult = await floodingClosed;
        assert.equal(floodResult.code, 1008);
        assert.equal(floodResult.reason, 'rate_limit_exceeded');
    } finally {
        await closeTestServer(wss);
    }
});

// Vorher stand hier ein Textvergleich auf den Quelltext des Servers. Der haette auch
// dann bestanden, wenn die Zaehlung falsch ist — geprueft wurde nur, dass die Konstante
// im Code vorkommt. Die Grenzen sind jetzt einstellbar, damit ihr Greifen messbar wird.
test('online signaling cuts a socket that exceeds the per-IP message budget', async () => {
    const { wss, url } = await createTestServer({ maxMessagesPerIp: 3, maxMessagesPerSocket: 999 });
    try {
        const client = await createClient(url);
        const closed = waitForClose(client.socket);

        for (let index = 0; index < 5; index++) {
            client.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });
            await delay(5);
        }

        assert.equal((await closed).code, 1008, 'the socket is closed with the policy-violation code');
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling refuses a new lobby once the global capacity is reached', async () => {
    const { wss, url } = await createTestServer({ maxLobbies: 1, maxLobbiesPerIp: 10 });
    try {
        const first = await createClient(url);
        first.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });
        await first.next(SIGNALING_EVENT_TYPES.LOBBY_CREATED);

        const second = await createClient(url);
        second.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });

        assert.equal((await second.next(SIGNALING_EVENT_TYPES.ERROR)).message, 'Lobby capacity reached');
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling keeps serving lobbies below the capacity', async () => {
    const { wss, url } = await createTestServer({ maxLobbies: 2, maxLobbiesPerIp: 10 });
    try {
        const first = await createClient(url);
        first.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });
        const firstCreated = await first.next(SIGNALING_EVENT_TYPES.LOBBY_CREATED);

        const second = await createClient(url);
        second.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });
        const secondCreated = await second.next(SIGNALING_EVENT_TYPES.LOBBY_CREATED);

        assert.notEqual(secondCreated.lobbyCode, firstCreated.lobbyCode);
    } finally {
        await closeTestServer(wss);
    }
});

test('online signaling releases expired lobby sockets and server-owned lobby codes', () => {
    const source = readFileSync(new URL('../server/signaling-server.js', import.meta.url), 'utf8');
    assert.match(source, /player\.ws\.close\(1001, closeMessage\)/);
    assert.match(source, /player\.transportWs\.close\(1001, closeMessage\)/);
    assert.match(source, /serverLobbyCodes\.delete\(code\)/);
    assert.match(source, /lobby\.serverLobbyCodes\?\.delete\(lobbyCode\)/);
});

test('OnlineSessionAdapter clears a closed signaling socket before publishing disconnect', () => {
    const source = readFileSync(new URL('../src/network/OnlineSessionAdapter.js', import.meta.url), 'utf8');
    assert.match(source, /socket\.onclose = \(event\) => \{\s*if \(this\._ws !== socket\) return;\s*this\._ws = null;/);
});

test('OnlineSessionAdapter retains the server token and sends it on resume', async () => {
    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://localhost:1' });
    adapter._latencyMonitor.start = () => {};
    await new Promise((resolve, reject) => {
        adapter._handleSignalingMessage({
            type: SIGNALING_EVENT_TYPES.LOBBY_CREATED,
            lobbyCode: 'TOKEN-LOBBY',
            playerId: 'host-player',
            sessionToken: 'server-issued-session-token',
        }, resolve, reject);
    });

    let sentMessage = null;
    adapter._sendSignaling = (message) => { sentMessage = message; };
    adapter._socketAttempt = (onOpen) => {
        onOpen();
        return Promise.resolve();
    };
    await adapter._reconnectSingleAttempt();
    assert.equal(sentMessage.type, SIGNALING_COMMAND_TYPES.RESUME_CONNECTION);
    assert.equal(sentMessage.sessionToken, 'server-issued-session-token');
    adapter.dispose();
    assert.equal(adapter._sessionToken, '');
});
