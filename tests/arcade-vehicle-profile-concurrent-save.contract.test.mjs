// Hangar window and arcade run each hold their own copy of the vehicle profiles. A save from
// one stale copy must not undo what the other copy already wrote: run XP survives a later
// hangar style change, and hangar purchases survive a later run save.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_TRAIL_STYLE_IDS,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    createArcadeVehicleProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { awardBoundArcadeVehicleXp, bindArcadeVehicleRewards } from '../src/state/arcade/ArcadeVehicleRewardBinding.js';
import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';

const STYLE = ARCADE_TRAIL_STYLE_IDS.find((id) => id !== 'standard');
const binding = bindArcadeVehicleRewards({ runType: 'gauntlet', vehicleId: 'ship5' });

function createStore() {
    const ship5 = { ...createArcadeVehicleProfile('ship5', 0), xp: 1000, xpBank: 1000, totalXpEarned: 1000 };
    const ship1 = { ...createArcadeVehicleProfile('ship1', 0), xp: 200, xpBank: 200, totalXpEarned: 200 };
    const data = new Map([[KEY, { ship5, ship1 }]]);
    return {
        data,
        loadJsonRecord: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        readJsonRecordResult: (key) => (data.has(key) ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' }),
        saveJsonRecord(key, value) { data.set(key, structuredClone(value)); return true; },
    };
}

const stored = (store, id) => store.data.get(KEY)[id];

test('run XP survives a hangar style change saved from a copy loaded before the run', () => {
    const store = createStore();
    const hangar = loadVehicleProfiles(store);
    const run = loadVehicleProfiles(store);

    awardBoundArcadeVehicleXp(run, binding, 500, 1);
    assert.notEqual(saveVehicleProfiles(store, run), false);
    assert.equal(stored(store, 'ship5').xp, 1500);

    hangar.ship5 = { ...hangar.ship5, trailStyleId: STYLE };
    assert.notEqual(saveVehicleProfiles(store, hangar), false);

    assert.equal(stored(store, 'ship5').xp, 1500, 'the hangar copy must not roll back run XP');
    assert.equal(stored(store, 'ship5').xpBank, 1500);
    assert.equal(stored(store, 'ship5').totalXpEarned, 1500);
    assert.equal(stored(store, 'ship5').trailStyleId, STYLE, 'the hangar change is kept');
    assert.equal(stored(store, 'ship1').xp, 200);
});

test('hangar purchases survive a later run save through the scheduler', () => {
    const store = createStore();
    const run = loadVehicleProfiles(store);
    const hangar = loadVehicleProfiles(store);

    hangar.ship5 = {
        ...hangar.ship5,
        upgrades: { core: 'T2' },
        xpBank: hangar.ship5.xpBank - 300,
        spentUpgradeXp: hangar.ship5.spentUpgradeXp + 300,
        trailStyleId: STYLE,
    };
    assert.notEqual(saveVehicleProfiles(store, hangar), false);

    const scheduler = new ArcadeRunPersistenceScheduler({ saveThrottleMs: 0, logger: { warn() {} } });
    awardBoundArcadeVehicleXp(run, binding, 200, 2);
    assert.equal(scheduler.scheduleVehicleProfiles(store, run), true);
    awardBoundArcadeVehicleXp(run, binding, 100, 3);
    assert.equal(scheduler.scheduleVehicleProfiles(store, run), true);

    const ship5 = stored(store, 'ship5');
    assert.deepEqual(ship5.upgrades, { core: 'T2' }, 'the run copy must not drop the purchase');
    assert.equal(ship5.trailStyleId, STYLE);
    assert.equal(ship5.spentUpgradeXp, 300);
    assert.equal(ship5.xp, 1300, 'each run save adds only its own new XP');
    assert.equal(ship5.xpBank, 1000 - 300 + 300);
});

test('vehicles a writer never loaded stay untouched in storage', () => {
    const store = createStore();
    const partial = { ship5: { ...loadVehicleProfiles(store).ship5, trailStyleId: STYLE } };
    assert.notEqual(saveVehicleProfiles(store, partial), false);
    assert.equal(stored(store, 'ship1').xp, 200);
    assert.equal(stored(store, 'ship5').trailStyleId, STYLE);
});

test('two writers spending the same bank XP: the second save is refused and writes nothing', () => {
    const store = createStore();
    store.data.set(KEY, { ...store.data.get(KEY), ship5: { ...stored(store, 'ship5'), xpBank: 100 } });
    const first = loadVehicleProfiles(store);
    const second = loadVehicleProfiles(store);
    const spend = (profiles, slot) => ({ ...profiles.ship5, xpBank: profiles.ship5.xpBank - 80,
        spentUpgradeXp: profiles.ship5.spentUpgradeXp + 80, upgrades: { ...profiles.ship5.upgrades, [slot]: 'T2' } });

    first.ship5 = spend(first, 'core');
    assert.notEqual(saveVehicleProfiles(store, first), false);
    const afterFirst = structuredClone(store.data.get(KEY));

    second.ship5 = spend(second, 'nose');
    const quiet = console.warn;
    console.warn = () => {};
    let refused;
    let retried;
    try {
        refused = saveVehicleProfiles(store, second);
        retried = saveVehicleProfiles(store, second);
    } finally {
        console.warn = quiet;
    }
    assert.equal(refused?.success, false);
    assert.equal(refused?.reason, 'bank_conflict');
    assert.deepEqual(store.data.get(KEY), afterFirst, 'nothing is written');
    assert.equal(retried?.reason, 'bank_conflict', 'the base is not advanced, a retry is refused again');
    assert.equal(stored(store, 'ship5').xpBank, 20);
    assert.deepEqual(stored(store, 'ship5').upgrades, { core: 'T2' });
});

test('earned XP keeps the bank positive, so spending beside a run is merged normally', () => {
    const store = createStore();
    const hangar = loadVehicleProfiles(store);
    const run = loadVehicleProfiles(store);
    awardBoundArcadeVehicleXp(run, binding, 50, 1);
    assert.notEqual(saveVehicleProfiles(store, run), false);
    hangar.ship5 = { ...hangar.ship5, xpBank: hangar.ship5.xpBank - 900, spentUpgradeXp: 900 };
    assert.equal(saveVehicleProfiles(store, hangar), true);
    assert.equal(stored(store, 'ship5').xpBank, 150);
});

test('milestones and endless receipts from two writers are merged as a union', () => {
    const store = createStore();
    const a = loadVehicleProfiles(store);
    const b = loadVehicleProfiles(store);
    const ship1Binding = bindArcadeVehicleRewards({ runType: 'gauntlet', vehicleId: 'ship1' });

    awardBoundArcadeVehicleXp(a, ship1Binding, 10_000, 1);
    a.ship1 = { ...a.ship1, endlessSettlementIds: ['run-a'] };
    assert.notEqual(saveVehicleProfiles(store, a), false);
    awardBoundArcadeVehicleXp(b, ship1Binding, 1_200, 2);
    b.ship1 = { ...b.ship1, endlessSettlementIds: ['run-b'] };
    assert.notEqual(saveVehicleProfiles(store, b), false);

    const ship1 = stored(store, 'ship1');
    assert.ok(ship1.level >= 10);
    assert.ok(ship1.masteryMilestones.includes('tactician'), 'the slower writer keeps the higher milestones');
    assert.deepEqual([...ship1.endlessSettlementIds].sort(), ['run-a', 'run-b']);
});