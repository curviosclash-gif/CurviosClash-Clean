import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    createSettingsOverrideDraft,
    createSettingsStudioSchemaDescriptor,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { renderSectionForm } from '../electron/settings-studio/ui/settings-studio-form-renderer.js';
import { createTranslator } from '../electron/settings-studio/ui/settings-studio-i18n.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

test('Settings Studio exposes and persists the sandstorm vehicle wind strength', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    const fieldPath = 'baseSettings.gameplay.sandstormWindStrength';

    assert.equal(settings.gameplay.sandstormWindStrength, 1);
    settings.gameplay.sandstormWindStrength = 1.5;
    assert.equal(manager.saveSettings(settings).success, true);
    const loaded = manager.loadSettings();
    assert.equal(loaded.gameplay.sandstormWindStrength, 1.5);
    assert.equal(createRuntimeConfigSnapshot(loaded).gameplay.sandstormWindStrength, 1.5);

    const descriptor = createSettingsStudioSchemaDescriptor().fields.find((field) => field.path === fieldPath);
    assert.deepEqual(descriptor.limits, { ...SETTINGS_LIMITS.gameplay.sandstormWindStrength, step: 0.05 });
    assert.equal(descriptor.label.de, 'Sandsturm-Windstärke');

    const draft = createSettingsOverrideDraft();
    draft.baseSettings.gameplay.sandstormWindStrength = 1.5;
    assert.equal(validateSettingsOverrideDraft(draft).valid, true);
    const html = renderSectionForm('baseSettings', createSettingsStudioSchemaDescriptor(), draft,
        createSettingsOverrideDraft(), createTranslator('de'), []);
    assert.match(html, new RegExp(fieldPath.replaceAll('.', '\\.')));
    assert.match(html, /Sandsturm-Windstärke/);
});

test('sandstorm wind strength settings are clamped to the declared range', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    assert.equal(manager.sanitizeSettings({ gameplay: { sandstormWindStrength: -1 } }).gameplay.sandstormWindStrength, 0);
    assert.equal(manager.sanitizeSettings({ gameplay: { sandstormWindStrength: 3 } }).gameplay.sandstormWindStrength, 2);
    assert.equal(defaults.gameplay.sandstormWindStrength, 1);
});
