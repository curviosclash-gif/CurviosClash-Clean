import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createMenuSettingsDefaults } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/shared/settings/SettingsChangeKeys.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';
import {
    bindGraphicsStyleSelect,
    syncGraphicsStyleControls,
} from '../src/ui/menu/MenuGraphicsStyleBindings.js';
import { handleLevel4ResetAction } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';

test('the graphics level defaults to automatic and survives a round trip through storage', () => {
    const defaults = createMenuSettingsDefaults();
    assert.equal(defaults.localSettings.graphicsQuality, 'auto');
    assert.equal(defaults.localSettings.bloomQualityUserSet, false);

    const stored = ensureMenuContractState({ localSettings: { graphicsQuality: 'ultra', bloomQualityUserSet: true } });
    assert.equal(stored.localSettings.graphicsQuality, 'ULTRA');
    assert.equal(stored.localSettings.bloomQualityUserSet, true);

    const legacy = ensureMenuContractState({ localSettings: {} });
    assert.equal(legacy.localSettings.graphicsQuality, 'auto', 'old saves land on automatic');
    assert.equal(legacy.localSettings.bloomQualityUserSet, false);
    assert.equal(ensureMenuContractState({ localSettings: { graphicsQuality: 'insane' } }).localSettings.graphicsQuality, 'auto');
});

test('the menu offers every level under a precise change key', () => {
    const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const select = indexHtml.match(/<select id="graphics-quality-select">([\s\S]*?)<\/select>/);
    assert.ok(select, 'the select exists');
    const values = [...select[1].matchAll(/value="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(values, ['auto', 'LOW', 'MEDIUM', 'HIGH', 'ULTRA']);
    assert.match(select[1], /value="auto" selected>Automatisch/);
    assert.match(select[1], /value="ULTRA">Sehr hoch/);
    assert.match(indexHtml, /data-menu-text-id="menu\.level4\.graphics\.quality\.label"/);
    assert.equal(MENU_TEXT_CATALOG['menu.level4.graphics.quality.label'], 'Grafikstufe');
    assert.equal(SETTINGS_CHANGE_PATHS['localSettings.graphicsQuality'], SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_QUALITY);
    assert.deepEqual(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_QUALITY]), ['syncGameplay']);
});

test('picking a level writes the setting and the sync shows it again', () => {
    const settings = { localSettings: {} };
    const ui = { graphicsQualitySelect: { value: 'ULTRA' } };
    const handlers = [];
    let changedKeys = null;
    bindGraphicsStyleSelect({
        ui,
        settings,
        bind(target, type, handler) { handlers.push({ target, type, handler }); },
        emitSettingsChangedImmediate(keys) { changedKeys = keys; },
        settingsChangeKeys: SETTINGS_CHANGE_KEYS,
    });
    const binding = handlers.find((entry) => entry.target === ui.graphicsQualitySelect);
    assert.equal(binding.type, 'change');
    binding.handler();
    assert.equal(settings.localSettings.graphicsQuality, 'ULTRA');
    assert.deepEqual(changedKeys, [SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_QUALITY]);

    const shown = { graphicsQualitySelect: { value: '' }, graphicsStyleSelect: { value: '' } };
    syncGraphicsStyleControls({ ui: shown, settings: { localSettings: { graphicsQuality: 'bogus', graphicsStyle: 'classic' } } });
    assert.equal(shown.graphicsQualitySelect.value, 'auto');
    assert.equal(shown.graphicsStyleSelect.value, 'classic');
});

test('moving the bloom slider marks bloom as the player\'s own choice', () => {
    const source = readFileSync(new URL('../src/ui/menu/MenuGameplayBindings.js', import.meta.url), 'utf8');
    const bloomBinding = source.match(/bind\(ui\.bloomQualitySlider[\s\S]*?\}\);/);
    assert.ok(bloomBinding, 'the bloom slider binding exists');
    assert.match(bloomBinding[0], /bloomQualityUserSet = true/);
});

test('the reset of game and graphics options also returns the level to automatic', () => {
    const changed = [];
    const game = {
        settings: { gameplay: {}, localSettings: { graphicsQuality: 'LOW', bloomQualityUserSet: true } },
        settingsManager: {
            createDefaultSettings: () => ({ gameplay: {}, localSettings: {}, invertPitch: {}, cockpitCamera: {} }),
        },
        _showStatusToast() {},
    };
    handleLevel4ResetAction({ game, onSettingsChanged: (payload) => changed.push(payload) });
    assert.equal(game.settings.localSettings.graphicsQuality, 'auto');
    assert.equal(game.settings.localSettings.bloomQualityUserSet, false);
    assert.ok(changed[0].changedKeys.includes(SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_QUALITY));
});
