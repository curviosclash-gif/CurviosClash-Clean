import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_BASE } from '../src/core/Config.js';
import { cloneJsonValue } from '../src/shared/utils/JsonClone.js';
import {
    getTuningParameterDescriptor,
    getTuningParameterDescriptors,
} from '../src/dev/tuning/TuningParameterRegistry.js';
import { TuningRuntimeBridge } from '../src/dev/tuning/TuningRuntimeBridge.js';

test('tuning parameter registry exposes core gameplay and bot profile paths', () => {
    const descriptors = getTuningParameterDescriptors();

    assert.ok(descriptors.length > 0);
    assert.ok(descriptors.some((descriptor) => descriptor.path === 'PLAYER.SPEED'));
    assert.ok(descriptors.some((descriptor) => descriptor.path.startsWith('BOT.DIFFICULTY_PROFILES.EASY.')));
});

test('tuning runtime bridge writes values and refreshes active runtime config after mutation', () => {
    const baseConfig = cloneJsonValue(CONFIG_BASE);
    const refreshCalls = [];
    const bridge = new TuningRuntimeBridge({
        configBase: baseConfig,
        refreshRuntimeConfig: () => {
            refreshCalls.push('refresh');
            return true;
        },
    });

    const result = bridge.setValue('PLAYER.SPEED', 17.5);

    assert.equal(result.ok, true);
    assert.equal(baseConfig.PLAYER.SPEED, 17.5);
    assert.equal(refreshCalls.length, 1);
});

test('tuning runtime bridge mutates frozen HUNT branch values without throwing', () => {
    const baseConfig = cloneJsonValue(CONFIG_BASE);
    const originalDamage = Number(baseConfig.HUNT?.MG?.DAMAGE || 0);
    baseConfig.HUNT.MG = Object.freeze({ ...baseConfig.HUNT.MG });
    const refreshCalls = [];
    const bridge = new TuningRuntimeBridge({
        configBase: baseConfig,
        refreshRuntimeConfig: () => {
            refreshCalls.push('refresh');
            return true;
        },
    });

    const result = bridge.setValue('HUNT.MG.DAMAGE', originalDamage + 1.25);

    assert.equal(result.ok, true);
    assert.equal(baseConfig.HUNT.MG.DAMAGE, originalDamage + 1.25);
    assert.equal(refreshCalls.length, 1);
});

test('tuning runtime bridge blocks readonly PPO_V2 paths', (t) => {
    const readonlyDescriptor = getTuningParameterDescriptors().find(
        (descriptor) => descriptor.path.startsWith('BOT.DIFFICULTY_PROFILES.PPO_V2.')
    );
    if (!readonlyDescriptor) {
        t.skip('PPO_V2 descriptor not available in current config');
        return;
    }
    const bridge = new TuningRuntimeBridge({
        configBase: cloneJsonValue(CONFIG_BASE),
        refreshRuntimeConfig: () => true,
    });

    const result = bridge.setValue(readonlyDescriptor.path, 1);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'readonly_path');
    assert.equal(getTuningParameterDescriptor(readonlyDescriptor.path)?.readOnly, true);
});
