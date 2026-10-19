import assert from 'node:assert/strict';
import test from 'node:test';

import { DataChannelManager } from '../src/network/DataChannelManager.js';
import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { fetchSignaling } from '../src/network/LANSignalingClient.js';
import { routeOnlineSessionSignalingMessage } from '../src/network/OnlineSessionSignalingRouter.js';
import { PeerConnectionManager } from '../src/network/PeerConnectionManager.js';
import { SIGNALING_COMMAND_TYPES } from '../src/shared/contracts/SignalingSessionContract.js';

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function withFetch(fetchImpl, run) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    return Promise.resolve()
        .then(run)
        .finally(() => { globalThis.fetch = originalFetch; });
}

function jsonResponse(body) {
    return { ok: true, status: 200, json: async () => body };
}

/** Resolves with `gate`, rejects as soon as the request signal aborts. */
function gatedRequest(init, gate) {
    return new Promise((resolve, reject) => {
        gate.then(resolve, reject);
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason || new Error('aborted'));
        signal?.addEventListener?.('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
    });
}

function createClientAdapter() {
    const adapter = new LANSessionAdapter({ isHost: false, signalingUrl: 'http://lan.invalid', peerToken: 't' });
    adapter._latencyMonitor.start = () => {};
    adapter._latencyMonitor.addPeer = () => {};
    return adapter;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a superseded handshake that resolves late cannot post an answer or report a connection', { timeout: 15_000 }, async () => {
    const adapter = createClientAdapter();
    const firstOfferHandled = deferred();
    const releaseFirstAnswer = deferred();
    const connected = [];
    let handleOfferCalls = 0;
    let answerPosts = 0;
    adapter._peerManager.handleOffer = async () => {
        handleOfferCalls += 1;
        if (handleOfferCalls === 1) {
            firstOfferHandled.resolve();
            return releaseFirstAnswer.promise;
        }
        return { type: 'answer', sdp: 'current' };
    };
    adapter._pollIceCandidates = async () => {};
    adapter.on('connected', (event) => connected.push(event));

    try {
        await withFetch(async (url) => {
            const href = String(url);
            if (href.includes('/signaling/offer')) return jsonResponse({ offer: { type: 'offer', sdp: 'offer' } });
            if (href.includes('/signaling/answer')) {
                answerPosts += 1;
                adapter._dataChannelManager._emit('channelOpen', { peerId: 'host', channel: 'state' });
            }
            return jsonResponse({});
        }, async () => {
            const firstConnect = adapter.connect({ playerId: 'p1' });
            await firstOfferHandled.promise;
            await adapter.reconnect({ playerId: 'p1' });
            releaseFirstAnswer.resolve({ type: 'answer', sdp: 'stale' });
            await firstConnect;
        });

        assert.equal(handleOfferCalls, 2);
        assert.equal(answerPosts, 1, 'only the current handshake may post its answer');
        assert.equal(connected.length, 1, 'the superseded handshake cannot report a second connection');
        assert.equal(adapter.isConnected, true);
    } finally {
        adapter.dispose();
    }
});

test('disconnect aborts a pending offer poll so a late offer starts no negotiation', { timeout: 15_000 }, async () => {
    const adapter = createClientAdapter();
    const offerRequested = deferred();
    const lateOffer = deferred();
    const connected = [];
    let offerSignal = null;
    let handleOfferCalls = 0;
    let answerPosts = 0;
    adapter._peerManager.handleOffer = async () => {
        handleOfferCalls += 1;
        return { type: 'answer', sdp: 'answer' };
    };
    adapter._pollIceCandidates = async () => {};
    adapter.on('connected', (event) => connected.push(event));

    try {
        await withFetch((url, init = {}) => {
            const href = String(url);
            if (href.includes('/signaling/offer')) {
                offerSignal = init.signal || null;
                offerRequested.resolve();
                return gatedRequest(init, lateOffer.promise);
            }
            if (href.includes('/signaling/answer')) answerPosts += 1;
            return Promise.resolve(jsonResponse({}));
        }, async () => {
            const connecting = adapter.connect({ playerId: 'p1' });
            await offerRequested.promise;
            adapter.disconnect();
            lateOffer.resolve(jsonResponse({ offer: { type: 'offer', sdp: 'late' } }));
            await Promise.allSettled([connecting]);
        });

        assert.equal(offerSignal?.aborted, true, 'the offer poll must stop with the handshake');
        assert.equal(handleOfferCalls, 0);
        assert.equal(answerPosts, 0);
        assert.deepEqual(connected, []);
        assert.equal(adapter.isConnected, false);
    } finally {
        adapter.dispose();
    }
});

test('disconnect during offer negotiation suppresses the late answer post', { timeout: 15_000 }, async () => {
    const adapter = createClientAdapter();
    const offerHandled = deferred();
    const releaseAnswer = deferred();
    const connected = [];
    let answerPosts = 0;
    adapter._peerManager.handleOffer = async () => {
        offerHandled.resolve();
        return releaseAnswer.promise;
    };
    adapter._pollIceCandidates = async () => {};
    adapter.on('connected', (event) => connected.push(event));

    try {
        await withFetch(async (url) => {
            const href = String(url);
            if (href.includes('/signaling/offer')) return jsonResponse({ offer: { type: 'offer', sdp: 'offer' } });
            if (href.includes('/signaling/answer')) answerPosts += 1;
            return jsonResponse({});
        }, async () => {
            const connecting = adapter.connect({ playerId: 'p1' });
            await offerHandled.promise;
            adapter.disconnect();
            releaseAnswer.resolve({ type: 'answer', sdp: 'late' });
            await Promise.allSettled([connecting]);
        });

        assert.equal(answerPosts, 0);
        assert.deepEqual(connected, []);
        assert.equal(adapter.isConnected, false);
    } finally {
        adapter.dispose();
    }
});

test('a new handshake stops the ICE poll of the superseded one', { timeout: 15_000 }, async () => {
    const adapter = createClientAdapter();
    const firstIcePoll = deferred();
    const release = deferred();
    const icePollSignals = [];
    let firstConnect = null;
    let reconnecting = null;
    adapter._peerManager.handleOffer = async () => ({ type: 'answer', sdp: 'answer' });

    try {
        await withFetch((url, init = {}) => {
            const href = String(url);
            if (href.includes('/signaling/offer')) {
                return Promise.resolve(jsonResponse({ offer: { type: 'offer', sdp: 'offer' } }));
            }
            if (href.includes('/signaling/ice?')) {
                icePollSignals.push(init.signal || null);
                firstIcePoll.resolve();
                return gatedRequest(init, release.promise);
            }
            if (href.includes('/lobby/rejoin') && icePollSignals.length > 0) {
                return gatedRequest(init, release.promise);
            }
            return Promise.resolve(jsonResponse({}));
        }, async () => {
            firstConnect = adapter.connect({ playerId: 'p1' });
            await firstIcePoll.promise;
            reconnecting = adapter.reconnect({ playerId: 'p1' });
            await flush();
            assert.equal(icePollSignals[0]?.aborted, true,
                'the old ICE poll would otherwise drain candidates meant for the new handshake');
        });
    } finally {
        adapter.dispose();
        release.resolve(jsonResponse({ candidates: [] }));
        void firstConnect?.catch(() => {});
        void reconnecting?.catch(() => {});
    }
});

class FakeChannel {
    constructor(label) {
        this.label = label;
        this.readyState = 'open';
    }

    close() {
        this.readyState = 'closed';
    }
}

/**
 * The first connection keeps gathering ICE until a test completes it by hand;
 * `remoteGates[i]` holds back setRemoteDescription of the i-th connection.
 */
function installFakeWebRtc(t, { firstKeepsGathering = false, remoteGates = [] } = {}) {
    const created = [];
    const originals = {
        RTCPeerConnection: globalThis.RTCPeerConnection,
        RTCSessionDescription: globalThis.RTCSessionDescription,
        RTCIceCandidate: globalThis.RTCIceCandidate,
    };
    globalThis.RTCSessionDescription = class {
        constructor(description) { Object.assign(this, description); }
    };
    globalThis.RTCIceCandidate = class {
        constructor(candidate) { Object.assign(this, candidate); }
    };
    globalThis.RTCPeerConnection = class {
        constructor() {
            this.id = created.length;
            this.connectionState = 'new';
            this.iceGatheringState = firstKeepsGathering && created.length === 0 ? 'gathering' : 'complete';
            this.localDescription = null;
            this.remoteDescription = null;
            this.appliedCandidates = [];
            created.push(this);
        }

        async setRemoteDescription(description) {
            await remoteGates[this.id];
            this.remoteDescription = description;
        }

        async createAnswer() { return { type: 'answer', sdp: `answer-${this.id}` }; }
        async setLocalDescription(description) { this.localDescription = description; }
        async addIceCandidate(candidate) { this.appliedCandidates.push(candidate.candidate); }
        close() { this.connectionState = 'closed'; }
    };
    t.after(() => {
        for (const [name, value] of Object.entries(originals)) {
            if (value === undefined) delete globalThis[name];
            else globalThis[name] = value;
        }
    });
    return created;
}

function recordEvents(emitter, types) {
    const events = [];
    for (const type of types) emitter.on(type, (payload) => events.push({ type, ...payload }));
    return events;
}

test('a superseded peer connection cannot report state, ICE, channels or its stale answer', async (t) => {
    const created = installFakeWebRtc(t, { firstKeepsGathering: true });
    const channels = new DataChannelManager();
    const manager = new PeerConnectionManager({ isHost: false, dataChannelManager: channels });
    const peerEvents = recordEvents(manager, ['peerDisconnected', 'connectionStateChange', 'iceCandidate']);
    const channelEvents = recordEvents(channels, ['channelClose']);
    const offer = { type: 'offer', sdp: 'offer' };

    const firstNegotiation = manager.handleOffer('host', offer);
    void firstNegotiation.catch(() => {});
    while (!created[0]?.localDescription) await flush();
    const oldPeer = created[0];
    const oldChannel = new FakeChannel('state');
    oldPeer.ondatachannel({ channel: oldChannel });

    await manager.handleOffer('host', offer);
    const currentPeer = created[1];
    assert.equal(manager.getConnection('host'), currentPeer);

    oldPeer.connectionState = 'failed';
    oldPeer.onconnectionstatechange?.();
    oldPeer.onicecandidate?.({ candidate: { candidate: 'stale' } });
    oldPeer.ondatachannel?.({ channel: new FakeChannel('inputs') });
    oldChannel.onclose?.();
    oldPeer.iceGatheringState = 'complete';
    oldPeer.onicegatheringstatechange?.();

    await assert.rejects(firstNegotiation, /superseded/, 'the replaced negotiation must not return its stale answer');
    assert.deepEqual(peerEvents, []);
    assert.deepEqual(channelEvents, [], 'a channel of the replaced connection cannot report the live host as gone');
    assert.equal(channels.getChannel('host', 'inputs'), null);
    assert.equal(manager.getConnection('host'), currentPeer);
    manager.dispose();
});

test('an aborted handshake mutes ICE of its not yet replaced peer connection', async (t) => {
    const created = installFakeWebRtc(t);
    const manager = new PeerConnectionManager({ isHost: false });
    const iceEvents = recordEvents(manager, ['iceCandidate']);
    const controller = new AbortController();

    await manager.handleOffer('host', { type: 'offer', sdp: 'offer' }, { signal: controller.signal });
    const peer = created[0];
    peer.onicecandidate({ candidate: { candidate: 'live' } });
    controller.abort();
    peer.onicecandidate({ candidate: { candidate: 'stale' } });

    assert.equal(iceEvents.length, 1);
    assert.equal(iceEvents[0].candidate.candidate, 'live');
    assert.equal(iceEvents[0].signal, controller.signal, 'the ICE post must be cancellable with its handshake');
    manager.dispose();
});

test('a superseded negotiation cannot take the ICE candidates buffered for its replacement', async (t) => {
    const firstRemote = deferred();
    const secondRemote = deferred();
    const created = installFakeWebRtc(t, { remoteGates: [firstRemote.promise, secondRemote.promise] });
    const manager = new PeerConnectionManager({ isHost: false });
    const offer = { type: 'offer', sdp: 'offer' };

    const firstNegotiation = manager.handleOffer('host', offer);
    void firstNegotiation.catch(() => {});
    const secondNegotiation = manager.handleOffer('host', offer);
    await manager.addIceCandidate('host', { candidate: 'for-current' });
    firstRemote.resolve();
    await assert.rejects(firstNegotiation, /superseded/);
    secondRemote.resolve();
    await secondNegotiation;

    assert.deepEqual(created[0].appliedCandidates, []);
    assert.deepEqual(created[1].appliedCandidates, ['for-current']);
    manager.dispose();
});

test('an online offer superseded by the next one is dropped without an error or answer', async (t) => {
    const firstRemote = deferred();
    installFakeWebRtc(t, { remoteGates: [firstRemote.promise] });
    const sent = [];
    const adapter = {
        isHost: false,
        _hostPeerId: null,
        _peerManager: new PeerConnectionManager({ isHost: false }),
        _sendSignaling: (envelope) => sent.push(envelope),
        _latencyMonitor: { addPeer() {} },
    };
    const offerMessage = { type: SIGNALING_COMMAND_TYPES.OFFER, fromPeerId: 'host-peer', offer: { type: 'offer', sdp: 'offer' } };

    const firstRoute = routeOnlineSessionSignalingMessage(adapter, offerMessage);
    await routeOnlineSessionSignalingMessage(adapter, offerMessage);
    firstRemote.resolve();
    await firstRoute;

    assert.equal(sent.length, 1, 'only the current connection answers');
    adapter._peerManager.dispose();
});

test('a connect superseded by a failing reconnect reports that failure instead of success', { timeout: 15_000 }, async () => {
    const adapter = createClientAdapter();
    const firstOfferHandled = deferred();
    const releaseFirstAnswer = deferred();
    const connected = [];
    let rejoins = 0;
    adapter._peerManager.handleOffer = async () => {
        firstOfferHandled.resolve();
        return releaseFirstAnswer.promise;
    };
    adapter._pollIceCandidates = async () => {};
    adapter.on('connected', (event) => connected.push(event));

    try {
        await withFetch(async (url) => {
            const href = String(url);
            if (href.includes('/lobby/rejoin')) {
                rejoins += 1;
                return rejoins === 1 ? jsonResponse({}) : { ok: false, status: 403, json: async () => ({}) };
            }
            if (href.includes('/signaling/offer')) return jsonResponse({ offer: { type: 'offer', sdp: 'offer' } });
            return jsonResponse({});
        }, async () => {
            const firstConnect = adapter.connect({ playerId: 'p1' });
            void firstConnect.catch(() => {});
            await firstOfferHandled.promise;
            await assert.rejects(adapter.reconnect({ playerId: 'p1' }), /rejected \(403\)/);
            releaseFirstAnswer.resolve({ type: 'answer', sdp: 'stale' });
            await assert.rejects(firstConnect, /rejected \(403\)/,
                'a caller of the superseded connect must not see success without a connection');
        });

        assert.deepEqual(connected, []);
        assert.equal(adapter.isConnected, false);
    } finally {
        adapter.dispose();
    }
});

test('an external cancellation signal keeps the signaling request deadline', { timeout: 3000 }, async () => {
    const controller = new AbortController();
    await withFetch((_url, init) => gatedRequest(init, new Promise(() => {})), () => assert.rejects(
        fetchSignaling('http://lan.invalid/signaling/offer', { signal: controller.signal }, 30),
    ));
});
