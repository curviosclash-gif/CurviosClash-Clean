// Split-screen: player one's run profiles and a partner's profiles can live in the same store, and
// the persistence scheduler saves them in separate slots one after the other. Each save merges onto
// the freshly stored record, so neither slot overwrites the XP the other one just stored.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { createArcadeVehicleProfile, loadVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { awardBoundArcadeVehicleXp, bindArcadeVehicleRewards } from '../src/state/arcade/ArcadeVehicleRewardBinding.js';
import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';

function createStore() {
    const data = new Map([[KEY, {
        ship5: { ...createArcadeVehicleProfile('ship5', 0), xp: 1000, xpBank: 1000, totalXpEarned: 1000 },
        ship1: { ...createArcadeVehicleProfile('ship1', 0), xp: 100, xpBank: 100, totalXpEarned: 100 },
    }]]);
    return {
        data,
        loadJsonRecord: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        saveJsonRecord(key, value) { data.set(key, structuredClone(value)); return true; },
    };
}

for (const throttleMs of [0, 50]) {
    test(`both split-screen slots keep their XP in a shared store (throttle ${throttleMs} ms)`, async () => {
        const store = createStore();
        const scheduler = new ArcadeRunPersistenceScheduler({ saveThrottleMs: throttleMs, logger: { warn() {} } });
        const playerOne = loadVehicleProfiles(store);
        const playerTwo = loadVehicleProfiles(store);
        const rewards = (vehicleId) => bindArcadeVehicleRewards({ runType: 'gauntlet', vehicleId });

        awardBoundArcadeVehicleXp(playerOne, rewards('ship5'), 300, 1);
        scheduler.scheduleVehicleProfiles(store, playerOne);
        awardBoundArcadeVehicleXp(playerTwo, rewards('ship5'), 200, 2);
        awardBoundArcadeVehicleXp(playerTwo, rewards('ship1'), 50, 2);
        scheduler.scheduleVehicleProfiles(store, playerTwo, 'player1');
        awardBoundArcadeVehicleXp(playerOne, rewards('ship5'), 70, 3);
        scheduler.scheduleVehicleProfiles(store, playerOne);
        assert.equal(scheduler.flushAllResult().ok, true);

        const stored = store.data.get(KEY);
        assert.equal(stored.ship5.xp, 1000 + 300 + 200 + 70, 'XP of both pilots on the same plane add up');
        assert.equal(stored.ship5.xpBank, 1000 + 300 + 200 + 70);
        assert.equal(stored.ship1.xp, 150, "the partner's own plane keeps its XP");
    });
}
