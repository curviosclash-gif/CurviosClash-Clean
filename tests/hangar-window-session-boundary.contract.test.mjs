import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { deriveMatchStartUiState } from '../src/shared/contracts/MatchUiStateContract.js';
import { applyHangarWindowStorageEvent } from '../src/ui/hangar/HangarWindowMenuBridge.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';

test('fight hangar selection preserves single-player session and opens the requested mode', () => {
    const settings = {
        mode: '1p',
        gameMode: 'HUNT',
        mapKey: 'maze',
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship6' },
        localSettings: {
            sessionType: 'single',
            modePath: 'fight',
            startSetup: { vehicleFilter: 'favorite' },
        },
    };
    const storedByHangar = {
        ...settings,
        mode: '2p',
        vehicles: { PLAYER_1: 'aircraft', PLAYER_2: 'ship6' },
        localSettings: {
            sessionType: 'splitscreen',
            modePath: 'arcade',
            startSetup: {
                modeSelections: {
                    fight: { mapKey: 'maze', vehicles: { PLAYER_1: 'aircraft', PLAYER_2: 'ship6' } },
                },
            },
            fightHangar: { activeBonusesByVehicle: { aircraft: { maxHpBonus: 20 } } },
        },
    };

    assert.equal(applyHangarWindowStorageEvent({
        key: STORAGE_KEYS.settings,
        newValue: JSON.stringify(storedByHangar),
    }, settings, {}), true);
    assert.equal(settings.vehicles.PLAYER_1, 'aircraft');
    assert.equal(settings.localSettings.sessionType, 'single');
    assert.equal(settings.localSettings.modePath, 'fight');
    assert.equal(settings.localSettings.startSetup.vehicleFilter, 'favorite');
    assert.equal(settings.localSettings.startSetup.modeSelections.fight.vehicles.PLAYER_1, 'aircraft');
    assert.equal(settings.localSettings.fightHangar.activeBonusesByVehicle.aircraft.maxHpBonus, 20);

    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.session.numHumans, 1);
    assert.equal(deriveMatchStartUiState({ numHumans: runtimeConfig.session.numHumans }).splitScreenEnabled, false);

    const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(electronMain, /openHangarWindow\(\{\s*mode:\s*options\?\.mode,\s*focus:/);
});
