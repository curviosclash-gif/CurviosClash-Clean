import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitizeBotAction } from '../src/entities/ai/actions/BotActionContract.js';

// Moved from tests/physics-policy.spec.js (P3): the assertions below only touch
// pure functions, so they no longer need an Electron window to run.

test('T65: Bot-Action-Contract sanitizt invalide Payloads robust', () => {
    const warnings = [];
    const sanitized = sanitizeBotAction({
        yawLeft: 'true',
        boost: 1,
        shootItem: 'yes',
        shootItemIndex: 99,
        useItem: -5,
    }, {
        inventoryLength: 3,
        onInvalid: (message) => warnings.push(String(message || '')),
    });
    const invalidPayload = sanitizeBotAction(null, {
        inventoryLength: 3,
        onInvalid: (message) => warnings.push(String(message || '')),
    });
    const result = { sanitized, invalidPayload, warnings };

    assert.ok(result.sanitized.yawLeft);
    assert.ok(result.sanitized.boost);
    assert.ok(result.sanitized.shootItem);
    assert.strictEqual(result.sanitized.shootItemIndex, 2);
    assert.strictEqual(result.sanitized.useItem, -1);
    assert.ok(!result.invalidPayload.shootItem);
    assert.strictEqual(result.invalidPayload.shootItemIndex, -1);
    assert.ok(result.warnings.length > 0);
});
