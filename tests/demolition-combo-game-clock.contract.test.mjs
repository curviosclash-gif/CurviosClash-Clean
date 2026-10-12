import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advanceDemolitionComboClock,
    applyDemolitionComboEvent,
    getDemolitionComboMultiplier,
    resetDemolitionCombo,
} from '../src/core/arcade/DemolitionComboOps.js';

// The combo runtime is the arcade run runtime; only now(), the config and the records are read.
function createComboRuntime(startWallMs = 1_000_000) {
    const clock = { wallMs: startWallMs };
    const runtime = { now: () => clock.wallMs, _config: {}, _records: null, _state: null };
    return { runtime, clock };
}

function buildFullCombo(runtime) {
    resetDemolitionCombo(runtime);
    for (let index = 0; index < 6; index += 1) {
        applyDemolitionComboEvent(runtime, { playerIndex: 0, basePoints: 100 });
    }
    return getDemolitionComboMultiplier(runtime);
}

test('a pause does not let the demolition combo decay', () => {
    const { runtime, clock } = createComboRuntime();
    assert.equal(buildFullCombo(runtime), 3, 'six quick kills reach the demolition cap of x3');

    // A minute in the pause menu: the wall clock runs on, the game does not tick.
    clock.wallMs += 60_000;
    applyDemolitionComboEvent(runtime, { playerIndex: 0, basePoints: 100 });

    assert.equal(getDemolitionComboMultiplier(runtime), 3, 'no game time passed, so the chain must hold');
});

test('the demolition combo still decays with played time', () => {
    const { runtime } = createComboRuntime();
    assert.equal(buildFullCombo(runtime), 3);

    // Twenty seconds of play without a kill run far past the combo window.
    for (let tick = 0; tick < 20 * 60; tick += 1) advanceDemolitionComboClock(runtime, 1 / 60);
    applyDemolitionComboEvent(runtime, { playerIndex: 0, basePoints: 100 });

    assert.ok(getDemolitionComboMultiplier(runtime) < 3, 'played time without kills breaks the chain');
});
