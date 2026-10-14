import assert from 'node:assert/strict';
import test from 'node:test';

import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';

test('disconnect immediately cancels an active signaling socket attempt', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const sockets = [];
    globalThis.WebSocket = class PendingSocket {
        constructor() {
            this.readyState = 0;
            sockets.push(this);
        }

        close() {
            this.readyState = 3;
            queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
        }
    };

    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://localhost:1' });
    try {
        const connecting = adapter.connect({ connectTimeoutMs: 1000, maxConnectAttempts: 1 });
        assert.equal(sockets.length, 1);
        adapter.disconnect();
        await assert.rejects(connecting, (error) => error?.code === 'connect_cancelled');
    } finally {
        adapter.dispose();
        globalThis.WebSocket = originalWebSocket;
    }
});
