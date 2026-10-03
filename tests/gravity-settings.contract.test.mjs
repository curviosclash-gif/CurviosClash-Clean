import assert from 'node:assert/strict';
import test from 'node:test';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createRuntimeConfigSnapshot, applyRuntimeConfigCompatibility } from '../src/core/RuntimeConfig.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';
import { handleLevel4ResetAction } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import * as THREE from 'three';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';

test('gravity settings default to 20 and clamp saved values to 0..50', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    assert.equal(manager.createDefaultSettings().gameplay.gravityStrength, 20);
    for (const [value, expected] of [[-5, 0], [0, 0], [20, 20], [50, 50], [99, 50], [undefined, 20]]) {
        const settings = manager.sanitizeSettings({ gameplay: { gravityStrength: value } });
        assert.equal(settings.gameplay.gravityStrength, expected);
        const runtime = createRuntimeConfigSnapshot(settings);
        assert.equal(runtime.player.gravityStrength, expected);
        assert.equal(createEntityRuntimeConfig(runtime).PLAYER.GRAVITY_STRENGTH, expected);
        assert.equal(applyRuntimeConfigCompatibility(runtime).PLAYER.GRAVITY_STRENGTH, expected);
        manager.saveSettings(settings);
        assert.equal(manager.loadSettings().gameplay.gravityStrength, expected);
    }
});

test('fine settings reset restores gravity 20 and publishes its change key', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.gameplay.gravityStrength = 50;
    let changedKeys;
    const game = { settings, settingsManager: manager, _showStatusToast() {} };
    handleLevel4ResetAction({ game, onSettingsChanged: (event) => { changedKeys = event.changedKeys; } });
    assert.equal(settings.gameplay.gravityStrength, 20);
    assert.ok(changedKeys.includes(SETTINGS_CHANGE_KEYS.GAMEPLAY_GRAVITY_STRENGTH));
});

test('maximum dive speed still detects a thin wall with the smallest non-Arcade vehicle', () => {
    const distance = (45 * 2.3 * 1.6 * 1.5 + 135) / 24;
    const radius = 0.8 * 0.6;
    // Halfway between the old capped sweep samples, outside their probe spheres.
    const wallY = distance / 32;
    const phase = new PlayerCollisionPhase({ arena: {
        getCollisionInfo(point, probeRadius) {
            return Math.abs(point.y - wallY) <= probeRadius
                ? { hit: true, normal: new THREE.Vector3(0, -1, 0) } : null;
        },
    } });
    const player = { position: new THREE.Vector3(0, distance, 0), isBot: false };
    assert.ok(phase._probeSweptArenaCollision(player, new THREE.Vector3(), radius)?.hit);
});
