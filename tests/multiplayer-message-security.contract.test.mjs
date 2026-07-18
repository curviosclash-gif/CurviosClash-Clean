import assert from 'node:assert/strict';
import test from 'node:test';

import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import { MULTIPLAYER_MESSAGE_TYPES } from '../src/shared/contracts/MultiplayerSessionContract.js';

function captureEvents(adapter) {
    const events = [];
    adapter._emit = (type, payload) => events.push({ type, payload });
    return events;
}

test('online data messages use the transport peer identity and enforce sender roles', () => {
    const host = new OnlineSessionAdapter({ isHost: true });
    host._hostPeerId = 'host-peer';
    const hostEvents = captureEvents(host);
    host._handleDataMessage('client-peer', 'inputs', {
        type: MULTIPLAYER_MESSAGE_TYPES.INPUT,
        playerId: 'victim-peer',
        inputs: { turn: 1 },
    });
    assert.equal(hostEvents[0].payload.playerId, 'client-peer');

    host._handleDataMessage('client-peer', 'state', {
        type: MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT,
        tick: 4,
    });
    assert.equal(hostEvents.some((entry) => entry.type === 'stateUpdate'), false);

    const client = new OnlineSessionAdapter({ isHost: false });
    client._hostPeerId = 'host-peer';
    const clientEvents = captureEvents(client);
    client._handleDataMessage('other-client', 'state', {
        type: MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT,
    });
    client._handleDataMessage('host-peer', 'state', {
        type: MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT,
    });
    assert.equal(clientEvents.filter((entry) => entry.type === 'stateUpdate').length, 1);
    host.dispose();
    client.dispose();
});

test('LAN data messages reject client host-authority and bind leave to the channel peer', () => {
    const host = new LANSessionAdapter({ isHost: true });
    const events = captureEvents(host);
    host._closePeerConnection = (peerId) => events.push({ type: 'closed', payload: peerId });
    host._removePeerLatency = () => {};

    host._handleMessage('player-1', 'state', {
        type: MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING,
    });
    assert.equal(events.length, 0);

    host._handleMessage('player-1', 'state', {
        type: MULTIPLAYER_MESSAGE_TYPES.LEAVE,
        playerId: 'player-2',
    });
    assert.equal(events[0].payload, 'player-1');
    assert.equal(events[1].payload.peerId, 'player-1');
    host.dispose();
});
