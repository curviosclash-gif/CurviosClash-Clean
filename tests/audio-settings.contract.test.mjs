import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultAudioSettings,
    DEFAULT_AUDIO_SETTINGS,
    normalizeAudioSettings,
} from '../src/shared/contracts/AudioSettingsContract.js';
import { createMenuSettingsDefaults } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/shared/settings/SettingsChangeKeys.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';

test('audio settings expose the expected immutable defaults', () => {
    assert.ok(Object.isFrozen(DEFAULT_AUDIO_SETTINGS));
    assert.deepEqual(createDefaultAudioSettings(), {
        enabled: true,
        masterVolume: 0.32,
        musicVolume: 0.34,
        sfxVolume: 0.9,
        engineVolume: 0.38,
        uiVolume: 0.72,
        ambienceVolume: 0.32,
    });
});

test('audio settings clamp volumes and accept numeric strings', () => {
    const settings = normalizeAudioSettings({
        masterVolume: '-1',
        musicVolume: '0.5',
        sfxVolume: 2,
        engineVolume: ' 0.25 ',
        uiVolume: '1',
        ambienceVolume: '0',
    });

    assert.deepEqual(settings, {
        enabled: true,
        masterVolume: 0,
        musicVolume: 0.5,
        sfxVolume: 1,
        engineVolume: 0.25,
        uiVolume: 1,
        ambienceVolume: 0,
    });
});

test('audio settings use valid fallback values for invalid volume input', () => {
    const fallback = { ...DEFAULT_AUDIO_SETTINGS, musicVolume: 0.61, sfxVolume: 0.42 };
    const settings = normalizeAudioSettings({
        masterVolume: Number.NaN,
        musicVolume: Infinity,
        sfxVolume: 'not-a-number',
        engineVolume: null,
    }, fallback);

    assert.equal(settings.masterVolume, fallback.masterVolume);
    assert.equal(settings.musicVolume, fallback.musicVolume);
    assert.equal(settings.sfxVolume, fallback.sfxVolume);
    assert.equal(settings.engineVolume, fallback.engineVolume);
});

test('audio settings disable audio only for an explicit false value', () => {
    assert.equal(normalizeAudioSettings({ enabled: false }).enabled, false);
    assert.equal(normalizeAudioSettings({ enabled: 'false' }).enabled, true);
    assert.equal(normalizeAudioSettings({ enabled: 0 }).enabled, true);
});

test('audio settings normalization returns fresh objects without mutating inputs', () => {
    const source = { enabled: false, masterVolume: '0.7' };
    const fallback = { ...DEFAULT_AUDIO_SETTINGS, musicVolume: 0.5 };
    const first = normalizeAudioSettings(source, fallback);
    const second = createDefaultAudioSettings();

    assert.notEqual(first, source);
    assert.notEqual(second, DEFAULT_AUDIO_SETTINGS);
    assert.notEqual(first, second);
    assert.deepEqual(source, { enabled: false, masterVolume: '0.7' });
    assert.deepEqual(fallback, { ...DEFAULT_AUDIO_SETTINGS, musicVolume: 0.5 });
});

test('menu defaults and change-key routing include persistent audio controls', () => {
    const settings = createMenuSettingsDefaults();
    assert.deepEqual(settings.localSettings.audio, createDefaultAudioSettings());
    assert.equal(
        SETTINGS_CHANGE_PATHS['localSettings.audio.musicVolume'],
        SETTINGS_CHANGE_KEYS.LOCAL_AUDIO_MUSIC_VOLUME
    );
    assert.deepEqual(
        resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.LOCAL_AUDIO_MASTER_VOLUME]),
        ['syncGameplay']
    );
});
