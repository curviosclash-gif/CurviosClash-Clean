import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createSignalingServer } from '../server/signaling-server.js';

const signalingSource = readFileSync(new URL('../server/signaling-server.js', import.meta.url), 'utf8');

async function stopServer(wss) {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
}

function openClient(url) {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    return socket;
}

test('an over-limit connection still has an error listener before it is closed', async (t) => {
    const wss = createSignalingServer(0, { maxConnectionsPerIp: 2, unassignedSocketTimeoutMs: 60_000 });
    t.after(() => stopServer(wss));
    if (!wss.address()) await once(wss, 'listening');
    const url = `ws://127.0.0.1:${wss.address().port}`;
    const serverSockets = [];
    wss.on('connection', (ws) => serverSockets.push(ws));

    const accepted = [openClient(url), openClient(url)];
    await Promise.all(accepted.map((socket) => once(socket, 'open')));
    const rejected = openClient(url);
    const [closeCode, closeReason] = await once(rejected, 'close');

    assert.equal(closeCode, 1008);
    assert.equal(String(closeReason), 'connection_limit_exceeded');
    assert.equal(serverSockets.length, 3);

    const overLimitSocket = serverSockets[2];
    // ws 8.x forwards receiver failures (oversized or malformed frames) through
    // websocket.emit('error'); without a listener that call throws and, inside the
    // socket data handler, tears down the whole signaling process.
    assert.ok(
        overLimitSocket.listenerCount('error') > 0,
        'the over-limit socket must carry an error listener'
    );
    assert.doesNotThrow(() => overLimitSocket.emit('error', new Error('simulated frame failure')));

    assert.equal(accepted[0].readyState, WebSocket.OPEN);
    assert.equal(accepted[1].readyState, WebSocket.OPEN);

    for (const socket of [...accepted, rejected]) socket.close();
});

test('the connection handler attaches its error listener before any early close path', () => {
    const handlerIndex = signalingSource.indexOf("wss.on('connection'");
    assert.ok(handlerIndex > 0, 'connection handler not found');
    const handlerSource = signalingSource.slice(handlerIndex);
    const errorListenerIndex = handlerSource.indexOf("ws.on('error'");
    const firstPolicyCloseIndex = handlerSource.indexOf('ws.close(1008');
    assert.ok(errorListenerIndex > 0, 'no error listener registered on the connection socket');
    assert.ok(firstPolicyCloseIndex > 0, 'no policy close found in the connection handler');
    assert.ok(
        errorListenerIndex < firstPolicyCloseIndex,
        'ws.on(\'error\') must be registered before the first close(1008)+return path'
    );
});
