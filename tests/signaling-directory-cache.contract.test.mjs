import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../server/signaling-server.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';

async function openClient(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return socket;
}

function nextMessage(socket, type) {
    return new Promise((resolve) => {
        const handler = (raw) => {
            const message = JSON.parse(String(raw));
            if (message.type !== type) return;
            socket.off('message', handler);
            resolve({ message, raw: String(raw) });
        };
        socket.on('message', handler);
    });
}

async function request(socket, type, payload, expectedType) {
    const response = nextMessage(socket, expectedType);
    socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
    return response;
}

async function list(url) {
    const socket = await openClient(url);
    try {
        return (await request(socket, SIGNALING_COMMAND_TYPES.LIST_LOBBIES, null, SIGNALING_EVENT_TYPES.LOBBY_LIST)).message.lobbies;
    } finally {
        socket.close();
    }
}

async function stop(server) {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
}

test('directory cache invalidates immediately across create, full, and leave transitions', async () => {
    const server = createSignalingServer(0);
    if (!server.address()) await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const host = await openClient(url);
    const client = await openClient(url);
    try {
        const created = (await request(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
            maxPlayers: 2,
            metadata: { hostName: 'Host', mapKey: 'standard', gameMode: 'CLASSIC' },
        }, SIGNALING_EVENT_TYPES.LOBBY_CREATED)).message;
        assert.equal((await list(url)).length, 1);
        assert.equal((await list(url)).length, 1);
        await request(client, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
            lobbyCode: created.lobbyCode,
            name: 'Client',
        }, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        assert.deepEqual(await list(url), []);
        const left = nextMessage(host, SIGNALING_EVENT_TYPES.PLAYER_LEFT);
        client.send(JSON.stringify(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.LEAVE)));
        await left;
        assert.equal((await list(url))[0].lobbyCode, created.lobbyCode);
        const metrics = server.getMetrics();
        assert.equal(metrics.directoryRequests, 4);
        assert.equal(metrics.directoryCacheHits, 1);
        assert.equal(metrics.directoryRebuilds, 3);
    } finally {
        host.close();
        client.close();
        await stop(server);
    }
});

test('lobby broadcasts serialize once and send byte-identical payloads to recipients', async () => {
    const server = createSignalingServer(0);
    if (!server.address()) await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const host = await openClient(url);
    const first = await openClient(url);
    const second = await openClient(url);
    try {
        const created = (await request(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 3 }, SIGNALING_EVENT_TYPES.LOBBY_CREATED)).message;
        await request(first, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode }, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        await request(second, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode }, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        const hostUpdate = nextMessage(host, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
        const firstUpdate = nextMessage(first, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
        const secondUpdate = nextMessage(second, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
        const before = server.getMetrics();
        host.send(JSON.stringify(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, {
            metadata: { hostName: 'Host', mapKey: 'maze', gameMode: 'CLASSIC' },
        })));
        const updates = await Promise.all([hostUpdate, firstUpdate, secondUpdate]);
        assert.equal(updates[0].raw, updates[1].raw);
        assert.equal(updates[1].raw, updates[2].raw);
        const after = server.getMetrics();
        assert.equal(after.txMessages - before.txMessages, 3);
        assert.equal(after.jsonSerializations - before.jsonSerializations, 1);
    } finally {
        host.close();
        first.close();
        second.close();
        await stop(server);
    }
});
