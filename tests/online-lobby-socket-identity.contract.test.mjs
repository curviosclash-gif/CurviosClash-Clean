import assert from 'node:assert/strict';
import test from 'node:test';

import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';

test('a late close from a prior socket cannot affect the current lobby socket', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const sockets = [];
    globalThis.WebSocket = class MockSocket {
        constructor() {
            this.readyState = 0;
            sockets.push(this);
        }

        close() {}
    };

    const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1' });
    let firstResolve;
    let secondResolve;
    let closedSocketEvents = 0;
    lobby._handleSocketClosed = () => { closedSocketEvents += 1; };

    try {
        const firstAttempt = lobby._makeConnectAttempt((_socket, resolve) => { firstResolve = resolve; }, 1000);
        firstResolve();
        await firstAttempt;

        const secondAttempt = lobby._makeConnectAttempt((_socket, resolve) => { secondResolve = resolve; }, 1000);
        const currentSocket = sockets[1];
        sockets[0].onclose({ code: 1000, reason: '' });
        secondResolve();
        await secondAttempt;

        assert.equal(lobby._ws, currentSocket);
        assert.equal(closedSocketEvents, 0);
    } finally {
        lobby._closeSocket();
        globalThis.WebSocket = originalWebSocket;
    }
});

test('leaving while a join is still connecting rejects join() at once instead of waiting for the timeout', async () => {
    const originalWebSocket = globalThis.WebSocket;
    // A real browser socket reports close asynchronously, after leave() has already dropped it.
    globalThis.WebSocket = class MockSocket {
        static OPEN = 1;
        constructor() { this.readyState = 0; }
        send() {}
        close() { setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0); }
    };
    const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1' });
    try {
        const startedAt = Date.now();
        const join = lobby.join('ABCD', { connectTimeoutMs: 5000, maxConnectAttempts: 1 });
        lobby.leave();
        const outcome = await Promise.race([
            join.then(() => 'resolved', (error) => error),
            new Promise((resolve) => { setTimeout(() => resolve('still pending'), 300); }),
        ]);
        assert.notEqual(outcome, 'still pending', 'join() must settle as soon as the player cancels');
        assert.equal(outcome?.code, 'connect_cancelled');
        assert.ok(Date.now() - startedAt < 300);
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }
});
test('a join started right after leave() keeps its socket and the cancelled attempt does not retry', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const sockets = [];
    globalThis.WebSocket = class MockSocket {
        static OPEN = 1;
        constructor() { this.readyState = 0; this.closed = false; sockets.push(this); }
        send() {}
        close() { this.closed = true; }
    };
    const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1' });
    try {
        const first = lobby.join('ABCD', { connectTimeoutMs: 5000, maxConnectAttempts: 3, connectRetryDelaysMs: [0] });
        lobby.leave();
        const second = lobby.join('WXYZ', { connectTimeoutMs: 5000, maxConnectAttempts: 1 });
        await first.catch(() => {});
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        assert.equal(sockets.length, 2, 'the cancelled join opens no retry socket');
        assert.equal(lobby._ws, sockets[1], 'the new join still owns the current socket');
        assert.equal(sockets[1].closed, false, 'the cancelled attempt never closes the new socket');
        lobby.leave();
        await second.catch(() => {});
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }
});