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

test('passive network input source stays free of analog axes', () => {
    const polled = createPassiveNetworkInputSource().poll();

    assert.equal(Object.hasOwn(polled, 'pitchAxis'), false);
    assert.equal(Object.hasOwn(polled, 'yawAxis'), false);
    assert.equal(Object.hasOwn(polled, 'rollAxis'), false);
});
