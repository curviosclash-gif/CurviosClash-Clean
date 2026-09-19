import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createSignalingServer } from '../server/signaling-server.js';
import { listOpenOnlineLobbies } from '../src/network/OnlineLobbyDirectoryClient.js';
import {
    createServerSignalingError,
    resolveOnlineSignalingUrl,
} from '../src/network/OnlineSignalingSupport.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';

async function startServer() {
    const wss = createSignalingServer(0);
    if (!wss.address()) await once(wss, 'listening');
    return {
        wss,
        url: `ws://127.0.0.1:${wss.address().port}`,
    };
}

async function stopServer(wss) {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
}

async function openClient(url) {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    await once(socket, 'open');
    return socket;
}

function sendAndReceive(socket, type, payload = null) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2_000);
        socket.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()));
        });
        socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
    });
}

test('online signaling errors keep stable codes and player-facing German messages', () => {
    const notFound = createServerSignalingError('lobby_not_found', 'Lobby not found');
    assert.equal(notFound.code, 'lobby_not_found');
    assert.equal(notFound.message, 'Lobby nicht gefunden.');
    assert.throws(
        () => resolveOnlineSignalingUrl(''),
        (error) => error.code === 'signaling_endpoint_missing'
            && !error.message.includes('VITE_SIGNALING_URL')
            && !error.message.includes('ws://')
    );
});

test('online signaling lists only joinable lobby summaries', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
            maxPlayers: 2,
            actorId: 'Captain',
            metadata: {
                hostName: 'Captain',
                mapKey: 'maze',
                gameMode: 'HUNT',
                modePath: 'fight',
                winsNeeded: 7,
            },
        });
        assert.equal(created.sessionState.members[0].actorId, 'Captain');

        const openLobbies = await listOpenOnlineLobbies(url, {
            WebSocketImpl: WebSocket,
            timeoutMs: 2_000,
        });
        assert.equal(openLobbies.length, 1);
        assert.deepEqual(Object.keys(openLobbies[0]).sort(), [
            'createdAt',
            'gameMode',
            'hostName',
            'lobbyCode',
            'mapKey',
            'maxPlayers',
            'memberCount',
            'modePath',
            'signalingUrl',
            'updatedAt',
            'winsNeeded',
        ]);
        assert.equal(openLobbies[0].lobbyCode, created.lobbyCode);
        assert.equal(openLobbies[0].memberCount, 1);
        assert.equal(openLobbies[0].maxPlayers, 2);
        assert.equal(openLobbies[0].hostName, 'Captain');
        assert.equal(openLobbies[0].mapKey, 'maze');
        assert.equal(openLobbies[0].signalingUrl, `${url}/`);

        const metadataUpdated = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, {
            metadata: { hostName: 'Admiral', mapKey: 'standard', gameMode: 'CLASSIC', modePath: 'normal' },
        });
        assert.equal(metadataUpdated.type, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
        const updatedLobbies = await listOpenOnlineLobbies(url, {
            WebSocketImpl: WebSocket,
            timeoutMs: 2_000,
            forceRefresh: true,
        });
        assert.equal(updatedLobbies[0].hostName, 'Admiral');

        const client = await openClient(url);
        const joined = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
            actorId: 'Wingman',
        });
        assert.equal(joined.sessionState.members.find((member) => member.peerId === joined.playerId)?.actorId, 'Wingman');
        const fullLobbyList = await listOpenOnlineLobbies(url, {
            WebSocketImpl: WebSocket,
            timeoutMs: 2_000,
            forceRefresh: true,
        });
        assert.deepEqual(fullLobbyList, []);
    } finally {
        await stopServer(wss);
    }
});

test('online signaling rejects a second lobby assignment on the same socket', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        assert.equal(created.type, SIGNALING_EVENT_TYPES.LOBBY_CREATED);

        const rejected = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        assert.equal(rejected.type, SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(rejected.code, 'socket_already_assigned');
        assert.equal(rejected.message, 'Socket already assigned to a lobby');

        const client = await openClient(url);
        const joined = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
        });
        assert.equal(joined.type, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        assert.equal(joined.lobbyCode, created.lobbyCode);
    } finally {
        await stopServer(wss);
    }
});

test('online signaling bounds joined player identity before storing and broadcasting it', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        const joinedEventPromise = once(host, 'message');
        const client = await openClient(url);
        const joined = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
            actorId: 'a'.repeat(500),
            name: { unsafe: true },
        });
        const [rawJoinedEvent] = await joinedEventPromise;
        const joinedEvent = JSON.parse(rawJoinedEvent.toString());
        const member = joined.sessionState.members.find((entry) => entry.peerId === joined.playerId);

        assert.equal(typeof member.actorId, 'string');
        assert.ok(member.actorId.length <= 128);
        assert.equal(typeof member.name, 'string');
        assert.ok(member.name.length <= 16);
        assert.equal(joinedEvent.type, SIGNALING_EVENT_TYPES.PLAYER_JOINED);
        assert.equal(joinedEvent.name, member.name);
    } finally {
        await stopServer(wss);
    }
});

test('online signaling normalizes invalid maxPlayers and enforces the ten-player cap', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
            maxPlayers: 'not-a-number',
        });
        assert.equal(created.maxPlayers, 10);

        for (let i = 0; i < 9; i += 1) {
            const client = await openClient(url);
            const joined = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
                lobbyCode: created.lobbyCode,
            });
            assert.equal(joined.type, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        }

        const overflowClient = await openClient(url);
        const rejected = await sendAndReceive(overflowClient, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
        });
        assert.equal(rejected.type, SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(rejected.code, 'lobby_full');
        assert.equal(rejected.message, 'Lobby full');
    } finally {
        await stopServer(wss);
    }
});

test('online match start is idempotent while a start command is pending', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2 });
        const client = await openClient(url);
        await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode });
        await sendAndReceive(client, SIGNALING_COMMAND_TYPES.READY, { ready: true });

        const first = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.START_MATCH, {
            commandId: 'match-first',
        });
        const duplicate = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.START_MATCH, {
            commandId: 'match-second',
        });
        assert.equal(first.type, SIGNALING_EVENT_TYPES.MATCH_START);
        assert.equal(duplicate.type, SIGNALING_EVENT_TYPES.MATCH_START);
        assert.equal(duplicate.pendingMatchStart.commandId, 'match-first');
    } finally {
        await stopServer(wss);
    }
});

test('online signaling closes oversized payloads without taking down the server', async () => {
    const { wss, url } = await startServer();
    try {
        const oversizedClient = await openClient(url);
        const closed = once(oversizedClient, 'close');
        oversizedClient.send(JSON.stringify({
            type: SIGNALING_COMMAND_TYPES.CREATE_LOBBY,
            padding: 'x'.repeat(20 * 1024),
        }));
        const [closeCode] = await closed;
        assert.equal(closeCode, 1009);

        const probeClient = await openClient(url);
        const created = await sendAndReceive(probeClient, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        assert.equal(created.type, SIGNALING_EVENT_TYPES.LOBBY_CREATED);
    } finally {
        await stopServer(wss);
    }
});

test('online signaling enforces host-client WebRTC relay roles', async () => {
    const { wss, url } = await startServer();
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        const client = await openClient(url);
        const joined = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
        });

        const clientOffer = await sendAndReceive(client, SIGNALING_COMMAND_TYPES.OFFER, {
            targetPeerId: created.playerId,
            offer: { type: 'offer' },
        });
        assert.equal(clientOffer.type, SIGNALING_EVENT_TYPES.ERROR);
        assert.equal(clientOffer.message, 'Signaling role violation');

        const hostAnswer = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.ANSWER, {
            targetPeerId: joined.playerId,
            answer: { type: 'answer' },
        });
        assert.equal(hostAnswer.type, SIGNALING_EVENT_TYPES.ERROR);
    } finally {
        await stopServer(wss);
    }
});

test('online signaling rejects unknown browser origins and accepts configured game origins', async () => {
    const wss = createSignalingServer(0, { allowedOrigins: ['https://game.example.test'] });
    if (!wss.address()) await once(wss, 'listening');
    const url = `ws://127.0.0.1:${wss.address().port}`;
    try {
        const blocked = new WebSocket(url, { origin: 'https://attacker.example' });
        blocked.on('error', () => {});
        await assert.rejects(once(blocked, 'open'), /Unexpected server response/);

        const allowed = new WebSocket(url, { origin: 'https://game.example.test' });
        await once(allowed, 'open');
        allowed.close();
    } finally {
        await stopServer(wss);
    }
});

test('online signaling caps active IP connections, IP lobbies, and idle sockets', async () => {
    const wss = createSignalingServer(0, {
        maxConnectionsPerIp: 2,
        maxLobbiesPerIp: 1,
        unassignedSocketTimeoutMs: 200,
    });
    if (!wss.address()) await once(wss, 'listening');
    const url = `ws://127.0.0.1:${wss.address().port}`;
    try {
        const host = await openClient(url);
        const created = await sendAndReceive(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        assert.equal(created.type, SIGNALING_EVENT_TYPES.LOBBY_CREATED);

        const second = await openClient(url);
        const rejectedLobby = await sendAndReceive(second, SIGNALING_COMMAND_TYPES.CREATE_LOBBY);
        assert.equal(rejectedLobby.message, 'IP lobby capacity reached');

        const excess = await openClient(url);
        const [limitCode] = await once(excess, 'close');
        assert.equal(limitCode, 1008);

        const [, idleReason] = await once(second, 'close');
        assert.equal(idleReason.toString(), 'lobby_assignment_timeout');
    } finally {
        await stopServer(wss);
    }
});
