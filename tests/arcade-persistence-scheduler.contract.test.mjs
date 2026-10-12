import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';
import { addXp, createArcadeVehicleProfile, loadVehicleProfiles, saveVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { awardBoundArcadeVehicleXpInStore, bindArcadeVehicleRewards } from '../src/state/arcade/ArcadeVehicleRewardBinding.js';

test('Arcade persistence uses browser-safe bound default timers', () => {
    const scheduler = new ArcadeRunPersistenceScheduler({ saveThrottleMs: 100 });
    assert.match(scheduler._setTimeout.name, /^bound /);
    assert.match(scheduler._clearTimeout.name, /^bound /);
    scheduler.dispose();
});

test('Arcade persistence retains rejected and thrown writes until a successful retry', () => {
    const warnings = [];
    const scheduler = new ArcadeRunPersistenceScheduler({
        saveThrottleMs: 0,
        logger: { warn: (...args) => warnings.push(args) },
    });
    const results = [{ success: false, reason: 'quota' }, new Error('offline'), { success: true }];
    let attempts = 0;
    const store = {
        saveJsonRecord() {
            const result = results[attempts++];
            if (result instanceof Error) throw result;
            return result;
        },
    };

    assert.equal(scheduler.scheduleRunRecords(store, 'runs', { runsPlayed: 1 }), false);
    assert.deepEqual(Array.from(scheduler._pendingSaves.keys()), ['runRecords']);
    assert.equal(scheduler.flushAll(), false);
    assert.deepEqual(Array.from(scheduler._pendingSaves.keys()), ['runRecords']);
    assert.equal(scheduler.flushAll(), true);
    assert.equal(scheduler._pendingSaves.size, 0);
    assert.equal(attempts, 3);
    assert.ok(warnings.length >= 2);
});

test('Arcade profile and leaderboard adapters propagate rejected storage results', () => {
    const scheduler = new ArcadeRunPersistenceScheduler({
        saveThrottleMs: 0,
        logger: { warn() {} },
    });
    const store = { saveJsonRecord: () => ({ success: false, reason: 'full' }) };

    assert.equal(scheduler.scheduleVehicleProfiles(store, {}), false);
    assert.equal(scheduler.scheduleLeaderboard(store, {}), false);
    assert.deepEqual(
        new Set(scheduler._pendingSaves.keys()),
        new Set(['vehicleProfiles', 'leaderboard'])
    );
});

test('a delayed Arcade profile snapshot merges XP acknowledged after the snapshot was queued', () => {
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const baseline = { ship1: addXp(createArcadeVehicleProfile('ship1', 1), 100, 2).profile };
    assert.equal(saveVehicleProfiles(store, baseline), true);
    // Like ArcadeRunRuntime: the run edits the map it loaded, so the save merge knows its base.
    const staleArcadeSnapshot = loadVehicleProfiles(store);
    staleArcadeSnapshot.ship1 = addXp(staleArcadeSnapshot.ship1, 10, 3).profile;
    let timerCallback = null;
    const scheduler = new ArcadeRunPersistenceScheduler({
        saveThrottleMs: 100,
        setTimeout(callback) { timerCallback = callback; return 1; },
        clearTimeout() {},
        logger: { warn() {} },
    });
    assert.equal(scheduler.scheduleVehicleProfiles(store, staleArcadeSnapshot), true);

    const raceBinding = bindArcadeVehicleRewards({ runType: 'weapon_race', vehicleId: 'ship1' });
    assert.equal(awardBoundArcadeVehicleXpInStore(store, raceBinding, 80, 4).persisted, true,
        'the post-terminal race retry is acknowledged before the delayed Arcade write');
    assert.equal(typeof timerCallback, 'function');
    assert.equal(scheduler.flushAll(), true);

    const persisted = loadVehicleProfiles(store).ship1;
    assert.equal(persisted.xp, 190, 'the delayed sector snapshot and later race XP both survive');
    assert.equal(persisted.totalXpEarned, 190);
});
