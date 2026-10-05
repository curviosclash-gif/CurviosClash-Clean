import assert from 'node:assert/strict';
import test from 'node:test';

import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import { MULTIPLAYER_MESSAGE_TYPES } from '../src/shared/contracts/MultiplayerSessionContract.js';

function createLanClient() {
    const adapter = new LANSessionAdapter({ isHost: false, signalingUrl: 'http://lan.invalid' });
    return { adapter, hostPeerId: 'host', deliver: (peerId, channel, data) => adapter._handleMessage(peerId, channel, data) };
}

function createOnlineClient() {
    const adapter = new OnlineSessionAdapter({ isHost: false, signalingUrl: 'ws://localhost:1' });
    adapter._hostPeerId = 'peer-7';
    return { adapter, hostPeerId: 'peer-7', deliver: (peerId, channel, data) => adapter._handleDataMessage(peerId, channel, data) };
}

function captureSends(adapter) {
    const sent = [];
    adapter._dataChannelManager.send = (peerId, channel, message) => { sent.push({ peerId, channel, type: message?.type }); return true; };
    return sent;
}

for (const [name, createClient] of [['LAN', createLanClient], ['Online', createOnlineClient]]) {
    test(`${name}: a ping on the unreliable snapshot channel is answered on the reliable state channel`, () => {
        const { adapter, hostPeerId, deliver } = createClient();
        const sent = captureSends(adapter);
        deliver(hostPeerId, 'snapshots', { type: MULTIPLAYER_MESSAGE_TYPES.PING, pingId: 4 });
        assert.deepEqual(sent, [{ peerId: hostPeerId, channel: 'state', type: MULTIPLAYER_MESSAGE_TYPES.PONG }]);
        adapter.dispose();
    });

    test(`${name}: a ping on the input channel is answered on the input channel`, () => {
        const { adapter, hostPeerId, deliver } = createClient();
        const sent = captureSends(adapter);
        deliver(hostPeerId, 'inputs', { type: MULTIPLAYER_MESSAGE_TYPES.PING, pingId: 5 });
        assert.deepEqual(sent, [{ peerId: hostPeerId, channel: 'inputs', type: MULTIPLAYER_MESSAGE_TYPES.PONG }]);
        adapter.dispose();
    });

    test(`${name}: a host leaving message reports the host as gone`, () => {
        const { adapter, hostPeerId, deliver } = createClient();
        captureSends(adapter);
        const events = [];
        adapter.on('hostDisconnected', (event) => events.push(['hostDisconnected', event.reason]));
        adapter.on('playerDisconnected', (event) => events.push(['playerDisconnected', event.peerId, event.reason]));
        deliver(hostPeerId, 'state', { type: MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING });
        assert.deepEqual(events, [
            ['hostDisconnected', 'graceful-leave'],
            ['playerDisconnected', hostPeerId, 'host-leaving'],
        ]);
        assert.equal(adapter._clientDisconnectedPeers.has(hostPeerId), true);
        adapter.dispose();
    });
}
