import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ObservationBridgePolicy } from '../src/entities/ai/ObservationBridgePolicy.js';

// Moved from tests/physics-policy.spec.js (P3): every test builds the policy, its
// fallback and its inference stub by hand. T80 swaps the global WebSocket for a
// stub exactly as the original browser test did - WebSocketInferenceBridge reads
// the bare `WebSocket` global in both runtimes, and the stub is restored again.

function createRuntimeContext(observation) {
    return {
        mode: 'classic',
        dt: 1 / 60,
        players: [],
        projectiles: [],
        observation,
    };
}

test('T80: ObservationBridgePolicy faellt bei Trainer-Timeout auf lokale Policy zurueck', async () => {
    const originalWebSocket = globalThis.WebSocket;
    let fallbackCalls = 0;

    class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
            this.readyState = MockWebSocket.OPEN;
            this._listeners = new Map();
            setTimeout(() => this._emit('open', {}), 0);
        }

        addEventListener(type, handler) {
            if (!this._listeners.has(type)) {
                this._listeners.set(type, []);
            }
            this._listeners.get(type).push(handler);
        }

        removeEventListener(type, handler) {
            const handlers = this._listeners.get(type) || [];
            this._listeners.set(type, handlers.filter((entry) => entry !== handler));
        }

        _emit(type, event) {
            const handlers = this._listeners.get(type) || [];
            handlers.forEach((handler) => handler(event));
        }

        send() {
            // intentionally no response to trigger timeout path
        }

        close() {
            this.readyState = MockWebSocket.CLOSED;
            this._emit('close', {});
        }
    }

    globalThis.WebSocket = MockWebSocket;
    let result = null;
    try {
        const fallbackPolicy = {
            type: 'rule-based',
            update() {
                fallbackCalls++;
                return { yawLeft: true };
            },
        };
        const policy = new ObservationBridgePolicy({
            type: 'classic-bridge',
            fallbackPolicy,
            trainerBridgeEnabled: true,
            trainerBridgeTimeoutMs: 8,
            trainerBridgeUrl: 'ws://127.0.0.1:8765',
        });
        const bot = { index: 0, inventory: [] };
        const context = createRuntimeContext(new Array(40).fill(0));

        const firstAction = policy.update(1 / 60, bot, context);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const secondAction = policy.update(1 / 60, bot, context);

        policy.reset();
        result = {
            firstYawLeft: !!firstAction?.yawLeft,
            secondYawLeft: !!secondAction?.yawLeft,
            fallbackCalls,
        };
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }

    assert.ok(result.firstYawLeft);
    assert.ok(result.secondYawLeft);
    assert.ok(result.fallbackCalls >= 2);
});

test('T80b: ObservationBridgePolicy faellt bei lokaler Inference ohne Vokabular auf Fallback zurueck', () => {
    let fallbackCalls = 0;
    const fallbackPolicy = {
        type: 'rule-based',
        update() {
            fallbackCalls += 1;
            return { yawRight: true, boost: true };
        },
    };
    const policy = new ObservationBridgePolicy({
        type: 'classic-bridge',
        fallbackPolicy,
        trainerBridgeEnabled: false,
    });
    policy._localInference = {
        loaded: true,
        selectBestAction() {
            return { actionIndex: 4 };
        },
    };
    policy._localInferenceVocabulary = null;

    const bot = { index: 0, inventory: [] };
    const context = createRuntimeContext(new Array(40).fill(0));
    const action = policy.update(1 / 60, bot, context);
    const result = {
        fallbackCalls,
        yawRight: !!action?.yawRight,
        boost: !!action?.boost,
        yawLeft: !!action?.yawLeft,
    };

    assert.ok(result.fallbackCalls >= 1);
    assert.ok(result.yawRight);
    assert.ok(result.boost);
    assert.ok(!result.yawLeft);
});

test('T80c: ObservationBridgePolicy injiziert Fallback-Lenkung bei lokaler No-Steer-Action', () => {
    let fallbackCalls = 0;
    const fallbackPolicy = {
        type: 'rule-based',
        update() {
            fallbackCalls += 1;
            return { yawLeft: true };
        },
    };
    const policy = new ObservationBridgePolicy({
        type: 'classic-bridge',
        fallbackPolicy,
        trainerBridgeEnabled: false,
    });
    policy._localInference = {
        loaded: true,
        selectBestAction() {
            return { actionIndex: 5 };
        },
    };
    policy._localInferenceVocabulary = {
        decode() {
            return { boost: true };
        },
    };

    const bot = { index: 0, inventory: [] };
    const context = createRuntimeContext(new Array(40).fill(0.2));
    const action = policy.update(1 / 60, bot, context);
    const result = {
        fallbackCalls,
        yawLeft: !!action?.yawLeft,
        boost: !!action?.boost,
        yawRight: !!action?.yawRight,
    };

    assert.ok(result.fallbackCalls >= 1);
    assert.ok(result.yawLeft);
    assert.ok(result.boost);
    assert.ok(!result.yawRight);
});

test('T80d: ObservationBridgePolicy bevorzugt Steering statt lokaler boost-only Top-Action', () => {
    let fallbackCalls = 0;
    const fallbackPolicy = {
        type: 'rule-based',
        update() {
            fallbackCalls += 1;
            return { yawRight: true };
        },
    };
    const policy = new ObservationBridgePolicy({
        type: 'classic-bridge',
        fallbackPolicy,
        trainerBridgeEnabled: false,
    });
    policy._localInference = {
        loaded: true,
        predict() {
            const q = new Array(6).fill(0);
            q[1] = 0.7; // steering candidate
            q[5] = 1.0; // boost-only top action
            return q;
        },
        selectBestAction() {
            return { actionIndex: 5 };
        },
    };
    policy._localInferenceVocabulary = {
        decode(index) {
            if (index === 5) return { boost: true };
            if (index === 1) return { yawLeft: true };
            return {};
        },
    };

    const bot = { index: 0, inventory: [] };
    const context = createRuntimeContext(new Array(40).fill(0.2));
    const action = policy.update(1 / 60, bot, context);
    const result = {
        fallbackCalls,
        yawLeft: !!action?.yawLeft,
        boost: !!action?.boost,
        yawRight: !!action?.yawRight,
    };

    assert.strictEqual(result.fallbackCalls, 0);
    assert.ok(result.yawLeft);
    assert.ok(!result.boost);
    assert.ok(!result.yawRight);
});
