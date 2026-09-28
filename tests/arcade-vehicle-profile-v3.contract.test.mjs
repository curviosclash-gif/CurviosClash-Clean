import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    arcadeVehicleLevelForXp,
    arcadeVehicleXpForLevel,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    resolveArcadeHangarProgressionSnapshot,
    resolveArcadeHangarRulesForLevel,
} from '../src/shared/contracts/ArcadeHangarRulesContract.js';
import { listUnlockedArcadeTrailStyles } from '../src/shared/contracts/ArcadeVehicleCosmeticContract.js';
import { collectCardBadges } from '../src/ui/arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getMasteryPerks,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
    xpForLevel,
    xpToNextLevel,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createFallbackProfilePort } from '../src/ui/hangar/HangarWorkshopProfileSupport.js';

const MAX = Number.MAX_SAFE_INTEGER;

function createKeyedStore(records = {}) {
    const data = new Map(Object.entries(records));
    return {
        data,
        loadJsonRecord(key, fallback) {
            return data.has(key) ? structuredClone(data.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            data.set(key, structuredClone(value));
            return true;
        },
    };
}

test('v3: the profile schema is arcade-vehicle-profile.v3', () => {
    assert.equal(ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION, 'arcade-vehicle-profile.v3');
    assert.equal(createArcadeVehicleProfile('ship5', 0).schemaVersion, 'arcade-vehicle-profile.v3');
});

test('v3: a vehicle levels past 30 and keeps a next-level requirement', () => {
    const result = addXp(createArcadeVehicleProfile('ship5', 0), xpForLevel(45), 0);
    assert.equal(result.newLevel, 45);
    assert.equal(result.profile.level, 45);
    const next = xpToNextLevel(result.profile);
    assert.ok(next.required > 0, 'level 45 still has a level 46 ahead');
    assert.ok(next.progress < 1);
    assert.equal(resolveArcadeHangarRulesForLevel(45).level, 45);
    assert.equal(resolveArcadeHangarRulesForLevel(45).band, 'elite');
});

test('v3: the xp curve and its inverse agree and stay finite for huge values', () => {
    for (const level of [1, 2, 30, 31, 45, 1000, 123456]) {
        const xp = arcadeVehicleXpForLevel(level);
        assert.equal(arcadeVehicleLevelForXp(xp), level, `xp ${xp} is level ${level}`);
        if (level > 1) assert.equal(arcadeVehicleLevelForXp(xp - 1), level - 1);
    }
    assert.equal(arcadeVehicleXpForLevel(MAX), MAX);
    const top = arcadeVehicleLevelForXp(MAX);
    assert.ok(Number.isSafeInteger(top) && top > 1_000_000);
    assert.ok(arcadeVehicleXpForLevel(top) <= MAX);
    assert.equal(arcadeVehicleLevelForXp(Infinity), top);
    assert.equal(arcadeVehicleLevelForXp(NaN), 1);
    assert.equal(xpForLevel(45), arcadeVehicleXpForLevel(45), 'state reuses the contract curve');
});

test('v3: very large xp gains clamp to MAX_SAFE_INTEGER without NaN or Infinity', () => {
    let profile = createArcadeVehicleProfile('ship5', 0);
    profile = addXp(profile, Number.MAX_VALUE, 0).profile;
    profile = addXp(profile, Infinity, 0).profile;
    profile = addXp(profile, MAX, 0).profile;
    for (const field of ['xp', 'xpBank', 'totalXpEarned', 'level']) {
        assert.ok(Number.isSafeInteger(profile[field]), `${field} stays a safe integer (${profile[field]})`);
    }
    assert.equal(profile.xp, MAX);
    assert.equal(profile.xpBank, MAX);
    assert.equal(profile.totalXpEarned, MAX);
    assert.equal(profile.level, arcadeVehicleLevelForXp(MAX));
    const next = xpToNextLevel(profile);
    assert.ok(Number.isFinite(next.current) && Number.isFinite(next.required) && Number.isFinite(next.progress));
});

test('v3: stored v2 and v1 records are discarded and the vehicle starts fresh', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: { schemaVersion: 'arcade-vehicle-profile.v2', vehicleId: 'ship1', xp: 5000, level: 12, xpBank: 900 },
            ship9: { schemaVersion: 'arcade-vehicle-profile.v1', vehicleId: 'ship9', xp: 700, level: 4 },
        },
    });
    const profiles = loadVehicleProfiles(store);
    assert.deepEqual(Object.keys(profiles), []);
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), {}, 'the old records are dropped from storage');
    const fresh = getOrCreateProfile(profiles, 'ship1', 0);
    assert.equal(fresh.xp, 0);
    assert.equal(fresh.level, 1);
    assert.equal(fresh.schemaVersion, 'arcade-vehicle-profile.v3');

    const legacyOnly = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY]: {
            ship1: { schemaVersion: 'arcade-vehicle-profile.v1', vehicleId: 'ship1', xp: 700, level: 4 },
        },
    });
    assert.deepEqual(Object.keys(loadVehicleProfiles(legacyOnly)), []);
});

test('v3: a stored record without schemaVersion is discarded as well', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: { vehicleId: 'ship1', xp: 5000, level: 12, xpBank: 900 },
        },
    });
    const profiles = loadVehicleProfiles(store);
    assert.deepEqual(Object.keys(profiles), [], 'no schemaVersion -> dropped, not adopted as v3');
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), {});
    assert.equal(getOrCreateProfile(profiles, 'ship1', 0).xp, 0);
});

test('v3: levels above 30 never read past a table end', () => {
    for (const level of [31, 45, 1000]) {
        assert.deepEqual(getMasteryPerks(level), { scoreBonusPct: 0, comboDecaySlowPct: 0, xpBonusPct: 0 });
        const snapshot = resolveArcadeHangarProgressionSnapshot(level);
        assert.equal(snapshot.level, level);
        assert.equal(snapshot.band, 'elite');
        assert.ok(snapshot.masteryMilestones.includes('legend'));
        assert.deepEqual(listUnlockedArcadeTrailStyles({ level }), listUnlockedArcadeTrailStyles(30), 'cosmetics clamp internally');
        const next = xpToNextLevel({ ...createArcadeVehicleProfile('ship5', 0), level, xp: xpForLevel(level) });
        assert.ok(next.required > 0 && Number.isFinite(next.progress));
        assert.equal(collectCardBadges({ kategorie: 'jaeger' }, { level }, false, false).includes('MAX'), false,
            `level ${level} has no ceiling, so no MAX badge`);
    }
});

test('v3: a profile round-trips through save and load unchanged', () => {
    const store = createKeyedStore();
    const profile = addXp(createArcadeVehicleProfile('manta', 0), xpForLevel(40) + 17, 0).profile;
    assert.equal(saveVehicleProfiles(store, { manta: profile }), true);
    const loaded = loadVehicleProfiles(store);
    assert.deepEqual(loaded.manta, profile);
    assert.equal(loaded.manta.level, 40);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).manta.schemaVersion, 'arcade-vehicle-profile.v3');
});

test('v3: the hangar fallback port uses the same uncapped curve', () => {
    const port = createFallbackProfilePort(createKeyedStore());
    assert.equal(port.xpForLevel(45), xpForLevel(45));
    const profile = { level: 45, xp: xpForLevel(45) + 10 };
    assert.deepEqual(port.xpToNextLevel(profile), xpToNextLevel({ ...createArcadeVehicleProfile('ship5', 0), ...profile }));
});
