import assert from 'node:assert/strict';
import test from 'node:test';

import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { pollIceCandidates } from '../src/network/LANSignalingClient.js';

function withFetch(fetchImpl, run) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    return Promise.resolve()
        .then(run)
        .finally(() => { globalThis.fetch = originalFetch; });
}

function hangingFetch(_url, init = {}) {
    return new Promise((_resolve, reject) => {
        init.signal?.addEventListener?.('abort', () => reject(init.signal.reason || new Error('aborted')));
    });
}

test('an unreachable LAN host cannot hang the ICE poll forever', { timeout: 3000 }, async () => {
    await withFetch(hangingFetch, () => pollIceCandidates({
        signalingUrl: 'http://lan.invalid',
        playerId: 'p1',
        token: 't',
        addCandidate: async () => {},
        maxRetries: 2,
        pollDelayMs: 0,
        requestTimeoutMs: 30,
    }));
});

test('a failed answer post does not leave an unhandled channel-open rejection', async (t) => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const adapter = new LANSessionAdapter({
            isHost: false,
            signalingUrl: 'http://lan.invalid',
            peerToken: 'player-token',
        });
        adapter._peerManager.handleOffer = async () => ({ type: 'answer', sdp: 'answer' });
        await withFetch(async (url) => {
            if (String(url).includes('/signaling/offer')) {
                return { ok: true, status: 200, json: async () => ({ offer: { type: 'offer', sdp: 'offer' } }) };
            }
            throw new Error('network down');
        }, async () => {
            await assert.rejects(adapter._attachExistingClient('p1'), /Answer send failed/);
        });
        // Let the 10 s channel-open timeout of the abandoned handshake expire.
        t.mock.timers.tick(10_000);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        adapter.dispose?.();
        assert.deepEqual(unhandled.map(String), [], 'the channel-open timeout must not surface as an unhandled rejection');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});
