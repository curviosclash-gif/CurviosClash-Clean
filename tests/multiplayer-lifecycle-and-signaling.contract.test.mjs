import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignalingServer } from '../server/signaling-server.js';
import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';
import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { routeOnlineSessionSignalingMessage } from '../src/network/OnlineSessionSignalingRouter.js';
import { DataChannelManager } from '../src/network/DataChannelManager.js';
import { PeerConnectionManager } from '../src/network/PeerConnectionManager.js';
import { SessionAdapterBase } from '../src/network/SessionAdapterBase.js';
import { attachMultiplayerLifecycleKernel, detachMultiplayerLifecycleKernel } from '../src/core/runtime/MultiplayerMatchLifecycleKernel.js';
import {
    initRuntimeSession,
    teardownRuntimeSession,
    waitForRuntimePlayersLoaded,
} from '../src/core/runtime/RuntimeSessionLifecycleService.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { SIGNALING_EVENT_TYPES } from '../src/shared/contracts/SignalingSessionContract.js';
import { resolveTestTimeScale } from '../scripts/run-contract-tests.mjs';

// Unter Fremdlast (paralleler Cluster oder Build) braucht der Signaling-Roundtrip
// laenger als die Netzwerkzusage selbst; CURVIOS_TEST_TIME_SCALE streckt nur die
// Wartebudgets, nicht die geprueften Aussagen.
const TIME_SCALE = resolveTestTimeScale();
const EVENT_TIMEOUT_MS = Math.round(5000 * TIME_SCALE);
const DATA_CHANNEL_OPEN_TIMEOUT_MS = Math.round(1000 * TIME_SCALE);

function waitForEvent(emitter, event, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for '${event}'`)),
            timeoutMs
        );
        emitter.on(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function stubPeerManager(log = []) {
    return {
        createOffer: async (peerId) => {
            log.push({ op: 'createOffer', peerId });
            return { type: 'offer', sdp: `offer-for-${peerId}` };
        },
        handleOffer: async (peerId, offer) => {
            log.push({ op: 'handleOffer', peerId, offer });
            return { type: 'answer', sdp: `answer-from-${peerId}` };
        },
        handleAnswer: async (peerId, answer) => {
            log.push({ op: 'handleAnswer', peerId, answer });
        },
        addIceCandidate: async () => {},
        closePeer: () => {},
        dispose: () => {},
        getAllPeerIds: () => [],
        recordPeerActivity: () => {},
        recordHeartbeatAck: () => {},
    };
}

function createEventHarness() {
    const listeners = new Map();
    return {
        on(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        off(event, handler) {
            const entries = listeners.get(event) || [];
            const index = entries.indexOf(handler);
            if (index >= 0) entries.splice(index, 1);
        },
        emit(event, payload) {
            for (const handler of listeners.get(event) || []) {
                handler(payload);
            }
        },
    };
}

function createRuntimeLoadSession() {
    const events = createEventHarness();
    return {
        ...events,
        isHost: true,
        localPlayerId: 'host',
        broadcasts: 0,
        getPlayers() {
            return [{ peerId: 'host' }, { peerId: 'client' }];
        },
        broadcastRoundStartGate() {
            this.broadcasts += 1;
        },
        dispose() {},
    };
}

test('runtime teardown cancels host load waits and stale round-start retries', async () => {
    const oldSession = createRuntimeLoadSession();
    const facade = {
        session: oldSession,
        _arenaLoadedPeers: new Set(),
        _pendingStateUpdates: [],
    };
    const completedWait = waitForRuntimePlayersLoaded(facade);
    oldSession.emit('playerLoaded', { playerId: 'client' });
    await completedWait;
    assert.equal(oldSession.broadcasts, 1);

    teardownRuntimeSession(facade);
    const replacementSession = createRuntimeLoadSession();
    facade.session = replacementSession;
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(replacementSession.broadcasts, 0);

    const pendingSession = createRuntimeLoadSession();
    facade.session = pendingSession;
    const pendingWait = waitForRuntimePlayersLoaded(facade);
    teardownRuntimeSession(facade);
    await Promise.race([
        pendingWait,
        new Promise((_, reject) => setTimeout(() => reject(new Error('host load wait was not cancelled')), 100)),
    ]);
    assert.equal(pendingSession.broadcasts, 0);
});

test('hybrid LAN host does not wait for its second local seat as a remote peer', async () => {
    const session = createRuntimeLoadSession();
    session.getPlayers = () => [{ peerId: 'host' }];
    const facade = {
        game: { runtimeConfig: { session: { networkEnabled: true } } },
        session,
        menuMultiplayerBridge: {
            getSessionState: () => ({
                peerId: 'host',
                hostPeerId: 'host',
                localPlayerCount: 2,
                members: [{ peerId: 'host', isHost: true, isLocal: true }],
            }),
        },
        _arenaLoadedPeers: new Set(),
        _pendingStateUpdates: [],
    };

    await Promise.race([
        waitForRuntimePlayersLoaded(facade),
        new Promise((_, reject) => setTimeout(() => reject(new Error('local split seat blocked match start')), 50)),
    ]);
    assert.equal(session.broadcasts, 0);
});

test('runtime session initialization stays cancelled after teardown wins the race', async () => {
    let resolveDispose;
    const facade = {
        game: {
            runtimeConfig: {
                session: { sessionType: 'local' },
            },
        },
        session: {
            dispose: () => new Promise((resolve) => { resolveDispose = resolve; }),
        },
        _pendingStateUpdates: [],
    };

    const initializePromise = initRuntimeSession(facade);
    teardownRuntimeSession(facade);
    resolveDispose();

    assert.equal(await initializePromise, false);
    assert.equal(facade.session, null);
});

test('OnlineMatchLobby classifies invalid signaling payloads', () => {
    const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1234' });

    let parseError = null;
    try {
        lobby._parseSocketMessage('{broken');
    } catch (error) {
        parseError = error;
    }
    assert.equal(parseError?.code, 'signaling_payload_invalid');

    let missingTypeError = null;
    try {
        lobby._parseSocketMessage(JSON.stringify({ foo: 'bar' }));
    } catch (error) {
        missingTypeError = error;
    }
    assert.equal(missingTypeError?.code, 'signaling_payload_invalid');
});

test('OnlineSessionAdapter rejects missing signaling message type', async () => {
    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://localhost:1234' });
    const result = await new Promise((resolve) => {
        adapter._handleSignalingMessage(
            { invalid: true },
            () => resolve({ resolved: true }),
            (error) => resolve({ rejected: true, code: error?.code })
        );
    });

    adapter.dispose();
    assert.equal(result?.rejected, true);
    assert.equal(result?.code, 'signaling_payload_invalid');
});

test('OnlineMatchLobby resumes automatically after a transient signaling drop', async () => {
    const wss = createSignalingServer(0);
    const signalingUrl = `ws://127.0.0.1:${wss.address().port}`;
    const lobby = new OnlineMatchLobby({ signalingUrl });
    try {
        await lobby.create({ maxPlayers: 4 });
        const lobbyCode = lobby.lobbyCode;
        const previousSocket = lobby._ws;
        const resumed = waitForEvent(lobby, 'connectionResumed');
        const serverSocket = Array.from(wss.clients)[0];
        serverSocket.terminate();

        await resumed;
        assert.equal(lobby.lobbyCode, lobbyCode);
        assert.notEqual(lobby._ws, previousSocket);
        assert.equal(lobby.sessionState.members.length, 1);
    } finally {
        lobby.leave();
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const socket of wss.clients) socket.terminate();
        await new Promise((resolve) => wss.close(() => resolve()));
    }
});

test('online match handoff attaches transports to the SAME lobby and completes the offer/answer round-trip', async () => {
    const wss = createSignalingServer(0);
    const port = wss.address().port;
    const signalingUrl = `ws://127.0.0.1:${port}`;

    const hostLobby = new OnlineMatchLobby({ signalingUrl });
    const clientLobby = new OnlineMatchLobby({ signalingUrl });
    let hostAdapter = null;
    let clientAdapter = null;
    try {
        await hostLobby.create({ maxPlayers: 4 });
        const lobbyCode = hostLobby.lobbyCode;
        assert.ok(lobbyCode, 'host lobby code missing');
        await clientLobby.join(lobbyCode);

        const hostPeerId = hostLobby.getLocalPeerId();
        const clientPeerId = clientLobby.getLocalPeerId();
        assert.ok(hostPeerId && clientPeerId);
        // PLAYER_JOINED reaches the host asynchronously via broadcast.
        for (let i = 0; i < 100 && hostLobby.sessionState.members.length < 2; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const membersBefore = hostLobby.sessionState.members.length;
        assert.equal(membersBefore, 2);

        const hostLog = [];
        const clientLog = [];
        hostAdapter = new OnlineSessionAdapter({ isHost: true, signalingUrl });
        clientAdapter = new OnlineSessionAdapter({ isHost: false, signalingUrl });
        hostAdapter._peerManager = stubPeerManager(hostLog);
        clientAdapter._peerManager = stubPeerManager(clientLog);

        const hostPlayerConnected = waitForEvent(hostAdapter, 'playerConnected');
        await hostAdapter.connect({
            playerId: hostPeerId,
            lobbyCode,
            sessionToken: hostLobby.getLocalPeerToken(),
        });
        let clientConnectResolved = false;
        const clientConnect = clientAdapter.connect({
            playerId: clientPeerId,
            lobbyCode,
            sessionToken: clientLobby.getLocalPeerToken(),
            dataChannelOpenTimeoutMs: DATA_CHANNEL_OPEN_TIMEOUT_MS,
        }).then(() => {
            clientConnectResolved = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(clientConnectResolved, false, 'signaling alone must not resolve client connect');
        clientAdapter._dataChannelManager._emit('channelOpen', {
            peerId: hostPeerId,
            channel: 'state',
        });
        await clientConnect;

        // Same lobby: the host adapter must offer to the attaching client and
        // receive the answer back through the relay.
        const connectedPayload = await hostPlayerConnected;
        assert.equal(connectedPayload.peerId, clientPeerId);
        assert.deepEqual(hostLog.map((entry) => entry.op), ['createOffer', 'handleAnswer']);
        assert.equal(hostLog[0].peerId, clientPeerId);
        assert.equal(clientLog[0]?.op, 'handleOffer');
        assert.equal(clientLog[0]?.peerId, hostPeerId);
        assert.equal(clientAdapter._hostPeerId, hostPeerId);

        const resumed = waitForEvent(clientAdapter, 'connectionResumed');
        clientAdapter._registerPeerDisconnect(hostPeerId, 'test-drop');
        await new Promise((resolve) => setTimeout(resolve, 30));
        clientAdapter._dataChannelManager._emit('channelOpen', {
            peerId: hostPeerId,
            channel: 'state',
        });
        await resumed;
        assert.equal(clientAdapter.isConnected, true);

        // No double slot usage: attaching transports must not add lobby members.
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(hostLobby.sessionState.members.length, membersBefore);
    } finally {
        try { clientAdapter?.disconnect(); } catch { /* cleanup */ }
        try { hostAdapter?.disconnect(); } catch { /* cleanup */ }
        try { clientLobby.leave(); } catch { /* cleanup */ }
        try { hostLobby.leave(); } catch { /* cleanup */ }
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const socket of wss.clients) {
            socket.terminate();
        }
        await new Promise((resolve) => wss.close(() => resolve()));
    }
});

test('PeerConnectionManager buffers remote ICE candidates until the remote description is set', async () => {
    const applied = [];
    class FakeRTCIceCandidate {
        constructor(candidate) { this.candidate = candidate; }
    }
    class FakeRTCSessionDescription {
        constructor(description) { Object.assign(this, description); }
    }
    const fakePc = {
        remoteDescription: null,
        async setRemoteDescription(description) { this.remoteDescription = description; },
        async addIceCandidate(candidate) { applied.push(candidate.candidate); },
        close() {},
    };
    const originalIce = globalThis.RTCIceCandidate;
    const originalSdp = globalThis.RTCSessionDescription;
    globalThis.RTCIceCandidate = FakeRTCIceCandidate;
    globalThis.RTCSessionDescription = FakeRTCSessionDescription;
    try {
        const manager = new PeerConnectionManager({});
        manager._peers.set('peer-1', fakePc);

        // Candidates arriving before the answer must not be dropped.
        await manager.addIceCandidate('peer-1', { candidate: 'early-1' });
        await manager.addIceCandidate('unknown-peer', { candidate: 'early-2' });
        assert.deepEqual(applied, []);

        await manager.handleAnswer('peer-1', { type: 'answer', sdp: 'a' });
        assert.deepEqual(applied, [{ candidate: 'early-1' }]);

        await manager.addIceCandidate('peer-1', { candidate: 'late-1' });
        assert.deepEqual(applied, [{ candidate: 'early-1' }, { candidate: 'late-1' }]);
        manager.dispose();
    } finally {
        globalThis.RTCIceCandidate = originalIce;
        globalThis.RTCSessionDescription = originalSdp;
    }
});

test('PeerConnectionManager emits peerConnected once per connection cycle', () => {
    const connections = [];
    class FakeRTCPeerConnection {
        constructor() {
            this.connectionState = 'new';
            connections.push(this);
        }
        close() { this.connectionState = 'closed'; }
    }
    const originalPeerConnection = globalThis.RTCPeerConnection;
    globalThis.RTCPeerConnection = FakeRTCPeerConnection;
    try {
        const manager = new PeerConnectionManager({});
        const connected = [];
        manager.on('peerConnected', ({ peerId }) => connected.push(peerId));

        const first = manager._createPeerConnection('peer-1');
        first.connectionState = 'connected';
        first.onconnectionstatechange();
        first.onconnectionstatechange();
        assert.deepEqual(connected, ['peer-1']);

        const replacement = manager._createPeerConnection('peer-1');
        replacement.connectionState = 'connected';
        replacement.onconnectionstatechange();
        assert.deepEqual(connected, ['peer-1', 'peer-1']);

        replacement.connectionState = 'failed';
        replacement.onconnectionstatechange();
        replacement.connectionState = 'connected';
        replacement.onconnectionstatechange();
        assert.deepEqual(connected, ['peer-1', 'peer-1', 'peer-1']);
        manager.dispose();
    } finally {
        globalThis.RTCPeerConnection = originalPeerConnection;
    }
});

test('DataChannelManager separates unreliable snapshots from reliable state', () => {
    const created = [];
    const fakePc = {
        createDataChannel(label, options) {
            created.push({ label, options });
            return { label, onopen: null, onclose: null, onerror: null, onmessage: null };
        },
    };
    const manager = new DataChannelManager();
    manager.createChannels('peer-1', fakePc);

    const stateChannel = created.find((entry) => entry.label === 'state');
    const inputChannel = created.find((entry) => entry.label === 'inputs');
    const snapshotChannel = created.find((entry) => entry.label === 'snapshots');
    assert.equal(stateChannel.options.ordered, true);
    assert.equal('maxRetransmits' in stateChannel.options, false, 'state channel must be fully reliable');
    assert.equal(inputChannel.options.maxRetransmits, 0);
    assert.equal(snapshotChannel.options.ordered, false);
    assert.equal(snapshotChannel.options.maxRetransmits, 0);
});

test('DataChannelManager rejects malformed and oversized peer payloads', () => {
    const manager = new DataChannelManager();
    const channel = { label: 'inputs', close() {} };
    const errors = [];
    manager.on('protocolError', (event) => errors.push(event.reason));
    manager.handleIncomingChannel('peer-1', channel);

    channel.onmessage({ data: '{broken' });
    channel.onmessage({ data: JSON.stringify([]) });
    channel.onmessage({ data: 'x'.repeat(128 * 1024 + 1) });

    assert.deepEqual(errors, ['invalid_json', 'invalid_message_shape', 'invalid_message_size']);
    manager.dispose();
});

test('DataChannelManager preserves lifecycle messages under backpressure', () => {
    const sent = [];
    const manager = new DataChannelManager({
        backpressureThresholdBytes: 64,
        backpressureCooldownMs: 0,
    });
    manager._channels.set('peer-1:state', {
        readyState: 'open',
        bufferedAmount: 512,
        send: (payload) => sent.push(JSON.parse(payload)),
        close: () => {},
    });

    assert.equal(manager.send('peer-1', 'state', { type: 'state_snapshot' }), false);
    assert.equal(manager.send('peer-1', 'state', { type: 'full_state_sync' }), true);
    assert.deepEqual(sent.map((message) => message.type), ['full_state_sync']);
    manager.dispose();
});

test('network reconnect completes once after the reliable state channel opens', async () => {
    const online = new OnlineSessionAdapter({ isHost: true });
    online.localPlayerId = 'host';
    online._peerManager = stubPeerManager();
    online._sendSignaling = () => {};
    online._disconnectedPeers.set('peer-2', { timer: null });
    let onlineReconnects = 0;
    let onlineSyncs = 0;
    online.on('playerReconnected', () => { onlineReconnects += 1; });
    online.on('fullStateSyncNeeded', () => { onlineSyncs += 1; });

    await routeOnlineSessionSignalingMessage(online, {
        type: SIGNALING_EVENT_TYPES.PLAYER_RECONNECTED,
        peerId: 'peer-2',
    });
    assert.equal(onlineReconnects, 0);
    assert.equal(onlineSyncs, 0);

    online._dataChannelManager._emit('channelOpen', { peerId: 'peer-2', channel: 'state' });
    online._dataChannelManager._emit('channelOpen', { peerId: 'peer-2', channel: 'state' });
    assert.equal(onlineReconnects, 1);
    assert.equal(onlineSyncs, 1);

    const lan = new LANSessionAdapter({ isHost: true });
    lan._disconnectedPeers.set('peer-3', { timer: null });
    let lanSyncs = 0;
    lan.on('fullStateSyncNeeded', () => { lanSyncs += 1; });
    lan._dataChannelManager._emit('channelOpen', { peerId: 'peer-3', channel: 'inputs' });
    assert.equal(lanSyncs, 0);
    lan._dataChannelManager._emit('channelOpen', { peerId: 'peer-3', channel: 'state' });
    assert.equal(lanSyncs, 1);

    online.dispose();
    lan.dispose();
});

test('client-side adapters deduplicate disconnect events per peer', () => {
    class TestAdapter extends SessionAdapterBase {
        constructor() {
            super({ isHost: false });
            this.sent = [];
        }
        _sendStateToAll() {}
        _sendStateToPeer() {}
        _closePeerConnection() {}
        _removePeerLatency() {}
    }
    const adapter = new TestAdapter();
    const events = [];
    adapter.on('playerDisconnected', (payload) => events.push(payload));

    // channel-close fires once per data channel (inputs + state).
    adapter._registerPeerDisconnect('host', 'channel-close');
    adapter._registerPeerDisconnect('host', 'channel-close');
    assert.equal(events.length, 1);

    // After a successful reconnect the next disconnect is reported again.
    adapter._clearClientPeerDisconnect('host');
    adapter._registerPeerDisconnect('host', 'heartbeat-timeout');
    assert.equal(events.length, 2);
});

test('multiplayer lifecycle kernel observes async returnToMenu and suppresses duplicate triggers', async () => {
    const session = createEventHarness();
    let callCount = 0;
    let rejectCall = true;
    const facade = {
        _pendingMatchFinalize: false,
        game: {
            state: GAME_STATE_IDS.PLAYING,
        },
        returnToMenu() {
            callCount += 1;
            if (rejectCall) {
                rejectCall = false;
                return Promise.reject(new Error('simulated-finalize-failure'));
            }
            return Promise.resolve();
        },
    };

    const handlers = attachMultiplayerLifecycleKernel(facade, session);
    session.emit('hostDisconnected', {});
    session.emit('hostDisconnected', {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(callCount, 1);

    session.emit('hostDisconnected', {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(callCount, 2);

    detachMultiplayerLifecycleKernel(session, handlers);
});
