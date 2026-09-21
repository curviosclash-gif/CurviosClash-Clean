import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

test('active Fight builds survive an unrelated settings save and reach the next match', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const settings = manager.loadSettings();
    settings.gameMode = 'HUNT';
    settings.vehicles.PLAYER_1 = 'ship5';
    settings.localSettings.modePath = 'fight';
    settings.localSettings.fightHangar = {
        activeBonusesByVehicle: {
            ship5: { speedBonusPct: 4, turningBonusPct: -2, maxHpBonus: -6, machineGunId: 'raptor_r9' },
        },
    };

    assert.equal(manager.saveSettings(settings).success, true);
    const changedSettings = manager.loadSettings();
    changedSettings.gameplay.speed += 1;
    assert.equal(manager.saveSettings(changedSettings).success, true);

    const persisted = storagePlatform.getRecord(STORAGE_KEYS.settings);
    const expected = { speedBonusPct: 4, turningBonusPct: -2, maxHpBonus: -6, machineGunId: 'raptor_r9' };
    assert.deepEqual(persisted.localSettings.fightHangar.activeBonusesByVehicle.ship5, expected);
    assert.deepEqual(manager.loadSettings().localSettings.fightHangar.activeBonusesByVehicle.ship5, expected);
    assert.deepEqual(createRuntimeConfigSnapshot(manager.loadSettings()).player.fightLoadouts.PLAYER_1, expected);
});

test('Fight build persistence clamps known values and drops unknown fields', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const sanitized = manager.sanitizeSettings({
        localSettings: {
            fightHangar: {
                activeBonusesByVehicle: {
                    ship5: {
                        speedBonusPct: 999,
                        turningBonusPct: -999,
                        maxHpBonus: 999,
                        machineGunId: 'bastion_h3',
                        unexpected: 'not persisted',
                    },
                },
                unexpected: 'not persisted',
            },
        },
    });

    assert.deepEqual(sanitized.localSettings.fightHangar, {
        activeBonusesByVehicle: {
            ship5: { speedBonusPct: 30, turningBonusPct: -30, maxHpBonus: 60, machineGunId: 'bastion_h3' },
        },
    });
    assert.deepEqual(manager.sanitizeSettings(sanitized), sanitized);
});

test('Fight build persistence ignores unsafe vehicle keys and invalid weapon IDs', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const activeBonusesByVehicle = JSON.parse('{"__proto__":{"maxHpBonus":60},"ship5":{"machineGunId":"unknown"}}');
    const sanitized = manager.sanitizeSettings({ localSettings: { fightHangar: { activeBonusesByVehicle } } });

    assert.deepEqual(Object.keys(sanitized.localSettings.fightHangar.activeBonusesByVehicle), ['ship5']);
    assert.equal(sanitized.localSettings.fightHangar.activeBonusesByVehicle.ship5.machineGunId, 'vector_m7');
});
