import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createNetworkLocalInputSource,
    createNetworkRemoteInputSource,
    createPassiveNetworkInputSource,
    normalizeNetworkInputState,
} from '../src/ui/NetworkMatchInputSources.js';

function createSessionStub() {
    const handlers = new Map();
    return {
        sentInputs: [],
        sendInput(payload) {
            this.sentInputs.push(payload);
        },
        on(eventName, handler) {
            handlers.set(eventName, handler);
        },
        off(eventName, handler) {
            if (handlers.get(eventName) === handler) handlers.delete(eventName);
        },
        emit(eventName, payload) {
            handlers.get(eventName)?.(payload);
        },
    };
}

test('normalizeNetworkInputState keeps finite analog axes, rounded and clamped', () => {
    const normalized = normalizeNetworkInputState({
        pitchAxis: 0.4321,
        yawAxis: -1.7,
        rollAxis: Number.NaN,
        yawLeft: true,
        slowMo: true,
        slowMoPressed: true,
    });

    assert.equal(normalized.pitchAxis, 0.432);
    assert.equal(normalized.yawAxis, -1);
    assert.equal(Object.hasOwn(normalized, 'rollAxis'), false);
    assert.equal(normalized.yawLeft, true);
    assert.equal(normalized.slowMo, true);
    assert.equal(normalized.slowMoPressed, true);
});

test('normalizeNetworkInputState leaves keyboard-only state without axis fields', () => {
    const normalized = normalizeNetworkInputState({ pitchUp: true, rollRight: true });

    assert.equal(Object.hasOwn(normalized, 'pitchAxis'), false);
    assert.equal(Object.hasOwn(normalized, 'yawAxis'), false);
    assert.equal(Object.hasOwn(normalized, 'rollAxis'), false);
    assert.equal(normalized.pitchUp, true);
    assert.equal(normalized.rollRight, true);
});

test('normalizeNetworkInputState ignores non numeric axis values', () => {
    const normalized = normalizeNetworkInputState({ pitchAxis: null, yawAxis: 'left', rollAxis: 0 });

    assert.equal(Object.hasOwn(normalized, 'pitchAxis'), false);
    assert.equal(Object.hasOwn(normalized, 'yawAxis'), false);
    assert.equal(normalized.rollAxis, 0);
});

test('local network input source returns and sends the analog axes', () => {
    const session = createSessionStub();
    const source = createNetworkLocalInputSource({
        source: {
            poll: () => ({ pitchAxis: -0.25, yawAxis: 0.6667, boost: true }),
        },
        session,
        playerId: 'peer-1',
        sendToSession: true,
    });
    source.bind(0);

    const polled = source.poll();

    assert.equal(polled.pitchAxis, -0.25);
    assert.equal(polled.yawAxis, 0.667);
    assert.equal(polled.boost, true);
    assert.equal(session.sentInputs.length, 1);
    assert.equal(session.sentInputs[0].pitchAxis, -0.25);
    assert.equal(session.sentInputs[0].yawAxis, 0.667);
    assert.equal(session.sentInputs[0].playerId, 'peer-1');
    assert.equal(session.sentInputs[0].playerIndex, 0);
});

test('remote network input source carries the analog axes from the event', () => {
    const session = createSessionStub();
    const source = createNetworkRemoteInputSource({ session, peerId: 'peer-2' });
    source.bind(1);

    session.emit('remoteInput', {
        peerId: 'peer-2',
        input: { rollAxis: 0.5, pitchUp: true },
    });

    const polled = source.poll();
    assert.equal(polled.rollAxis, 0.5);
    assert.equal(polled.pitchUp, true);
    assert.equal(Object.hasOwn(polled, 'yawAxis'), false);
    source.unbind();
});

test('remote network input consumes one-shot actions exactly once without losing them', () => {
    const session = createSessionStub();
    const source = createNetworkRemoteInputSource({ session, peerId: 'peer-2' });
    source.bind(1);
    const oneShotKeys = [
        'boostPressed',
        'slowMoPressed',
        'cameraSwitch',
        'dropItem',
        'useItem',
        'shootItem',
        'shootRocket',
        'nextItem',
    ];

    session.emit('remoteInput', {
        peerId: 'peer-2',
        input: Object.fromEntries(oneShotKeys.map((key) => [key, true])),
    });
    session.emit('remoteInput', {
        peerId: 'peer-2',
        input: { yawLeft: true },
    });

    const firstPoll = source.poll();
    const secondPoll = source.poll();
    for (const key of oneShotKeys) {
        assert.equal(firstPoll[key], true, `${key} survives until the host consumes it`);
        assert.equal(secondPoll[key], false, `${key} is not repeated on the next host tick`);
    }
    assert.equal(firstPoll.yawLeft, true, 'held input still follows the newest packet');
    assert.equal(secondPoll.yawLeft, true, 'held input remains active until a packet releases it');
});

test('remote network input clears when its peer disconnects or the lifecycle resets it', () => {
    const session = createSessionStub();
    const source = createNetworkRemoteInputSource({ session, peerId: 'peer-2' });
    source.bind(1);

    session.emit('remoteInput', {
        peerId: 'peer-2',
        input: { boost: true, shootMG: true, shootRocket: true, yawAxis: 0.8 },
    });
    session.emit('playerDisconnected', { peerId: 'other-peer' });
    assert.equal(source.poll().shootMG, true, 'another peer does not clear this slot');

    session.emit('playerDisconnected', { peerId: 'peer-2', canReconnect: true });
    const disconnected = source.poll();
    assert.equal(disconnected.boost, false);
    assert.equal(disconnected.shootMG, false);
    assert.equal(disconnected.shootRocket, false);
    assert.equal(Object.hasOwn(disconnected, 'yawAxis'), false);

    session.emit('remoteInput', {
        peerId: 'peer-2',
        input: { pitchDown: true, useItem: true },
    });
    source.clearInputState();
    const reset = source.poll();
    assert.equal(reset.pitchDown, false);
    assert.equal(reset.useItem, false);
});

test('passive network input source stays free of analog axes', () => {
    const polled = createPassiveNetworkInputSource().poll();

    assert.equal(Object.hasOwn(polled, 'pitchAxis'), false);
    assert.equal(Object.hasOwn(polled, 'yawAxis'), false);
    assert.equal(Object.hasOwn(polled, 'rollAxis'), false);
});
