import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasConfiguredOnlineSignalingUrl,
    resolveConfiguredOnlineSignalingUrl,
} from '../src/shared/contracts/OnlineSignalingConfig.js';

test('resolveConfiguredOnlineSignalingUrl prefers the explicit signaling URL option', () => {
    const resolved = resolveConfiguredOnlineSignalingUrl({
        signalingUrl: 'wss://direct.example.test',
        runtimeGlobal: {
            __SIGNALING_URL__: 'wss://runtime.example.test',
        },
    });

    assert.equal(resolved, 'wss://direct.example.test');
});

test('resolveConfiguredOnlineSignalingUrl falls back to the runtime global when present', () => {
    const resolved = resolveConfiguredOnlineSignalingUrl({
        runtimeGlobal: {
            __SIGNALING_URL__: 'wss://runtime.example.test',
        },
    });

    assert.equal(resolved, 'wss://runtime.example.test');
    assert.equal(hasConfiguredOnlineSignalingUrl({
        runtimeGlobal: {
            __SIGNALING_URL__: 'wss://runtime.example.test',
        },
    }), true);
});

test('resolveConfiguredOnlineSignalingUrl returns an empty string when nothing is configured', () => {
    const previousSignalingUrl = globalThis.__SIGNALING_URL__;
    const hadOwnSignalingUrl = Object.prototype.hasOwnProperty.call(globalThis, '__SIGNALING_URL__');
    delete globalThis.__SIGNALING_URL__;

    try {
        assert.equal(resolveConfiguredOnlineSignalingUrl({ runtimeGlobal: {} }), '');
        assert.equal(hasConfiguredOnlineSignalingUrl({ runtimeGlobal: {} }), false);
    } finally {
        if (hadOwnSignalingUrl) {
            globalThis.__SIGNALING_URL__ = previousSignalingUrl;
        } else {
            delete globalThis.__SIGNALING_URL__;
        }
    }
});
