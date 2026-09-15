import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileUiController } from '../src/ui/ProfileUiController.js';

// Builds a controller whose host keeps the live settings object exactly the way
// main.js does: everything else in the runtime holds this very reference.
function createHarness(initialSettings, storedProfileSettings) {
    const host = { settings: initialSettings };
    const toasts = [];
    const profileManager = {
        getProfiles: () => [{ name: 'Alpha', settings: storedProfileSettings }],
        getActiveProfileName: () => 'Alpha',
        findProfileByName: (name) => (name === 'Alpha' ? { name: 'Alpha' } : null),
        normalizeProfileName: (name) => String(name || '').trim(),
        getProfileControlStateOps: () => ({}),
        getProfileUiStateOps: () => ({}),
        loadProfile: () => ({
            success: true,
            profile: { name: 'Alpha', settings: JSON.parse(JSON.stringify(storedProfileSettings)) },
        }),
    };
    const controller = new ProfileUiController({
        profileManager,
        settingsManager: {},
        getUi: () => ({}),
        getUiManager: () => null,
        getSettings: () => host.settings,
        setSettings: (next) => { host.settings = next; },
        showStatusToast: (message, ms, tone) => { toasts.push({ message, ms, tone }); },
        onSettingsChanged: () => {},
        markSettingsDirty: () => {},
        profileControlStateOps: {},
        profileUiStateOps: {},
    });
    return { controller, host, toasts };
}

test('loading a profile keeps the live settings object identity for menu bindings', () => {
    const liveSettings = {
        localSettings: { audio: { enabled: true, masterVolume: 0.2 } },
        staleSection: { removed: true },
    };
    const { controller, host } = createHarness(liveSettings, {
        localSettings: { audio: { enabled: false, masterVolume: 0.8 } },
    });
    // A menu binding captured the object at startup and never re-reads it.
    const capturedByMenu = host.settings;

    assert.equal(controller.loadProfile('Alpha'), true);

    assert.equal(host.settings, liveSettings, 'the host must keep the original settings reference');
    assert.equal(capturedByMenu, host.settings, 'menu bindings must see the loaded values');
    assert.equal(capturedByMenu.localSettings.audio.masterVolume, 0.8);
    assert.equal(capturedByMenu.localSettings.audio.enabled, false);
    assert.equal('staleSection' in capturedByMenu, false, 'keys absent from the profile must be dropped');
});

test('loading a profile does not alias the stored profile settings', () => {
    const stored = { localSettings: { audio: { masterVolume: 0.5 } } };
    const { controller, host } = createHarness({ localSettings: { audio: { masterVolume: 0.1 } } }, stored);

    assert.equal(controller.loadProfile('Alpha'), true);
    host.settings.localSettings.audio.masterVolume = 0.99;

    assert.equal(stored.localSettings.audio.masterVolume, 0.5);
});
