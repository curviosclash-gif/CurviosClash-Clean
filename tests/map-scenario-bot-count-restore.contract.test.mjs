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

test('the assault scenario does not replace a dedicated weapon race start', () => {
    const facade = createFacade('parcours_assault');
    facade.game.settings.gameMode = 'ARCADE';
    facade.game.settings.localSettings.modePath = 'arcade';
    facade.game.settings.arcade = { enabled: true, runType: 'weapon_race', combatProfile: 'hunt' };
    facade.game.settings.numBots = 4;
    const handler = new GameRuntimeSettingsHandler({ facade });

    const result = handler.applyMapScenarioStartDefaults();

    assert.deepEqual(result, { changed: false, changedKeys: [] });
    assert.equal(facade.game.settings.localSettings.modePath, 'arcade');
    assert.equal(facade.game.settings.gameMode, 'ARCADE');
    assert.equal(facade.game.settings.arcade.runType, 'weapon_race');
    assert.equal(facade.game.settings.numBots, 4);
    assert.equal(facade.synced.length, 0);
    handler.dispose();
});

// Aetherion carries a Hunt scenario next to a time-trial route that only runs in Arcade.
// Turning an Arcade pick into the Hunt scenario left the route reachable from no menu at all.
test('an arcade pick keeps arcade when the scenario would hide the map route', () => {
    const facade = createFacade('aetherion_orrery');
    Object.assign(facade.game.settings, { gameMode: 'ARCADE', numBots: 0 });
    facade.game.settings.localSettings.modePath = 'arcade';
    const handler = new GameRuntimeSettingsHandler({ facade });

    const result = handler.applyMapScenarioStartDefaults();

    assert.equal(facade.game.settings.localSettings.modePath, 'arcade', 'the arcade pick stays an arcade run');
    assert.equal(facade.game.settings.gameMode, 'ARCADE', 'the route runs only in arcade on this map');
    assert.equal(facade.game.settings.numBots, 0);
    assert.equal(result?.changed, false);
    handler.dispose();
});

test('the fight pick on the route map still starts its hunt scenario', () => {
    const facade = createFacade('aetherion_orrery');
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();

    assert.equal(facade.game.settings.gameMode, 'HUNT');
    assert.equal(facade.game.settings.numBots, 5);
    handler.dispose();
});

test('an arcade pick of the assault course still starts its fight scenario', () => {
    // Its route is authored for Hunt too, so the scenario hides nothing there.
    const facade = createFacade('parcours_assault');
    Object.assign(facade.game.settings, { gameMode: 'ARCADE', numBots: 0 });
    facade.game.settings.localSettings.modePath = 'arcade';
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler.applyMapScenarioStartDefaults();

    assert.equal(facade.game.settings.localSettings.modePath, 'fight');
    assert.equal(facade.game.settings.gameMode, 'HUNT');
    assert.equal(facade.game.settings.numBots, 4);
    handler.dispose();
});
