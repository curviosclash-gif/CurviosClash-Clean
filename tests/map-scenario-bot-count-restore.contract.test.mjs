import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';

// A single player Fight setup with three bots, as a player leaves it in the menu.
function createFacade(mapKey) {
    const synced = [];
    const game = {
        settings: {
            mapKey,
            gameMode: 'HUNT',
            numBots: 3,
            localSettings: { sessionType: 'single', modePath: 'fight' },
        },
        uiManager: {
            syncByChangeKeys(keys) { synced.push(...keys); },
            updateContext() {},
        },
        _saveSettings() {},
    };
    return {
        synced,
        game,
        _applySettingsToRuntimeInternal() {},
        _resolveMenuAccessContext() { return null; },
    };
}

test('the reactor scenario raises the bots only for the match it starts', () => {
    const facade = createFacade('reactor_site');
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();
    assert.equal(facade.game.settings.numBots, 6, 'the reactor match itself runs with its six bots');

    handler.restoreMapScenarioBotCount();
    assert.equal(facade.game.settings.numBots, 3, 'back in the menu the player keeps the three bots they chose');
    assert.ok(facade.synced.includes(SETTINGS_CHANGE_KEYS.BOTS_COUNT), 'the menu has to show the restored count');
    handler.dispose();
});

test('a bot count the player picked after the scenario is not overwritten', () => {
    const facade = createFacade('reactor_site');
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();
    facade.game.settings.numBots = 8;
    handler.restoreMapScenarioBotCount();

    assert.equal(facade.game.settings.numBots, 8);
    handler.dispose();
});

test('a rematch on the scenario map still gets the scenario bots', () => {
    const facade = createFacade('reactor_site');
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();
    handler.restoreMapScenarioBotCount();
    handler.applyMapScenarioStartDefaults();

    assert.equal(facade.game.settings.numBots, 6);
    handler.restoreMapScenarioBotCount();
    assert.equal(facade.game.settings.numBots, 3);
    handler.dispose();
});

test('maps without a scenario leave the bot count alone on the way back', () => {
    const facade = createFacade('standard');
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();
    handler.restoreMapScenarioBotCount();

    assert.equal(facade.game.settings.numBots, 3);
    assert.equal(facade.synced.length, 0);
    handler.dispose();
});
