import assert from 'node:assert/strict';
import { once } from 'node:events';
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

async function createTestServer() {
    const wss = createSignalingServer(0);
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

async function createLobbyPair(url) {
    const host = await createClient(url);
    host.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 4 });
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
