import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    loadArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { resolvePlayerScopedStorageKey } from '../src/shared/contracts/PlayerProfileStorageContract.js';
import { addXp, loadVehicleProfiles, saveVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';

function createKeyedStore(records = {}) {
    const data = new Map(Object.entries(records));
    return {
        data,
        writes: [],
        loadJsonRecord(key, fallback) {
            return data.has(key) ? structuredClone(data.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            const copy = structuredClone(value);
            data.set(key, copy);
            this.writes.push({ key, value: copy });
            return true;
        },
    };
}

test('W7.1 keeps supported progress usable with cosmetic fallbacks and preserves raw cosmetic data', () => {
    const rawProfile = {
        schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        vehicleId: 'ship5',
        xp: 5300,
        level: 14,
        xpBank: 1777,
        upgrades: { utility: 'T2' },
        customProgress: { cleanSectors: 9 },
        trailStyleId: 'not-a-style',
        weaponStyleIds: {
            mg: 'ion',
            rockets: 'broken',
            flamethrower: 'ember',
            railgun: 'nova',
            lightning: null,
        },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship5: rawProfile,
        },
    });

    const profile = loadVehicleProfiles(store).ship5;
    assert.equal(profile.xp, 5300);
    assert.equal(profile.xpBank, 1777);
    assert.deepEqual(profile.upgrades, { utility: 'T2' });
    assert.deepEqual(profile.customProgress, { cleanSectors: 9 });
    assert.equal(profile.trailStyleId, 'standard');
    assert.deepEqual(profile.weaponStyleIds, {
        mg: 'ion',
        rockets: 'standard',
        flamethrower: 'ember',
        railgun: 'standard',
        lightning: 'standard',
    });

    const earned = addXp(profile, 25, 1234).profile;
    assert.equal(saveVehicleProfiles(store, { ship5: earned }), true);
    const savedProfile = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(savedProfile.xp, 5325);
    assert.equal(savedProfile.level, 14);
    assert.equal(savedProfile.xpBank, 1802);
    assert.equal(savedProfile.trailStyleId, rawProfile.trailStyleId);
    assert.deepEqual(savedProfile.weaponStyleIds, rawProfile.weaponStyleIds);
    assert.deepEqual(savedProfile.customProgress, rawProfile.customProgress);

    const reloaded = loadVehicleProfiles(store).ship5;
    assert.equal(reloaded.xp, 5325);
    assert.equal(reloaded.level, 14);
    assert.equal(reloaded.xpBank, 1802);
    assert.equal(reloaded.trailStyleId, 'standard');
    assert.equal(reloaded.weaponStyleIds.rockets, 'standard');

    const explicitCosmeticEdit = {
        ...reloaded,
        trailStyleId: 'ion',
        weaponStyleIds: { ...reloaded.weaponStyleIds, rockets: 'prism' },
    };
    assert.equal(saveVehicleProfiles(store, { ship5: explicitCosmeticEdit }), true);
    const editedRawProfile = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(editedRawProfile.trailStyleId, 'ion');
    assert.equal(editedRawProfile.weaponStyleIds.rockets, 'prism');
    assert.equal(editedRawProfile.weaponStyleIds.lightning, null);
    assert.equal(editedRawProfile.trailStyleId, 'ion');
});

test('W7.1 keeps vehicle progression and nested inventories isolated', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: {
                schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION, vehicleId: 'ship1',
                xp: 100, level: 2, xpBank: 75,
                upgrades: { core: 'T1' },
                hangarStoneInventory: { counts: { stone_gold_t1: 1 } },
                trailStyleId: 'ion',
                weaponStyleIds: { mg: 'ion' },
            },
            ship2: {
                schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION, vehicleId: 'ship2',
                xp: 900, level: 5, xpBank: 600,
                upgrades: { nose: 'T2' },
                hangarStoneInventory: { counts: { stone_gold_t1: 4 } },
                trailStyleId: 'ember',
                weaponStyleIds: { mg: 'ember' },
            },
        },
    });

    const profiles = loadVehicleProfiles(store);
    profiles.ship1.upgrades.core = 'T3';
    profiles.ship1.hangarStoneInventory.counts.stone_gold_t1 = 7;
    profiles.ship1.weaponStyleIds.mg = 'nova';

    assert.equal(profiles.ship2.xp, 900);
    assert.equal(profiles.ship2.xpBank, 600);
    assert.deepEqual(profiles.ship2.upgrades, { nose: 'T2' });
    assert.equal(profiles.ship2.hangarStoneInventory.counts.stone_gold_t1, 4);
    assert.equal(profiles.ship2.trailStyleId, 'ember');
    assert.equal(profiles.ship2.weaponStyleIds.mg, 'ember');
});

test('W7.1 keeps v1 and v2 records separately reachable inside a player profile', () => {
    const profileId = '00000000-0000-4000-8000-000000000001';
    assert.equal(
        resolvePlayerScopedStorageKey(profileId, ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY),
        `cuviosclash.player.${profileId}.arcade-vehicle-profile.v1`,
    );
    assert.equal(
        resolvePlayerScopedStorageKey(profileId, ARCADE_VEHICLE_PROFILE_STORAGE_KEY),
        `cuviosclash.player.${profileId}.arcade-vehicle-profile.v2`,
    );
});

test('W7.1 shared profile readers keep v1 records from the fallback key without rewriting it', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY]: {
            aircraft: {
                schemaVersion: 'arcade-vehicle-profile.v1',
                vehicleId: 'aircraft',
                xp: 999999,
                xpBank: 999999,
                level: 30,
            },
        },
    });

    const result = loadArcadeVehicleProfileRecord(store);
    assert.equal(result.usedLegacyFallback, true);
    assert.equal(result.profiles.aircraft.schemaVersion, ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION);
    assert.equal(result.profiles.aircraft.xp, 999999);
    assert.equal(result.profiles.aircraft.xpBank, 999999);
    assert.equal(store.writes.length, 0);
});
