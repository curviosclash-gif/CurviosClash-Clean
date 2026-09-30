import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';

function createRunStub() {
    return {
        _enabled: true,
        _rewardBinding: { runType: 'endless_parcours', vehicleId: 'ship5' },
        _vehicleProfiles: {},
        _state: { xpEarned: 0 },
        _scheduleVehicleProfilesSave() {},
        _enqueueHudEvent: (type, payload) => ({ type, ...payload }),
    };
}

test('a split-screen checkpoint of player two levels player two\'s own plane', () => {
    const run = createRunStub();
    const result = ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 1, 'arrow');
    assert.ok(result?.earned > 0);
    assert.ok(run._vehicleProfiles.arrow, 'player two\'s plane gets the XP');
    assert.equal(run._vehicleProfiles.ship5, undefined, 'player one\'s plane gets nothing for it');
});

test('player one and callers without a plane keep the run\'s bound plane', () => {
    const run = createRunStub();
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 0, 'ship5');
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'finish', 0);
    assert.ok(run._vehicleProfiles.ship5);
    assert.deepEqual(Object.keys(run._vehicleProfiles), ['ship5']);
});
