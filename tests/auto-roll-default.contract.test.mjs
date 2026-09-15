import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { createMultiplayerMatchSettingsSnapshot } from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../src/shared/contracts/GameplayConfigContract.js';
import {
    createMenuConfigSharePayloadDefaults,
    createMenuDefaultsEditorSnapshotFromSettings,
    createMenuSettingsDefaults,
} from '../src/ui/menu/MenuDefaultsEditorConfig.js';

test('gameplay defaults use the requested maximum-population setup with auto-roll disabled', () => {
    const defaults = createMenuSettingsDefaults();

    assert.equal(CONFIG_SECTIONS.PLAYER.AUTO_ROLL, false);
    assert.equal(GAMEPLAY_CONFIG_DEFAULTS.PLAYER.AUTO_ROLL, false);
    assert.equal(defaults.gameplay.speed, 30);
    assert.equal(defaults.gameplay.turnSensitivity, 3);
    assert.equal(defaults.gameplay.itemAmount, 60);
    assert.equal(defaults.numBots, 8);
    assert.equal(defaults.autoRoll, false);
    assert.equal(createMenuConfigSharePayloadDefaults().autoRoll, false);
    assert.equal(createMenuDefaultsEditorSnapshotFromSettings().baseSettings.autoRoll, false);
    assert.equal(createMultiplayerMatchSettingsSnapshot().autoRoll, false);
});

test('explicit auto-roll choices remain unchanged', () => {
    assert.equal(createMenuDefaultsEditorSnapshotFromSettings({ autoRoll: true }).baseSettings.autoRoll, true);
    assert.equal(createMenuDefaultsEditorSnapshotFromSettings({ autoRoll: false }).baseSettings.autoRoll, false);
    assert.equal(createMultiplayerMatchSettingsSnapshot({ autoRoll: true }).autoRoll, true);
    assert.equal(createMultiplayerMatchSettingsSnapshot({ autoRoll: false }).autoRoll, false);
});

test('auto-roll checkboxes are not preselected before settings synchronization', () => {
    const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const menuToggle = indexHtml.match(/<input[^>]*id="auto-roll-toggle"[^>]*>/)?.[0] || '';
    const pauseToggle = indexHtml.match(/<input[^>]*id="pause-auto-roll-toggle"[^>]*>/)?.[0] || '';

    assert.ok(menuToggle);
    assert.ok(pauseToggle);
    assert.doesNotMatch(menuToggle, /\schecked(?:\s|>|=)/);
    assert.doesNotMatch(pauseToggle, /\schecked(?:\s|>|=)/);
});
