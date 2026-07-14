import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSocketInferenceBridge } from '../src/entities/ai/inference/WebSocketInferenceBridge.js';
import { buildRuntimeInferenceObservationPayload } from '../src/entities/ai/inference/RuntimeInferencePayloadAdapter.js';
import { DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH } from '../src/entities/ai/observation/RuntimeNearObservationAdapter.js';

function createSocketFactory(sentEnvelopes) {
    return () => {
        const listeners = new Map();
        const emit = (type, payload) => {
            for (const handler of listeners.get(type) || []) handler(payload);
        };
        const socket = {
            readyState: 0,
            addEventListener(type, handler) {
                listeners.set(type, [...(listeners.get(type) || []), handler]);
            },
            removeEventListener(type, handler) {
                listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== handler));
            },
            send(raw) {
                const envelope = JSON.parse(raw);
                sentEnvelopes.push(envelope);
                setTimeout(() => emit('message', {
                    data: JSON.stringify({
                        id: envelope.id,
                        action: { yawRight: true, requestTick: envelope.payload?.requestTick || 0 },
                    }),
                }), 0);
            },
            close() {
                this.readyState = 3;
            },
        };
        setTimeout(() => {
            socket.readyState = 1;
            emit('open', {});
            emit('message', { data: JSON.stringify({ type: 'inference-ready', ok: true }) });
        }, 0);
        return socket;
    };
}

test('runtime inference websocket transports actions without training management APIs', async () => {
    const sent = [];
    const bridge = new WebSocketInferenceBridge({
        enabled: true,
        timeoutMs: 100,
        socketFactory: createSocketFactory(sent),
    });

    assert.equal(await bridge.waitForReady(250), true);
    bridge.submitObservation({ requestTick: 7, observation: [0, 1] });
    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.deepEqual(bridge.consumeLatestAction(), { yawRight: true, requestTick: 7 });
    assert.equal(sent[0]?.type, 'bot-action-request');
    assert.equal(typeof bridge.submitTrainingStep, 'undefined');
    assert.equal(typeof bridge.submitTrainingReset, 'undefined');
    assert.equal(typeof bridge.submitCommand, 'undefined');
    assert.equal(bridge.getTelemetrySnapshot().actionResponses, 1);
    bridge.close();
});

test('runtime inference payload preserves mode, controls, observation and player state', () => {
    const payload = buildRuntimeInferenceObservationPayload({
        mode: 'fight',
        dt: 1 / 60,
        rules: { planarMode: true, controlProfileId: 'custom-fight-2d' },
        observation: new Array(40).fill(0.25),
    }, {
        index: 2,
        hp: 80,
        maxHp: 100,
        inventory: [{ type: 'boost' }],
    });

    assert.equal(payload.mode, 'fight');
    assert.equal(payload.planarMode, true);
    assert.equal(payload.domainId, 'fight-2d');
    assert.equal(payload.controlProfileId, 'custom-fight-2d');
    assert.equal(payload.observation.length, DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH);
    assert.equal(payload.player.index, 2);
    assert.equal(payload.player.inventoryLength, 1);
});
