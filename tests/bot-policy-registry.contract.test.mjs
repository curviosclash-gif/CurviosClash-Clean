import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BotPolicyRegistry } from '../src/entities/ai/BotPolicyRegistry.js';
import { BOT_POLICY_TYPES } from '../src/entities/ai/BotPolicyTypes.js';

// Moved from tests/physics-policy.spec.js (P3): the registry is constructed from
// scratch in both tests, so no running match is involved.

test('T73: BotPolicyRegistry registriert Legacy- und Match-Bot-Typen', () => {
    const registry = new BotPolicyRegistry();
    const classicBridge = registry.create(BOT_POLICY_TYPES.CLASSIC_BRIDGE);
    const huntBridge = registry.create(BOT_POLICY_TYPES.HUNT_BRIDGE);
    const classic3d = registry.create(BOT_POLICY_TYPES.CLASSIC_3D);
    const classic2d = registry.create(BOT_POLICY_TYPES.CLASSIC_2D);
    const hunt3d = registry.create(BOT_POLICY_TYPES.HUNT_3D);
    const hunt2d = registry.create(BOT_POLICY_TYPES.HUNT_2D);

    const result = {
        classicType: classicBridge?.type,
        huntType: huntBridge?.type,
        classic3dType: classic3d?.type,
        classic2dType: classic2d?.type,
        hunt3dType: hunt3d?.type,
        hunt2dType: hunt2d?.type,
        classicUsesRuntimeContext: classicBridge?.usesRuntimeContext === true,
        huntUsesRuntimeContext: huntBridge?.usesRuntimeContext === true,
        matchUsesRuntimeContext: [classic3d, classic2d, hunt3d, hunt2d]
            .every((policy) => policy?.usesRuntimeContext === true),
        classicHasUpdate: typeof classicBridge?.update === 'function',
        huntHasUpdate: typeof huntBridge?.update === 'function',
        matchHasUpdate: [classic3d, classic2d, hunt3d, hunt2d]
            .every((policy) => typeof policy?.update === 'function'),
    };

    assert.strictEqual(result.classicType, 'classic-bridge');
    assert.strictEqual(result.huntType, 'hunt-bridge');
    assert.strictEqual(result.classic3dType, 'classic-3d');
    assert.strictEqual(result.classic2dType, 'classic-2d');
    assert.strictEqual(result.hunt3dType, 'hunt-3d');
    assert.strictEqual(result.hunt2dType, 'hunt-2d');
    assert.ok(result.classicUsesRuntimeContext);
    assert.ok(result.huntUsesRuntimeContext);
    assert.ok(result.matchUsesRuntimeContext);
    assert.ok(result.classicHasUpdate);
    assert.ok(result.huntHasUpdate);
    assert.ok(result.matchHasUpdate);
});

test('T74: BotPolicyRegistry faellt bei Fehlkonfiguration kontrolliert auf rule-based zurueck', () => {
    const registry = new BotPolicyRegistry();
    registry.register('broken-bridge', () => {
        throw new Error('simulated-registry-factory-error');
    });

    const unknown = registry.create('unknown-policy-type');
    const broken = registry.create('broken-bridge');
    const disabledBridge = registry.create(BOT_POLICY_TYPES.CLASSIC_BRIDGE, { bridgeEnabled: false });
    const disabledMatchBot = registry.create(BOT_POLICY_TYPES.HUNT_2D, { bridgeEnabled: false });

    const result = {
        unknownType: unknown?.type,
        brokenType: broken?.type,
        disabledBridgeType: disabledBridge?.type,
        disabledMatchBotType: disabledMatchBot?.type,
        unknownHasUpdate: typeof unknown?.update === 'function',
        brokenHasUpdate: typeof broken?.update === 'function',
    };

    assert.strictEqual(result.unknownType, 'rule-based');
    assert.strictEqual(result.brokenType, 'rule-based');
    assert.strictEqual(result.disabledBridgeType, 'classic-bridge');
    assert.strictEqual(result.disabledMatchBotType, 'hunt-2d');
    assert.ok(result.unknownHasUpdate);
    assert.ok(result.brokenHasUpdate);
});
