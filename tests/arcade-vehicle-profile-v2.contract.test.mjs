import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    loadArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { resolvePlayerScopedStorageKey } from '../src/shared/contracts/PlayerProfileStorageContract.js';
import {
    loadVehicleProfiles,
    saveVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';

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

test('W7.1 reads v1 profiles losslessly and writes them as v2 without deleting v1', () => {
    const legacyProfiles = {
        ship1: {
            schemaVersion: 'arcade-vehicle-profile.v1',
            vehicleId: 'ship1',
            xp: 1450,
            totalXpEarned: 1450,
            level: 8,
            xpBank: 725,
            upgrades: { core: 'T2', engine_left: 'T2' },
            hangarStoneInventory: {
                schemaVersion: 'hangar-stone-inventory.v1',
                counts: { stone_gold_t1: 2 },
            },
            savedBuilds: [{ buildId: 'ship1-fast', slots: { core: 'core_t2' } }],
            activeBuildId: 'ship1-fast',
            createdAt: '2026-01-02T03:04:05.000Z',
            updatedAt: '2026-02-03T04:05:06.000Z',
        },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY]: legacyProfiles,
    });

    const profiles = loadVehicleProfiles(store);
    assert.equal(profiles.ship1.schemaVersion, ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION);
    assert.equal(profiles.ship1.xp, 1450);
    assert.equal(profiles.ship1.totalXpEarned, 1450);
    assert.equal(profiles.ship1.level, 8);
    assert.equal(profiles.ship1.xpBank, 725);
    assert.deepEqual(profiles.ship1.upgrades, legacyProfiles.ship1.upgrades);
    assert.deepEqual(profiles.ship1.hangarStoneInventory, legacyProfiles.ship1.hangarStoneInventory);
    assert.deepEqual(profiles.ship1.savedBuilds, legacyProfiles.ship1.savedBuilds);
    assert.equal(profiles.ship1.activeBuildId, 'ship1-fast');
    assert.equal(profiles.ship1.createdAt, '2026-01-02T03:04:05.000Z');
    assert.equal(profiles.ship1.updatedAt, '2026-02-03T04:05:06.000Z');
    assert.equal(profiles.ship1.trailStyleId, 'standard');
    assert.deepEqual(profiles.ship1.weaponStyleIds, {
        mg: 'standard',
        rockets: 'standard',
        flamethrower: 'standard',
        railgun: 'standard',
        lightning: 'standard',
    });
    assert.equal(store.writes.length, 0, 'reading the fallback does not rewrite storage');

    assert.equal(saveVehicleProfiles(store, profiles), true);
    assert.equal(store.writes.at(-1).key, ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY).ship1.xp, 1450);
});

test('W7.1 normalizes only damaged cosmetic selections and keeps the rest of a v2 profile', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship5: {
                schemaVersion: 'arcade-vehicle-profile.v2',
                vehicleId: 'ship5',
                xp: 3000,
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
            },
        },
    });

    const profile = loadVehicleProfiles(store).ship5;
    assert.equal(profile.xp, 3000);
    assert.equal(profile.xpBank, 1777);
    assert.deepEqual(profile.upgrades, { utility: 'T2' });
    assert.deepEqual(profile.customProgress, { cleanSectors: 9 });
    assert.equal(profile.trailStyleId, 'standard');
    assert.deepEqual(profile.weaponStyleIds, {
        mg: 'ion',
        rockets: 'standard',
        flamethrower: 'ember',
        railgun: 'nova',
        lightning: 'standard',
    });
});

test('W7.1 keeps vehicle progression and nested inventories isolated', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: {
                schemaVersion: 'arcade-vehicle-profile.v2', vehicleId: 'ship1',
                xp: 100, level: 2, xpBank: 75,
                upgrades: { core: 'T1' },
                hangarStoneInventory: { counts: { stone_gold_t1: 1 } },
                trailStyleId: 'ion',
                weaponStyleIds: { mg: 'ion' },
            },
            ship2: {
                schemaVersion: 'arcade-vehicle-profile.v2', vehicleId: 'ship2',
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

test('W7.1 shared profile readers use the scoped v1 fallback without rewriting it', () => {
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
    assert.equal(result.profiles.aircraft.level, 30);
    assert.equal(result.profiles.aircraft.schemaVersion, ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION);
    assert.equal(store.writes.length, 0);
});
