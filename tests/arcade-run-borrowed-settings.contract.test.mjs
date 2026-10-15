import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { startMatchWithBorrowedSettings } from '../src/core/runtime/BorrowedMatchSettingsOps.js';
import {
    applySessionSettingsRestorePlan,
    mergeSessionSettingsRestorePlans,
} from '../src/core/runtime/SessionSettingsRestorePlan.js';

function createFacade({ startResult = true } = {}) {
    let heldPlan = null;
    const calls = { starts: [], restores: 0 };
    const facade = {
        game: { settings: { mapKey: 'empty', numBots: 3, gameplay: { speed: 33 } } },
        settingsHandler: {
            holdSessionSettingsRestore(plan) { heldPlan = mergeSessionSettingsRestorePlans(heldPlan, plan); },
            restoreSessionSettings() {
                calls.restores += 1;
                const plan = heldPlan;
                heldPlan = null;
                applySessionSettingsRestorePlan(plan, facade.game.settings);
            },
        },
        startMatch() {
            calls.starts.push({ mapKey: facade.game.settings.mapKey, numBots: facade.game.settings.numBots });
            return Promise.resolve(startResult);
        },
    };
    return { facade, calls };
}

test('a five fronts start plays on its map and bots, and the menu gets its own values back', async () => {
    const { facade, calls } = createFacade();
    await startMatchWithBorrowedSettings(facade, { mapKey: 'notre_dame_arena', numBots: 12 });
    assert.deepEqual(calls.starts, [{ mapKey: 'notre_dame_arena', numBots: 12 }]);
    // Back to the menu: the session restore hands the player's map and bots back.
    facade.settingsHandler.restoreSessionSettings();
    assert.equal(facade.game.settings.mapKey, 'empty');
    assert.equal(facade.game.settings.numBots, 3);
    assert.equal(facade.game.settings.gameplay.speed, 33);
});

test('a start that does not happen hands the values back right away', async () => {
    const { facade, calls } = createFacade({ startResult: false });
    await startMatchWithBorrowedSettings(facade, { mapKey: 'standard', numBots: 0 });
    assert.equal(calls.restores, 1);
    assert.equal(facade.game.settings.mapKey, 'empty');
    assert.equal(facade.game.settings.numBots, 3);
});

test('only map and bot count can be borrowed, and a plain start stays plain', async () => {
    const { facade, calls } = createFacade();
    await startMatchWithBorrowedSettings(facade, { gameplay: { speed: 99 }, numBots: 'x' });
    assert.equal(facade.game.settings.gameplay.speed, 33);
    assert.equal(facade.game.settings.numBots, 3);
    assert.equal(calls.starts.length, 1);
});

test('the arcade run buttons borrow map and bots instead of writing them into the settings', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /settings\.mapKey\s*=/);
    assert.doesNotMatch(source, /settings\.numBots\s*=/);
    assert.match(source, /borrowedSettings/);
    const handlers = readFileSync(new URL('../src/core/runtime/menu-handlers/SessionMenuEventHandlers.js', import.meta.url), 'utf8');
    assert.match(handlers, /START_MATCH, \(event\) => startMatchWithBorrowedSettings\(facade, event\?\.borrowedSettings\)/);
});

test('journey score rules last only for the match and a failed journey start restores them immediately', async () => {
    for (const startResult of [true, false]) {
        const { facade } = createFacade({ startResult });
        facade.game.settings.arcade = { runType: 'gauntlet', sectorCount: 17, maxMultiplier: 13,
            comboWindowMs: 6000, comboDecayPerSecond: 2, companionCount: 2, difficultyTierId: 'hard' };
        const before = structuredClone(facade.game.settings);
        await startMatchWithBorrowedSettings(facade, { journeyStageId: 'first_run' });
        if (startResult) {
            assert.equal(facade.game.settings.arcade.journeyStageId, 'first_run');
            assert.equal(facade.game.settings.arcade.sectorCount, 3);
            assert.equal(facade.game.settings.arcade.companionCount, 0);
            assert.equal(facade.game.settings.arcade.difficultyTierId, 'hard');
            facade.settingsHandler.restoreSessionSettings();
        }
        assert.deepEqual(facade.game.settings, before);
    }
});

test('a worm mission borrows one sector and restores the personal run after success or a failed start', async () => {
    for (const startResult of [true, false]) {
        const { facade } = createFacade({ startResult });
        facade.game.settings.arcade = { runType: 'gauntlet', sectorCount: 17, difficultyTierId: 'hard' };
        const before = structuredClone(facade.game.settings);
        await startMatchWithBorrowedSettings(facade, { journeyStageId: 'worm_hunt' });
        if (startResult) {
            assert.equal(facade.game.settings.arcade.sectorCount, 1);
            assert.equal(facade.game.settings.mapKey, 'standard');
            assert.equal(facade.game.settings.arcade.journeyStageId, 'worm_hunt');
            facade.settingsHandler.restoreSessionSettings();
        }
        assert.deepEqual(facade.game.settings, before);
    }
});
