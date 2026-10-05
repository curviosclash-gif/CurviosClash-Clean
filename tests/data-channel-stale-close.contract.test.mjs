import assert from 'node:assert/strict';
import test from 'node:test';

import { DataChannelManager } from '../src/network/DataChannelManager.js';

function createChannel(label) {
    return { label, readyState: 'open', close() { this.readyState = 'closed'; } };
}

function recordEvents(manager) {
    const events = [];
    for (const type of ['channelOpen', 'channelClose', 'message']) {
        manager.on(type, (payload) => events.push({ type, ...payload }));
    }
    return events;
}

test('a late close event from a replaced channel does not report the live peer as gone', () => {
    const manager = new DataChannelManager();
    const events = recordEvents(manager);
    const oldState = createChannel('state');
    const newState = createChannel('state');

    manager.handleIncomingChannel('peer-1', oldState);
    // Re-offer: the peer connection is rebuilt and a fresh state channel replaces the old one.
    manager.handleIncomingChannel('peer-1', newState);
    newState.onopen();
    oldState.onclose();
    oldState.onmessage({ data: '{"type":"PING"}' });

    assert.deepEqual(events.map((event) => event.type), ['channelOpen'], 'only the live channel may report');
    newState.onclose();
    assert.deepEqual(events.map((event) => event.type), ['channelOpen', 'channelClose']);
});

test('closing a peer locally does not echo a second disconnect', () => {
    const manager = new DataChannelManager();
    const events = recordEvents(manager);
    const state = createChannel('state');
    manager.handleIncomingChannel('peer-1', state);

    manager.closeChannels('peer-1');
    state.onclose?.();

    assert.deepEqual(events, [], 'removal already ran; the close event must not register a new disconnect');
});
