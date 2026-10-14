// The Fünf Fronten start button used to ask for 12 bots while the run dispatch always fills the
// arena's 24 slots; the menu now asks for what the run really spawns.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ARENA_WAVES_BOT_CAPACITY } from '../src/shared/contracts/ArenaWavesContract.js';
import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';

test('the Fünf Fronten button starts with the arena bot capacity', () => {
    const button = {};
    const listeners = new Map();
    let started = null;
    bindArcadeSpecialStartButtons(
        { startFiveFrontsButton: button },
        (node, type, listener) => { if (node === button && type === 'click') listeners.set(node, listener); },
        (...args) => { started = args; },
        () => 0,
        { hasUnsupportedPlayerCount: () => false, save: () => [], hasMissingActiveProfile: () => false },
        {},
    );
    listeners.get(button)();
    assert.equal(started[0], 'arena_waves');
    assert.equal(started[1].numBots, ARENA_WAVES_BOT_CAPACITY);
});
