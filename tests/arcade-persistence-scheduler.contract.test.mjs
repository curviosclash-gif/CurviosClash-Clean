import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';

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
