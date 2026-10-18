import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { initializeArcadeJourneyAccess } from '../src/state/arcade/ArcadeJourneyAccessInitialization.js';
import { initializeLocalArcadeJourneyAccess } from '../src/core/runtime/PlayerProfileRuntimeAccess.js';

function store(seed = {}, fail = false) {
    const data = new Map(Object.entries(seed));
    let writes = 0;
    return { data, get writes() { return writes; },
        readJsonRecordResult(key) { return data.has(key)
            ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' }; },
        saveJsonRecord(key, value) { writes++; if (fail) return false;
            data.set(key, structuredClone(value)); return true; },
    };
}

test('fresh profile freezes locked access before its first run and never gains a legacy bypass', () => {
    const profile = store();
    assert.equal(initializeArcadeJourneyAccess(profile).status, 'saved');
    assert.equal(profile.data.get(ARCADE_JOURNEY_STORAGE_KEY).legacyAccessInitialized, true);
    assert.notEqual(profile.data.get(ARCADE_JOURNEY_STORAGE_KEY).allStagesUnlocked, true);
    profile.data.set(ARCADE_RUN_PROFILE_STORAGE_KEY, { runsPlayed: 1 });
    assert.equal(initializeArcadeJourneyAccess(profile).status, 'ok');
    assert.equal(profile.writes, 1);
    assert.notEqual(profile.data.get(ARCADE_JOURNEY_STORAGE_KEY).allStagesUnlocked, true);
});

test('existing runs are grandfathered once; unreadable or failed writes never mutate entitlement', () => {
    const veteran = store({ [ARCADE_RUN_PROFILE_STORAGE_KEY]: { runsPlayed: 3 } });
    assert.equal(initializeArcadeJourneyAccess(veteran).status, 'saved');
    assert.equal(veteran.data.get(ARCADE_JOURNEY_STORAGE_KEY).allStagesUnlocked, true);
    const unavailable = store({ [ARCADE_RUN_PROFILE_STORAGE_KEY]: { broken: true } });
    assert.equal(initializeArcadeJourneyAccess(unavailable).status, 'unavailable');
    assert.equal(unavailable.data.has(ARCADE_JOURNEY_STORAGE_KEY), false);
    const rejected = store({}, true);
    assert.equal(initializeArcadeJourneyAccess(rejected).status, 'unavailable');
    assert.equal(rejected.data.has(ARCADE_JOURNEY_STORAGE_KEY), false);
});

test('three split-screen stores freeze independently before shared history; one rejection blocks the start gate', () => {
    const stores = new Map([['p1', store()], ['p2', store()], ['p3', store()]]);
    const game = { settings: { localSettings: { sessionType: 'splitscreen',
        splitScreenVariant: 'three_player', startSetup: { arcadePlayerProfileIds: ['p1', 'p2', 'p3'] } } },
    playerProfileManager: { getProfiles: () => [...stores.keys()].map(id => ({ id })),
        getRecordStorePort: id => stores.get(id) } };
    // The split variant contract resolves three seats from the actual settings shape.
    assert.equal(initializeLocalArcadeJourneyAccess(game).status, 'ok');
    for (const member of stores.values()) {
        assert.equal(member.data.get(ARCADE_JOURNEY_STORAGE_KEY).legacyAccessInitialized, true);
        assert.notEqual(member.data.get(ARCADE_JOURNEY_STORAGE_KEY).allStagesUnlocked, true);
    }
    const failing = store({}, true);
    stores.set('p3', failing);
    game.playerProfileManager.getProfiles = () => [...stores.keys()].map(id => ({ id }));
    assert.equal(initializeLocalArcadeJourneyAccess(game).status, 'unavailable');
    assert.equal(failing.data.has(ARCADE_JOURNEY_STORAGE_KEY), false);
});
