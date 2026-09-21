import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { startMatchWithBorrowedSettings } from '../src/core/runtime/BorrowedMatchSettingsOps.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { applySessionSettingsRestorePlan } from '../src/core/runtime/SessionSettingsRestorePlan.js';
import { bindClassicTutorialButtons } from '../src/ui/menu/MenuGameplayBindings.js';
import { renderParcoursPanel } from '../src/ui/ParcoursHudPresenter.js';
import { readHangarMapSelection, writeHangarMapSelection } from '../src/ui/hangar/HangarSelectionWritebackContract.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function createFacade(startResult = true) {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.loadSettings();
    settings.mode = '2p';
    settings.gameMode = 'HUNT';
    settings.localSettings.sessionType = 'splitscreen';
    settings.localSettings.modePath = 'fight';
    writeHangarMapSelection(settings, 'notre_dame_arena', 'notre_dame_arena', { modePath: 'fight' });
    settings.numBots = 4;
    let heldPlan = null;
    const starts = [];
    const facade = {
        game: { settings },
        settingsHandler: {
            holdSessionSettingsRestore(plan) { heldPlan = plan; },
            restoreSessionSettings() {
                applySessionSettingsRestorePlan(heldPlan, settings);
                heldPlan = null;
            },
        },
        startMatch() {
            starts.push({
                mode: settings.mode,
                gameMode: settings.gameMode,
                mapKey: settings.mapKey,
                numBots: settings.numBots,
                sessionType: settings.localSettings.sessionType,
                modePath: settings.localSettings.modePath,
                hangarMap: readHangarMapSelection(settings, 'standard', { modePath: 'normal' }).value,
            });
            return Promise.resolve(startResult);
        },
    };
    return { facade, starts, settings };
}

test('tutorial borrows its match values and restores the previous quick-start choice', async () => {
    const { facade, starts, settings } = createFacade();
    await startMatchWithBorrowedSettings(facade, { tutorial: true });
    assert.deepEqual(starts, [{
        mode: '1p', gameMode: 'CLASSIC', mapKey: 'tutorial_classic', numBots: 0,
        sessionType: 'single', modePath: 'normal', hangarMap: 'tutorial_classic',
    }]);
    facade.settingsHandler.restoreSessionSettings();
    assert.equal(settings.mode, '2p');
    assert.equal(settings.gameMode, 'HUNT');
    assert.equal(settings.mapKey, 'notre_dame_arena');
    assert.equal(settings.numBots, 4);
    assert.equal(settings.localSettings.sessionType, 'splitscreen');
    assert.equal(settings.localSettings.modePath, 'fight');
    assert.equal(readHangarMapSelection(settings, 'standard', { modePath: 'fight' }).value, 'notre_dame_arena');
});

test('blocked tutorial starts return borrowed values immediately', async () => {
    const { facade, settings } = createFacade(false);
    assert.equal(await startMatchWithBorrowedSettings(facade, { tutorial: true }), false);
    assert.equal(settings.mapKey, 'notre_dame_arena');
    assert.equal(settings.localSettings.modePath, 'fight');
});

test('saving tutorial completion during the match preserves the previous quick-start choice', async () => {
    const { facade, settings } = createFacade();
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    facade.settingsHandler = new GameRuntimeSettingsHandler({ facade });
    await startMatchWithBorrowedSettings(facade, { tutorial: true });
    facade.game._saveSettings = () => manager.saveSettings(
        facade.settingsHandler.createPersistableSettingsSnapshot(settings)
    );
    facade.game.settingsManager = { saveSettings() { throw new Error('bypassed the protected save path'); } };
    renderParcoursPanel({ status: { textContent: '', classList: { toggle() {} } } }, {
        routeId: 'classic_tutorial_v1', completed: true,
    }, facade.game, true);
    const reloaded = manager.loadSettings();
    assert.equal(reloaded.mapKey, 'notre_dame_arena');
    assert.equal(reloaded.numBots, 4);
    assert.equal(reloaded.localSettings.modePath, 'fight');
    assert.equal(reloaded.localSettings.classicTutorial.completed, true);
});

test('both tutorial buttons emit a borrowed start without mutating the quick-start choice', () => {
    const { settings } = createFacade();
    const buttons = [{}, {}];
    const handlers = new Map();
    const events = [];
    bindClassicTutorialButtons({
        ui: { mainTutorialButton: buttons[0], classicTutorialButton: buttons[1] },
        bind(node, event, handler) { if (node && event === 'click') handlers.set(node, handler); },
        emit(type, payload) { events.push({ type, payload }); },
        eventTypes: { START_MATCH: 'start_match' },
    });

    for (const button of buttons) handlers.get(button)();
    assert.deepEqual(events, [
        { type: 'start_match', payload: { borrowedSettings: { tutorial: true } } },
        { type: 'start_match', payload: { borrowedSettings: { tutorial: true } } },
    ]);
    assert.equal(settings.mapKey, 'notre_dame_arena');
    assert.equal(settings.numBots, 4);
    assert.equal(settings.localSettings.modePath, 'fight');
});
