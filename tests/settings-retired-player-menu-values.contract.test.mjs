import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { MODE_PATH_TO_PRESET_ID } from '../src/core/settings/FreshProfileSettingsOps.js';
import { createSettingsOverrideDraft } from '../src/core/settings/SettingsOverrideContract.js';
import {
    RETIRED_PLAYER_MENU_GAMEPLAY_KEYS,
    SETTINGS_VERSION_MIGRATION_IDS,
    migrateSettingsSnapshot,
} from '../src/core/settings/SettingsVersionMigrations.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

// The player menu no longer has sliders for game feel, combat values, portals and level
// count. A player who moved one of them earlier could never get the default back, so the
// settings migration to version 6 hands every player the values a fresh profile starts with.

const ODD_GAMEPLAY = Object.freeze({
    speed: 8,
    turnSensitivity: 1.1,
    gravityStrength: 3,
    planeScale: 1.7,
    trailWidth: 2.1,
    trailLength: 900,
    gapSize: 1.2,
    gapFrequency: 0.2,
    itemAmount: 4,
    fireRate: 1.9,
    lockOnAngle: 40,
    nextCheckpointGlowIntensity: 0.1,
    mgTrailAimRadius: 5.5,
    fightPlayerHp: 240,
    fightMgDamage: 19,
    planarLevelCount: 9,
});

function createManager(draft = null) {
    return new SettingsManager({
        storagePlatform: createMemoryStoragePlatform(),
        ...(draft ? {
            runtimeGlobal: {
                settingsDefaultsContract: { getOverrideSnapshot: () => ({ draft }) },
            },
        } : {}),
    });
}

function createOldSave(modePath = 'normal', overrides = {}) {
    return {
        settingsVersion: 5,
        numBots: 3,
        autoRoll: true,
        portalsEnabled: false,
        gameplay: { ...ODD_GAMEPLAY, planarMode: true },
        localSettings: { modePath },
        ...overrides,
    };
}

// What a profile without stored settings gets: the defaults with the style preset on top.
function createFreshProfile(manager, modePath) {
    const fresh = manager.createDefaultSettings();
    fresh.localSettings.modePath = modePath;
    const result = manager.applyMenuPreset(fresh, MODE_PATH_TO_PRESET_ID[modePath]);
    assert.equal(result.success, true, `preset for ${modePath} must apply`);
    return fresh;
}

test('an old save gets the fresh-profile value back for every retired player-menu value', () => {
    for (const modePath of ['normal', 'fight', 'arcade']) {
        const manager = createManager();
        const fresh = createFreshProfile(manager, modePath);

        const sanitized = manager.sanitizeSettings(createOldSave(modePath));

        for (const key of RETIRED_PLAYER_MENU_GAMEPLAY_KEYS) {
            assert.equal(sanitized.gameplay[key], fresh.gameplay[key], `${modePath}: gameplay.${key}`);
        }
        assert.equal(sanitized.portalsEnabled, fresh.portalsEnabled, `${modePath}: portalsEnabled`);
    }
});

test('the migration leaves everything the player menu still offers alone', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeSettings(createOldSave('normal'));

    assert.equal(sanitized.numBots, 3);
    assert.equal(sanitized.autoRoll, true);
    assert.equal(sanitized.gameplay.planarMode, true);
});

test('the Settings Studio override decides the value the migration restores', () => {
    const draft = createSettingsOverrideDraft();
    draft.baseSettings.gameplay.speed = 25;
    draft.baseSettings.gameplay.trailWidth = 0.9;
    const manager = createManager(draft);
    const fresh = createFreshProfile(manager, 'normal');

    const sanitized = manager.sanitizeSettings(createOldSave('normal'));

    assert.equal(sanitized.gameplay.trailWidth, 0.9);
    assert.equal(sanitized.gameplay.trailWidth, fresh.gameplay.trailWidth);
    assert.equal(sanitized.gameplay.speed, fresh.gameplay.speed);
});

test('the reset runs once: a second load keeps the settings and later F7 or studio values stay', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const first = manager.sanitizeSettings(createOldSave('normal'));
    assert.equal(first.settingsVersion, defaults.settingsVersion);
    assert.ok(first.settingsVersion >= 6);

    const second = manager.sanitizeSettings(first);
    assert.deepEqual(second, first);

    // A value changed after the migration (F7 console, Settings Studio) is not reset again.
    second.gameplay.speed = 22;
    second.gameplay.fightPlayerHp = 150;
    second.portalsEnabled = false;
    const third = manager.sanitizeSettings(second);
    assert.equal(third.gameplay.speed, 22);
    assert.equal(third.gameplay.fightPlayerHp, 150);
    assert.equal(third.portalsEnabled, false);
});

test('an override draft stored with the old version stamp does not make the reset run again', () => {
    const draft = createSettingsOverrideDraft();
    draft.baseSettings.settingsVersion = 5;
    const manager = createManager(draft);

    const first = manager.sanitizeSettings(createOldSave('normal'));
    first.gameplay.speed = 22;
    const second = manager.sanitizeSettings(first);

    assert.ok(second.settingsVersion >= 6);
    assert.equal(second.gameplay.speed, 22);
});

test('the version 5 to 6 step is part of the migration chain', () => {
    const manager = createManager();
    const result = migrateSettingsSnapshot(createOldSave('normal'), manager.createDefaultSettings());

    assert.deepEqual(result.appliedMigrations, [SETTINGS_VERSION_MIGRATION_IDS.V5_TO_V6]);
    assert.equal(result.reachedVersion, 6);
});

test('an empty or partial save keeps getting the plain defaults for values it never stored', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const sanitized = manager.sanitizeSettings({ settingsVersion: 5, gameplay: { speed: 8 } });

    assert.notEqual(sanitized.gameplay.speed, 8, 'the stored value is reset');
    assert.equal(sanitized.gameplay.fireRate, defaults.gameplay.fireRate);
    assert.equal(sanitized.portalsEnabled, defaults.portalsEnabled);
});
