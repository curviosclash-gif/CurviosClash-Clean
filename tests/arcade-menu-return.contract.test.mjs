import assert from 'node:assert/strict';
import test from 'node:test';
import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';

function returnHarness(session, state = 'PAUSED') {
    const calls = [];
    const facade = {
        game: { state, runtimeConfig: { session: structuredClone(session) }, settings: {} },
        settingsHandler: {
            restoreMapScenarioBotCount() { calls.push('scenario'); },
            restoreSessionSettings() {
                calls.push('restore');
                facade.game.runtimeConfig.session = { sessionType: 'single', modePath: 'normal' };
            },
        },
        finalizeMatch(options) { calls.push('finalize'); return options; },
    };
    return { handler: new GameRuntimeSessionHandler({ facade }), calls };
}

for (const [name, session] of [
    ['single Journey', { sessionType: 'single', modePath: 'arcade', mapKey: 'standard' }],
    ['split Journey', { sessionType: 'splitscreen', modePath: 'arcade', mapKey: 'standard' }],
    ['Daily or free Arcade', { sessionType: 'single', modePath: 'arcade', mapKey: 'parcours_rift' }],
    ['flight school', { sessionType: 'single', modePath: 'normal', mapKey: 'tutorial_classic' }],
]) {
    test(`${name} captures its hub destination before settings restore`, () => {
        const { handler, calls } = returnHarness(session);
        const result = handler.returnToMenu({ reason: 'pause_menu_return' });
        assert.equal(result.panelId, 'submenu-custom');
        assert.equal(result.reason, 'pause_menu_return');
        assert.equal(result.applyReturnToMenuUi, true);
        assert.deepEqual(calls, ['scenario', 'restore', 'finalize']);
    });
}

for (const [name, session, state] of [
    ['free combat', { sessionType: 'single', modePath: 'fight', mapKey: 'dandelion_sky' }, 'PAUSED'],
    ['classic', { sessionType: 'single', modePath: 'normal', mapKey: 'standard' }, 'MATCH_END'],
    ['network', { sessionType: 'multiplayer', modePath: 'arcade', networkEnabled: true }, 'PAUSED'],
    ['multiplayer without network flag', { sessionType: 'multiplayer', modePath: 'arcade' }, 'PAUSED'],
    ['old menu snapshot', { sessionType: 'single', modePath: 'arcade' }, 'MENU'],
]) {
    test(`${name} keeps the existing default return destination`, () => {
        const { handler } = returnHarness(session, state);
        assert.equal(handler.returnToMenu().panelId, undefined);
    });
}

test('an explicit result or lobby destination takes priority over the Arcade hub', () => {
    for (const panelId of ['submenu-multiplayer', 'submenu-custom', 'submenu-game']) {
        const { handler } = returnHarness({ sessionType: 'single', modePath: 'arcade' });
        const result = handler.returnToMenu({ panelId, trigger: 'explicit', showMenuPanel: false });
        assert.equal(result.panelId, panelId);
        assert.equal(result.trigger, 'explicit');
        assert.equal(result.showMenuPanel, false);
    }
});
