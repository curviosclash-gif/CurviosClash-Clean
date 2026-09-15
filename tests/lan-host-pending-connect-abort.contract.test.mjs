import assert from 'node:assert/strict';
import test from 'node:test';

import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';

function jsonResponse(body) {
    return { ok: true, status: 200, json: async () => body };
}

function createPeerManagerStub(onCreateOffer = () => {}) {
    return {
        createOffer: async (peerId) => {
            onCreateOffer();
            return { type: 'offer', sdp: `offer-for-${peerId}` };
        },
        handleOffer: async () => ({ type: 'answer', sdp: 'answer' }),
        handleAnswer: async () => {},
        addIceCandidate: async () => {},
        closePeer: () => {},
        dispose: () => {},
        getAllPeerIds: () => [],
        recordPeerActivity: () => {},
        recordHeartbeatAck: () => {},
        on: () => {},
    };
}

/**
 * Drives the host side of _connectToPendingClient() against a scripted
 * signaling server. `hooks` fire when the matching request goes out, which is
 * how a test simulates the host shutting down mid-handshake.
 */
async function runPendingConnect(hooks = {}) {
    const adapter = new LANSessionAdapter({
        isHost: true,
        signalingUrl: 'http://lan.invalid',
        peerToken: 'host-token',
        now: () => 0,
    });
    adapter._peerManager = createPeerManagerStub(() => hooks.onCreateOffer?.(adapter));

    const calls = [];
    const connected = [];
    adapter.on('playerConnected', ({ peerId }) => connected.push(peerId));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const href = String(url);
        calls.push({ url: href, method: String(init.method || 'GET') });
        if (href.includes('/signaling/offer')) {
            hooks.onOffer?.(adapter);
            return jsonResponse({ ok: true });
        }
        if (href.includes('/signaling/ice')) {
            hooks.onIcePoll?.(adapter);
            return jsonResponse({ candidates: [] });
        }
        if (href.includes('/signaling/answer')) {
            hooks.onAnswerPoll?.(adapter);
            return jsonResponse({ answer: { type: 'answer', sdp: 'from-client' } });
        }
        return jsonResponse({ ok: true });
    };

    try {
        await adapter._connectToPendingClient({ playerId: 'peer-1' });
    } finally {
        globalThis.fetch = originalFetch;
        if (!hooks.skipDispose) adapter.dispose();
    }

    const countOf = (fragment) => calls.filter((call) => call.url.includes(fragment)).length;
    return { adapter, calls, connected, countOf };
}

test('the host handshake finishes normally while the adapter is alive', async () => {
    const { countOf, connected } = await runPendingConnect();

    assert.equal(countOf('/signaling/offer'), 1);
    assert.equal(countOf('/signaling/answer'), 1);
    assert.equal(countOf('/lobby/ack-pending'), 1);
    assert.deepEqual(connected, ['peer-1']);
});

test('a host disconnect during the offer keeps that offer off the wire', async () => {
    const { countOf, connected } = await runPendingConnect({
        onCreateOffer: (adapter) => adapter.disconnect(),
        skipDispose: true,
    });

    assert.equal(countOf('/signaling/offer'), 0, 'no offer for a host that already shut down');
    assert.equal(countOf('/signaling/ice'), 0);
    assert.equal(countOf('/lobby/ack-pending'), 0);
    assert.deepEqual(connected, []);
});

test('a host disconnect stops the pending-client handshake before it polls', async () => {
    const { countOf, connected } = await runPendingConnect({
        onOffer: (adapter) => adapter.disconnect(),
        skipDispose: true,
    });

    assert.equal(countOf('/signaling/offer'), 1);
    assert.equal(countOf('/signaling/ice'), 0, 'no ICE polling after disconnect');
    assert.equal(countOf('/signaling/answer'), 0, 'no answer polling after disconnect');
    assert.equal(countOf('/lobby/ack-pending'), 0);
    assert.deepEqual(connected, []);
});

test('a disposed host never acknowledges a pending client', async () => {
    const { countOf, connected } = await runPendingConnect({
        onIcePoll: (adapter) => adapter.dispose(),
        skipDispose: true,
    });

    assert.equal(countOf('/signaling/answer'), 1);
    assert.equal(
        countOf('/lobby/ack-pending'),
        0,
        'acking would drop the client pending entry with no host listening'
    );
    assert.deepEqual(connected, [], 'a disposed adapter must not report a new player');
});
