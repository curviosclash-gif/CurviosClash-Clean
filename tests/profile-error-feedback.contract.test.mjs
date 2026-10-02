import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileUiController } from '../src/ui/ProfileUiController.js';

function createFailingController() {
    const toasts = [];
    const failure = { success: false, error: 'Profilvorgang fehlgeschlagen.' };
    const profileManager = {
        getProfiles: () => [],
        getActiveProfileName: () => '',
        findProfileByName: () => null,
        saveProfile: () => failure,
        duplicateProfile: () => failure,
        loadProfile: () => failure,
        exportProfile: () => failure,
        importProfile: () => failure,
        setDefaultProfile: () => failure,
        deleteProfile: () => failure,
    };
    const controller = new ProfileUiController({
        profileManager,
        settingsManager: {},
        getUi: () => ({}),
        getUiManager: () => null,
        getSettings: () => ({}),
        setSettings: () => {},
        showStatusToast: (message, durationMs, tone) => toasts.push({ message, durationMs, tone }),
        onSettingsChanged: () => {},
        markSettingsDirty: () => {},
        profileControlStateOps: {},
        profileUiStateOps: {},
    });
    return { controller, toasts };
}

test('all profile-operation errors stay visible for 4.5 seconds', () => {
    const actions = [
        ['save', (controller) => controller.saveProfile('Alpha')],
        ['duplicate', (controller) => controller.duplicateProfile('Alpha', 'Beta')],
        ['load', (controller) => controller.loadProfile('Alpha')],
        ['export', (controller) => controller.exportProfile('Alpha')],
        ['import', (controller) => controller.importProfile('{}', 'Alpha')],
        ['default', (controller) => controller.setDefaultProfile('Alpha')],
        ['delete', (controller) => controller.deleteProfile('Alpha')],
    ];

    for (const [name, invoke] of actions) {
        const { controller, toasts } = createFailingController();
        assert.equal(invoke(controller), false, `${name} should report failure`);
        assert.deepEqual(toasts, [{
            message: 'Profilvorgang fehlgeschlagen.',
            durationMs: 4500,
            tone: 'error',
        }], `${name} error toast`);
    }
});
