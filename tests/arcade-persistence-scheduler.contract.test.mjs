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

test('foreign XP saved between planning and a delayed run save is counted exactly once', () => {
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    assert.equal(saveVehicleProfiles(store, { ship1: addXp(createArcadeVehicleProfile('ship1', 1), 100, 2).profile }), true);
    let timerCallback = null;
    const scheduler = new ArcadeRunPersistenceScheduler({
        saveThrottleMs: 100,
        setTimeout(callback) { timerCallback = callback; return 1; },
        clearTimeout() {},
        logger: { warn() {} },
    });
    // The run keeps the map it loaded at start and plans a throttled save after its own sector XP.
    const runProfiles = loadVehicleProfiles(store);
    runProfiles.ship1 = addXp(runProfiles.ship1, 10, 3).profile;
    assert.equal(scheduler.scheduleVehicleProfiles(store, runProfiles), true);

    // A second writer (hangar window, weapon-race prize) books its own XP before the timer fires.
    const hangarProfiles = loadVehicleProfiles(store);
    hangarProfiles.ship1 = addXp(hangarProfiles.ship1, 80, 4).profile;
    assert.equal(saveVehicleProfiles(store, hangarProfiles), true);

    assert.equal(typeof timerCallback, 'function');
    timerCallback();
    let persisted = loadVehicleProfiles(store).ship1;
    assert.equal(persisted.totalXpEarned, 190, 'stored 100 + run 10 + foreign 80, the foreign 80 only once');
    assert.equal(persisted.xp, 190);

    // The next run save applies only the new run XP on top of what is stored now.
    runProfiles.ship1 = addXp(runProfiles.ship1, 5, 5).profile;
    assert.equal(scheduler.scheduleVehicleProfiles(store, runProfiles), true);
    assert.equal(scheduler.flushAll(), true);
    persisted = loadVehicleProfiles(store).ship1;
    assert.equal(persisted.totalXpEarned, 195);
    assert.equal(persisted.xp, 195);
});

test('a bound reward retried after a rejected save is booked once next to a delayed run save', () => {
    const records = new Map();
    let rejectNext = false;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (rejectNext) { rejectNext = false; return { ok: false, status: 'write_failed' }; }
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    assert.equal(saveVehicleProfiles(store, { ship1: addXp(createArcadeVehicleProfile('ship1', 1), 100, 2).profile }).ok, true);
    const scheduler = new ArcadeRunPersistenceScheduler({
        saveThrottleMs: 100,
        setTimeout() { return 1; },
        clearTimeout() {},
        logger: { warn() {} },
    });
    const runProfiles = loadVehicleProfiles(store);
    runProfiles.ship1 = addXp(runProfiles.ship1, 10, 3).profile;
    assert.equal(scheduler.scheduleVehicleProfiles(store, runProfiles), true);

    const raceBinding = bindArcadeVehicleRewards({ runType: 'weapon_race', vehicleId: 'ship1' });
    rejectNext = true;
    assert.equal(awardBoundArcadeVehicleXpInStore(store, raceBinding, 80, 4).persisted, false);
    assert.equal(awardBoundArcadeVehicleXpInStore(store, raceBinding, 80, 5).persisted, true);
    assert.equal(scheduler.flushAll(), true);

    const persisted = loadVehicleProfiles(store).ship1;
    assert.equal(persisted.totalXpEarned, 190, 'the rejected attempt wrote nothing, the retry books 80 once');
    assert.equal(persisted.xp, 190);
});
