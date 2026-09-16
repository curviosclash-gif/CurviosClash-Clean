import assert from 'node:assert/strict';
import test from 'node:test';
import { listOpenOnlineLobbies } from '../src/network/OnlineLobbyDirectoryClient.js';
import { SIGNALING_EVENT_TYPES } from '../src/shared/contracts/SignalingSessionContract.js';

function createWebSocketDouble({ failFirst = false } = {}) {
    let connections = 0;
    return class WebSocketDouble {
        static get connections() { return connections; }

        constructor(url) {
            this.url = url;
            connections += 1;
            queueMicrotask(() => this.onopen?.());
        }

        send() {
            if (failFirst && connections === 1) {
                queueMicrotask(() => this.onerror?.(new Error('offline')));
                return;
            }
            const lobbyCode = new URL(this.url).port.padStart(8, 'A').slice(-8);
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({
                type: SIGNALING_EVENT_TYPES.LOBBY_LIST,
                lobbies: [{ lobbyCode, memberCount: 1, maxPlayers: 10, hostName: 'Host' }],
            }) }));
        }

        close() {}
    };
}

test('parallel directory calls deduplicate and cached results resist caller mutation', async () => {
    const WebSocketImpl = createWebSocketDouble();
    const url = 'ws://127.0.0.1:9101';
    const [first, second] = await Promise.all([
        listOpenOnlineLobbies(url, { WebSocketImpl }),
        listOpenOnlineLobbies(url, { WebSocketImpl }),
    ]);
    assert.equal(WebSocketImpl.connections, 1);
    first[0].hostName = 'Mutated';
    first.push({ lobbyCode: 'MUTATED' });
    const cached = await listOpenOnlineLobbies(url, { WebSocketImpl });
    assert.equal(WebSocketImpl.connections, 1);
    assert.equal(cached.length, 1);
    assert.equal(cached[0].hostName, 'Host');
    assert.notStrictEqual(first, second);
});

test('directory cache honors TTL, URL, implementation, and force refresh boundaries', async () => {
    const WebSocketA = createWebSocketDouble();
    const WebSocketB = createWebSocketDouble();
    let now = 100;
    const options = { WebSocketImpl: WebSocketA, cacheTtlMs: 50, now: () => now };
    await listOpenOnlineLobbies('ws://127.0.0.1:9201', options);
    await listOpenOnlineLobbies('ws://127.0.0.1:9202', options);
    await listOpenOnlineLobbies('ws://127.0.0.1:9201', { ...options, forceRefresh: true });
    await listOpenOnlineLobbies('ws://127.0.0.1:9201', { ...options, WebSocketImpl: WebSocketB });
    assert.equal(WebSocketA.connections, 3);
    assert.equal(WebSocketB.connections, 1);
    now = 151;
    await listOpenOnlineLobbies('ws://127.0.0.1:9201', options);
    assert.equal(WebSocketA.connections, 4);
});

test('failed directory requests are retryable and are never cached', async () => {
    const WebSocketImpl = createWebSocketDouble({ failFirst: true });
    const url = 'ws://127.0.0.1:9301';
    await assert.rejects(
        listOpenOnlineLobbies(url, { WebSocketImpl }),
        (error) => error?.cause?.message === 'offline'
    );
    const result = await listOpenOnlineLobbies(url, { WebSocketImpl });
    assert.equal(WebSocketImpl.connections, 2);
    assert.equal(result.length, 1);
});

test('directory cache evicts the oldest server after sixteen entries', async () => {
    const WebSocketImpl = createWebSocketDouble();
    for (let index = 0; index < 17; index += 1) {
        await listOpenOnlineLobbies(`ws://127.0.0.1:${9400 + index}`, { WebSocketImpl });
    }
    assert.equal(WebSocketImpl.connections, 17);
    await listOpenOnlineLobbies('ws://127.0.0.1:9400', { WebSocketImpl });
    assert.equal(WebSocketImpl.connections, 18);
});
