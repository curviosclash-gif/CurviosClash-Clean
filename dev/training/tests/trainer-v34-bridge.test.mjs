import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSocketTrainerBridge } from '../src/entities/ai/training/WebSocketTrainerBridge.js';

function createMockSocketFactory() {
    return () => {
        const listeners = new Map();
        const socket = {
            readyState: 0,
            addEventListener(type, handler) {
                const handlers = listeners.get(type) || [];
                handlers.push(handler);
                listeners.set(type, handlers);
            },
            removeEventListener(type, handler) {
                const handlers = listeners.get(type) || [];
                listeners.set(type, handlers.filter((entry) => entry !== handler));
            },
            send(raw) {
                const envelope = JSON.parse(raw);
                if (envelope.type === 'trainer-stats-request') {
                    setTimeout(() => {
                        emit('message', {
                            data: JSON.stringify({
                                id: envelope.id,
                                ok: true,
                                type: 'trainer-stats',
                                model: {
                                    optimizerSteps: 12,
                                    epsilon: 0.42,
                                },
                            }),
                        });
                    }, 0);
                    return;
                }
                if (envelope.type === 'training-step') {
                    setTimeout(() => {
                        emit('message', {
                            data: JSON.stringify({
                                id: envelope.id,
                                ok: true,
                                type: 'training-ack',
                                training: {
                                    trained: true,
                                    loss: 0.5,
                                    epsilon: 0.33,
                                    replayFill: 0.72,
                                    optimizerSteps: 7,
                                },
                            }),
                        });
                    }, 0);
                }
            },
            close() {
                this.readyState = 3;
                emit('close', {});
            },
        };

        const emit = (type, payload) => {
            const handlers = listeners.get(type) || [];
            for (const handler of handlers) {
                handler(payload);
            }
        };

        setTimeout(() => {
            socket.readyState = 1;
            emit('open', {});
            emit('message', {
                data: JSON.stringify({
                    ok: true,
                    type: 'trainer-ready',
                    protocolVersion: 'v34-trainer-v1',
                }),
            });
        }, 0);
        return socket;
    };
}

test('V34 bridge waits for trainer-ready and aggregates learning telemetry', async () => {
    const bridge = new WebSocketTrainerBridge({
        enabled: true,
        timeoutMs: 120,
        requireReadyMessage: true,
        socketFactory: createMockSocketFactory(),
    });

    const ready = await bridge.waitForReady(250);
    assert.equal(ready, true);

    bridge.submitTrainingStep({
        operation: 'step',
        episodeId: 'bridge-test',
        stepIndex: 1,
        reward: 0.25,
        observation: new Array(40).fill(0.1),
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    const statsResponse = await bridge.submitCommand('trainer-stats-request', {}, { timeoutMs: 300 });
    const telemetry = bridge.getTelemetrySnapshot();
    const readyPayload = bridge.consumeLatestReadyPayload();
    bridge.close();

    assert.equal(readyPayload?.type, 'trainer-ready');
    assert.equal(statsResponse?.ok, true);
    assert.equal(statsResponse?.type, 'trainer-stats');
    assert.equal(Number(telemetry.readyMessages) >= 1, true);
    assert.equal(Number(telemetry.learningReports) >= 1, true);
    assert.equal(Number(telemetry.learningUpdates) >= 1, true);
    assert.equal(telemetry.latestLoss, 0.5);
    assert.equal(telemetry.latestEpsilon, 0.33);
    assert.equal(telemetry.latestReplayFill, 0.72);
    assert.equal(Number(telemetry.commandResponses) >= 1, true);
    assert.equal(telemetry.pendingActionRequest, false);
    assert.equal(telemetry.pendingAckCount, 0);
    assert.equal(telemetry.pendingCommandCount, 0);
});
