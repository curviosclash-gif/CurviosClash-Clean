import assert from 'node:assert/strict';
import test from 'node:test';

import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { PeerConnectionManager } from '../src/network/PeerConnectionManager.js';
import { MULTIPLAYER_MESSAGE_TYPES } from '../src/shared/contracts/MultiplayerSessionContract.js';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stands in for an RTCPeerConnection whose transport is still alive: a blocked
 * main thread on the remote side only stalls the heartbeat replies, it does not
 * fail or close the connection.
 */
function createOpenPeerConnectionStub(connectionState = 'connected') {
    return {
        connectionState,
        closed: false,
        close() {
            this.closed = true;
            this.connectionState = 'closed';
        },
    };
}

test('a peer that answers again after a heartbeat timeout gets its heartbeat back', () => {
    const manager = new PeerConnectionManager({ isHost: true });
    const resumed = [];
    manager.on('peerActivityResumed', ({ peerId }) => resumed.push(peerId));

    manager._peers.set('peer-1', createOpenPeerConnectionStub());
    manager._connectedPeers.add('peer-1');
    manager._startHeartbeat('peer-1');

    // The monitor gave up after HEARTBEAT_TIMEOUT while the peer connection
    // itself stayed open.
    manager._stopHeartbeat('peer-1');
    assert.equal(manager._heartbeats.has('peer-1'), false);

    manager.recordPeerActivity('peer-1');

    assert.equal(manager._heartbeats.has('peer-1'), true, 'the heartbeat monitor has to run again');
    assert.deepEqual(resumed, ['peer-1']);

    manager.dispose();
});

test('a fresh replacement connection gets no heartbeat before it is connected', () => {
    const manager = new PeerConnectionManager({ isHost: true });
    const resumed = [];
    manager.on('peerActivityResumed', ({ peerId }) => resumed.push(peerId));

    // _createPeerConnection() replaced the old connection: it is still
    // negotiating, so a heartbeat would time out before the peer can answer.
    manager._peers.set('peer-1', createOpenPeerConnectionStub('connecting'));
    manager.recordPeerActivity('peer-1');

    assert.equal(manager._heartbeats.has('peer-1'), false);
    assert.deepEqual(resumed, []);

    manager.dispose();
});

test('a closed peer connection stays without a heartbeat monitor', () => {
    const manager = new PeerConnectionManager({ isHost: true });
    const resumed = [];
    manager.on('peerActivityResumed', ({ peerId }) => resumed.push(peerId));

    manager._peers.set('gone', createOpenPeerConnectionStub('closed'));
    manager.recordPeerActivity('gone');
    manager.recordPeerActivity('never-known');

    assert.equal(manager._heartbeats.has('gone'), false);
    assert.equal(manager._heartbeats.has('never-known'), false);
    assert.deepEqual(resumed, []);

    manager.dispose();
});

test('host keeps a peer that reports back after a heartbeat timeout', async () => {
    const adapter = new LANSessionAdapter({ isHost: true, reconnectWindowMs: 40, now: () => 0 });
    const reconnected = [];
    const removed = [];
    adapter.on('playerReconnected', ({ peerId }) => reconnected.push(peerId));
    adapter.on('playerRemoved', ({ peerId }) => removed.push(peerId));

    adapter._peerManager._peers.set('peer-1', createOpenPeerConnectionStub());
    adapter._peerManager._connectedPeers.add('peer-1');
    adapter._peerManager._startHeartbeat('peer-1');

    // Host main thread blocked for more than five seconds (arena loading):
    // the heartbeat monitor times out and arms the removal timer.
    adapter._peerManager._stopHeartbeat('peer-1');
    adapter._peerManager._emit('heartbeatTimeout', { peerId: 'peer-1' });
    assert.equal(adapter._disconnectedPeers.has('peer-1'), true);

    // The peer answers again over the still-open data channel.
    adapter._handleMessage('peer-1', 'state', { type: MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT_ACK });

    assert.equal(adapter._peerManager._heartbeats.has('peer-1'), true, 'the heartbeat has to run again');
    assert.equal(adapter._disconnectedPeers.has('peer-1'), false, 'the removal timer has to be cancelled');
    assert.deepEqual(reconnected, ['peer-1']);

    await delay(120);
    assert.deepEqual(removed, [], 'a working connection must not be dropped');

    adapter.dispose();
});

test('host still removes a peer that stays silent after a heartbeat timeout', async () => {
    const adapter = new LANSessionAdapter({ isHost: true, reconnectWindowMs: 30, now: () => 0 });
    const removed = [];
    adapter.on('playerRemoved', ({ peerId }) => removed.push(peerId));

    adapter._peerManager._peers.set('peer-2', createOpenPeerConnectionStub());
    adapter._peerManager._emit('heartbeatTimeout', { peerId: 'peer-2' });

    await delay(120);
    assert.deepEqual(removed, ['peer-2']);

    adapter.dispose();
});
