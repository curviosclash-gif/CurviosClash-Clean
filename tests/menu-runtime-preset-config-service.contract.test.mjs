import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMenuPresetAction } from '../src/core/runtime/MenuRuntimePresetConfigService.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';

function createPresetGame(productSurfaceId = PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP) {
    const calls = {
        appliedPresetIds: [],
        settingsChanged: [],
        toasts: [],
    };
    const game = {
        settings: {
            localSettings: {},
        },
        settingsManager: {
            applyMenuPreset(_settings, presetId) {
                calls.appliedPresetIds.push(presetId);
                return {
                    success: true,
                    changedKeys: ['matchSettings.activePresetId'],
                };
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: {
                    productSurfaceId,
                },
            },
        },
        _showStatusToast(message, duration, tone) {
            calls.toasts.push({ message, duration, tone });
        },
    };
    return { game, calls };
}

test('applyMenuPresetAction allows desktop default-full presets beyond browser-demo allowlist', () => {
    const { game, calls } = createPresetGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    applyMenuPresetAction({
        game,
        presetId: 'desktop-custom-preset',
        resolveMenuAccessContext: () => null,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        settingsChangeKeys: {
            MAP_KEY: 'mapKey',
            PRESET_ACTIVE_ID: 'matchSettings.activePresetId',
            PRESET_ACTIVE_KIND: 'matchSettings.activePresetKind',
            PRESET_STATUS: 'matchSettings.status',
        },
    });

    assert.deepEqual(calls.appliedPresetIds, ['desktop-custom-preset']);
    assert.equal(calls.settingsChanged.length, 1);
    assert.match(calls.toasts[0]?.message || '', /Preset geladen/);
});

test('applyMenuPresetAction aligns the active hangar map before the menu sync', () => {
    const { game, calls } = createPresetGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);
    game.settings.mapKey = 'mega_maze';
    game.settings.localSettings = {
        modePath: 'fight',
        startSetup: {
            modeSelections: {
                fight: { mapKey: 'mega_maze', vehicles: {} },
            },
        },
    };
    game.settingsManager.applyMenuPreset = (_settings, presetId) => {
        calls.appliedPresetIds.push(presetId);
        game.settings.mapKey = 'maze';
        return {
            success: true,
            changedKeys: ['mapKey', 'matchSettings.activePresetId'],
        };
    };

    applyMenuPresetAction({
        game,
        presetId: 'competitive',
        resolveMenuAccessContext: () => null,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        settingsChangeKeys: {
            MAP_KEY: 'mapKey',
            PRESET_ACTIVE_ID: 'matchSettings.activePresetId',
            PRESET_ACTIVE_KIND: 'matchSettings.activePresetKind',
            PRESET_STATUS: 'matchSettings.status',
        },
    });

    assert.equal(game.settings.mapKey, 'maze');
    assert.equal(game.settings.localSettings.startSetup.modeSelections.fight.mapKey, 'maze');
    assert.deepEqual(calls.settingsChanged[0]?.changedKeys, ['mapKey', 'matchSettings.activePresetId']);
});
