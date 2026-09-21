import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { renderParcoursPanel } from '../src/ui/ParcoursHudPresenter.js';
import { syncMenuSurfacePolicyUi } from '../src/ui/menu/MenuSurfacePolicyUiSync.js';
import { CLASSIC_TUTORIAL_CONTRACT_VERSION } from '../src/shared/contracts/ClassicTutorialContract.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function createTutorialButton() {
    const classes = new Set();
    return {
        textContent: '',
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); },
        },
    };
}

test('completed tutorial survives the real save/load path and an unrelated settings save', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.loadSettings();
    const refs = { status: { textContent: '', classList: { toggle() {} } } };
    const completed = renderParcoursPanel(refs, {
        routeId: 'classic_tutorial_v1',
        completed: true,
        currentCheckpoint: 6,
        totalCheckpoints: 6,
    }, { settings, settingsManager: manager }, true);

    assert.equal(completed, true);
    const reloaded = manager.loadSettings();
    assert.equal(reloaded.localSettings.classicTutorial.completed, true);
    assert.equal(reloaded.localSettings.classicTutorial.schemaVersion, CLASSIC_TUTORIAL_CONTRACT_VERSION);
    assert.ok(reloaded.localSettings.classicTutorial.completedAtMs > 0);

    reloaded.gameplay.speed += 1;
    assert.equal(manager.saveSettings(reloaded).success, true);
    assert.equal(manager.loadSettings().localSettings.classicTutorial.completed, true);
});

test('main tutorial action changes label and becomes visually secondary after completion', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.loadSettings();
    const button = createTutorialButton();
    const sync = () => syncMenuSurfacePolicyUi({
        ui: { mainTutorialButton: button }, settings, sessionType: 'single',
        menuTextRuntime: { resolveText: (id, { defaultText }) => defaultText },
    });

    sync();
    assert.equal(button.textContent, 'Neu hier? Steuerung lernen');
    assert.equal(button.classList.contains('tutorial-completed'), false);

    settings.localSettings.classicTutorial = { completed: true, completedAtMs: 1234 };
    sync();
    assert.equal(button.textContent, 'Tutorial abgeschlossen — nochmal spielen');
    assert.equal(button.classList.contains('tutorial-completed'), true);
});

test('tutorial progress normalizer discards unknown fields and invalid completion timestamps', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const sanitized = manager.sanitizeSettings({
        localSettings: { classicTutorial: { completed: true, completedAtMs: 'invalid', extra: 'drop me' } },
    });
    assert.deepEqual(sanitized.localSettings.classicTutorial, {
        schemaVersion: CLASSIC_TUTORIAL_CONTRACT_VERSION,
        completed: true,
        completedAtMs: 0,
    });
});
