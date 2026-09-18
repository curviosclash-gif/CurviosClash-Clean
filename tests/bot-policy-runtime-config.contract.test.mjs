import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';

// Moved from tests/physics-policy.spec.js (P3): snapshot resolution is a pure
// settings-to-config mapping and never touched the running match.

test('T79: RuntimeConfig setzt Trainer-WebSocket-Flag standardmaessig auf false', () => {
    const snapshot = createRuntimeConfigSnapshot({});
    const result = {
        policyStrategy: String(snapshot?.bot?.policyStrategy || ''),
        policyType: String(snapshot?.bot?.policyType || ''),
        trainerBridgeEnabled: !!snapshot?.bot?.trainerBridgeEnabled,
        trainerBridgeUrl: String(snapshot?.bot?.trainerBridgeUrl || ''),
        trainerBridgeTimeoutMs: Number(snapshot?.bot?.trainerBridgeTimeoutMs || 0),
        trainerBridgeMaxRetries: Number(snapshot?.bot?.trainerBridgeMaxRetries || 0),
        trainerBridgeRetryDelayMs: Number(snapshot?.bot?.trainerBridgeRetryDelayMs || 0),
        trainerCheckpointResumeToken: String(snapshot?.bot?.trainerCheckpointResumeToken || ''),
        trainerCheckpointResumeStrict: !!snapshot?.bot?.trainerCheckpointResumeStrict,
    };

    assert.strictEqual(result.policyStrategy, 'auto');
    assert.strictEqual(result.policyType, 'classic-3d');
    assert.ok(!result.trainerBridgeEnabled);
    assert.ok(result.trainerBridgeUrl.startsWith('ws://'));
    assert.ok(result.trainerBridgeTimeoutMs >= 20);
    assert.ok(result.trainerBridgeMaxRetries >= 0);
    assert.ok(result.trainerBridgeRetryDelayMs >= 0);
    assert.strictEqual(result.trainerCheckpointResumeToken, '');
    assert.ok(!result.trainerCheckpointResumeStrict);
});

test('T79b: RuntimeConfig uebernimmt botBridge Resume- und Retry-Settings reproduzierbar', () => {
    const snapshot = createRuntimeConfigSnapshot({
        botBridge: {
            enabled: true,
            url: 'ws://127.0.0.1:9001',
            timeoutMs: 180,
            maxRetries: 3,
            retryDelayMs: 40,
            resumeCheckpoint: 'latest',
            resumeStrict: true,
        },
    });
    const result = {
        enabled: !!snapshot?.bot?.trainerBridgeEnabled,
        url: String(snapshot?.bot?.trainerBridgeUrl || ''),
        timeoutMs: Number(snapshot?.bot?.trainerBridgeTimeoutMs || 0),
        maxRetries: Number(snapshot?.bot?.trainerBridgeMaxRetries || 0),
        retryDelayMs: Number(snapshot?.bot?.trainerBridgeRetryDelayMs || 0),
        resumeToken: String(snapshot?.bot?.trainerCheckpointResumeToken || ''),
        resumeStrict: !!snapshot?.bot?.trainerCheckpointResumeStrict,
    };

    assert.ok(result.enabled);
    assert.strictEqual(result.url, 'ws://127.0.0.1:9001');
    assert.strictEqual(result.timeoutMs, 180);
    assert.strictEqual(result.maxRetries, 3);
    assert.strictEqual(result.retryDelayMs, 40);
    assert.strictEqual(result.resumeToken, 'latest');
    assert.ok(result.resumeStrict);
});

test('T81: RuntimeConfig loest Bot-Policy-Strategie reproduzierbar nach Modus auf', () => {
    const classic3dAuto = createRuntimeConfigSnapshot({
        gameMode: 'CLASSIC',
        gameplay: { planarMode: false },
        botPolicyStrategy: 'auto',
    });
    const classic2dAuto = createRuntimeConfigSnapshot({
        gameMode: 'CLASSIC',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'auto',
    });
    const hunt3dAuto = createRuntimeConfigSnapshot({
        gameMode: 'HUNT',
        gameplay: { planarMode: false },
        botPolicyStrategy: 'auto',
    });
    const hunt2dAuto = createRuntimeConfigSnapshot({
        gameMode: 'HUNT',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'auto',
    });
    const classicBridge = createRuntimeConfigSnapshot({
        gameMode: 'CLASSIC',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'bridge',
    });
    const huntBridge = createRuntimeConfigSnapshot({
        gameMode: 'HUNT',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'bridge',
    });
    const forcedRuleBased = createRuntimeConfigSnapshot({
        gameMode: 'HUNT',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'rule-based',
    });
    const invalidStrategy = createRuntimeConfigSnapshot({
        gameMode: 'CLASSIC',
        gameplay: { planarMode: true },
        botPolicyStrategy: 'unknown',
    });

    const result = {
        classic3dAuto: classic3dAuto?.bot?.policyType,
        classic2dAuto: classic2dAuto?.bot?.policyType,
        hunt3dAuto: hunt3dAuto?.bot?.policyType,
        hunt2dAuto: hunt2dAuto?.bot?.policyType,
        classicBridge: classicBridge?.bot?.policyType,
        huntBridge: huntBridge?.bot?.policyType,
        forcedRuleBased: forcedRuleBased?.bot?.policyType,
        invalidStrategyName: invalidStrategy?.bot?.policyStrategy,
        invalidStrategyPolicy: invalidStrategy?.bot?.policyType,
    };

    assert.strictEqual(result.classic3dAuto, 'classic-3d');
    assert.strictEqual(result.classic2dAuto, 'classic-2d');
    assert.strictEqual(result.hunt3dAuto, 'hunt-3d');
    assert.strictEqual(result.hunt2dAuto, 'hunt-2d');
    assert.strictEqual(result.classicBridge, 'classic-bridge');
    assert.strictEqual(result.huntBridge, 'hunt-bridge');
    assert.strictEqual(result.forcedRuleBased, 'rule-based');
    assert.strictEqual(result.invalidStrategyName, 'auto');
    assert.strictEqual(result.invalidStrategyPolicy, 'classic-2d');
});
