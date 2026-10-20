// A vehicle profile in a schema this build cannot read (written by a newer version, or after a branch
// switch) is kept byte for byte on save. A writer that awards XP to that same vehicle used to get a
// fresh profile, have it silently replaced by the preserved record on save and still see "success",
// so the XP and the endless settlement receipt were lost without a trace.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY } from '../src/shared/contracts/EndlessParcoursSettlementContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { queueEndlessSettlement } from '../src/state/arcade/EndlessParcoursSettlementStore.js';

const FUTURE_PROFILE = Object.freeze({ schemaVersion: 'arcade-vehicle-profile.v99', vehicleId: 'ship5', xp: 100, futureField: 'kept' });

// Minimal record store like the player record store port: JSON values per key, saves acknowledged.
function createStore(initial = {}) {
    const records = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
    return {
        records,
        loadJsonRecord(key, fallback) { return records.has(key) ? structuredClone(records.get(key)) : fallback; },
        readJsonRecordResult(key) {
            return records.has(key)
                ? { ok: true, status: 'found', value: structuredClone(records.get(key)) }
                : { ok: true, status: 'missing', value: null };
        },
        saveJsonRecord(key, value) { records.set(key, structuredClone(value)); return true; },
    };
}

function settlement(xp = 500, vehicleId = 'ship5', runId = 'future-run') {
    return {
        runId,
        vehicleId,
        xp,
        ruleVersion: 'endless-parcours-rules.v2',
        endedAtIso: '2026-10-19T10:00:00.000Z',
        summary: { runId, score: 9000, distanceMeters: 1200, botKills: 3 },
        unlocks: [],
    };
}

test('an endless settlement for a vehicle with a future profile schema stays pending instead of vanishing', () => {
    const store = createStore({ [KEY]: { ship5: FUTURE_PROFILE } });
    const result = queueEndlessSettlement(store, settlement());

    assert.equal(result.ok, false, 'the settlement must not report success');
    assert.equal(result.pending, true, 'the XP stays in the pending ledger');
    assert.deepEqual(store.records.get(KEY).ship5, FUTURE_PROFILE, 'the future profile is untouched');
    assert.equal(store.records.get(ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY).pending.length, 1);
});

test('saving a changed profile for a preserved vehicle is refused instead of reporting success', () => {
    const store = createStore({ [KEY]: { ship5: FUTURE_PROFILE } });
    const profiles = loadVehicleProfiles(store);
    profiles.ship5 = addXp(getOrCreateProfile(profiles, 'ship5', 1), 250, 2).profile;

    const result = saveVehicleProfiles(store, profiles);

    assert.equal(result?.success, false, 'the writer learns that its XP was not stored');
    assert.equal(result?.reason, 'preserved_target');
    assert.deepEqual(store.records.get(KEY).ship5, FUTURE_PROFILE);
});

test('other vehicles still save next to a preserved record that the writer left alone', () => {
    const store = createStore({ [KEY]: { ship5: FUTURE_PROFILE } });
    const profiles = loadVehicleProfiles(store);
    // An untouched lookup of the preserved vehicle carries no progress and must not block the save.
    getOrCreateProfile(profiles, 'ship5', 1);
    profiles.ship1 = addXp(createArcadeVehicleProfile('ship1', 1), 40, 2).profile;

    assert.notEqual(saveVehicleProfiles(store, profiles)?.success, false);
    assert.equal(store.records.get(KEY).ship1.xp, 40);
    assert.deepEqual(store.records.get(KEY).ship5, FUTURE_PROFILE);
});

test('a refused preserved vehicle does not hold back the other vehicles, and a retry neither drops nor doubles XP', () => {
    const store = createStore({ [KEY]: { ship5: FUTURE_PROFILE } });
    const profiles = loadVehicleProfiles(store);
    profiles.ship5 = addXp(getOrCreateProfile(profiles, 'ship5', 1), 250, 2).profile;
    profiles.ship1 = addXp(createArcadeVehicleProfile('ship1', 1), 40, 2).profile;

    assert.equal(saveVehicleProfiles(store, profiles)?.reason, 'preserved_target');
    assert.equal(store.records.get(KEY).ship1?.xp, 40, 'ship1 progress is stored next to the refused vehicle');
    assert.deepEqual(store.records.get(KEY).ship5, FUTURE_PROFILE);

    assert.equal(saveVehicleProfiles(store, profiles)?.reason, 'preserved_target', 'a retry is refused again instead of silently passing');
    assert.equal(store.records.get(KEY).ship1.xp, 40, 'the retry does not count ship1 XP twice');
});
test('a pending settlement for a preserved vehicle does not hold back settlements for other vehicles', () => {
    const store = createStore({ [KEY]: { ship5: FUTURE_PROFILE } });
    assert.equal(queueEndlessSettlement(store, settlement(500)).pending, true);
    const second = queueEndlessSettlement(store, settlement(90, 'ship1', 'other-run'));

    assert.equal(store.records.get(KEY).ship1?.xp, 90, 'ship1 gets its XP although the ship5 entry is stuck');
    assert.deepEqual(store.records.get(KEY).ship5, FUTURE_PROFILE);
    assert.equal(second.pending, true, 'the stuck ship5 entry is still reported');
    const pending = store.records.get(ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY).pending;
    assert.deepEqual(pending.map((entry) => entry.settlement.runId), ['future-run'], 'only the stuck entry stays pending');
});