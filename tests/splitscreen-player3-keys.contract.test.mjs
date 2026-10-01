import test from 'node:test';
import assert from 'node:assert/strict';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { CONFIG } from '../src/core/Config.js';
import { KeybindEditorController } from '../src/ui/KeybindEditorController.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function createManager() {
    return new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
}

test('player three has its own saved key bindings like players one and two', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    assert.equal(defaults.controls.PLAYER_3.BOOST, CONFIG.KEYS.PLAYER_3.BOOST);

    const changed = structuredClone(defaults);
    changed.controls.PLAYER_3.BOOST = 'KeyZ';
    const sanitized = manager.sanitizeSettings(changed);
    assert.equal(sanitized.controls.PLAYER_3.BOOST, 'KeyZ');
    assert.equal(manager.createRuntimeConfig(sanitized).controls.PLAYER_3.BOOST, 'KeyZ');
});

test('rebinding player one onto a key of player three is reported as a conflict', () => {
    const controls = createManager().createDefaultSettings().controls;
    const editor = new KeybindEditorController({ getControls: () => controls });

    const conflict = editor._findControlValueConflict('PLAYER_1', 'BOOST', controls.PLAYER_3.BOOST);
    assert.equal(conflict?.scope.key, 'PLAYER_3');

    controls.PLAYER_1.BOOST = controls.PLAYER_3.BOOST;
    assert.equal(editor.collectKeyConflicts().get(controls.PLAYER_3.BOOST), 2);
});
