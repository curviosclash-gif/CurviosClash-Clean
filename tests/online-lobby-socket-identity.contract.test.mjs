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
