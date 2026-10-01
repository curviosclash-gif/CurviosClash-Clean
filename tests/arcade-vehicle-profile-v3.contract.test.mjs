import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_V2_SCHEMA_VERSION,
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
    const invalidReads = new Set();
    return {
        data,
        invalidReads,
        loadJsonRecord(key, fallback) {
            return data.has(key) ? structuredClone(data.get(key)) : fallback;
        },
        readJsonRecordResult(key) {
            if (invalidReads.has(key)) return { status: 'invalid', raw: '{invalid json' };
            return data.has(key)
                ? { status: 'found', value: structuredClone(data.get(key)) }
                : { status: 'missing' };
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

test('v3: v2 and v1 profiles migrate to v3 with progress, parts, styles and new size defaults intact', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: {
                schemaVersion: 'arcade-vehicle-profile.v2', vehicleId: 'ship1',
                xp: 5000, level: 12, xpBank: 900, totalXpEarned: 6500, spentUpgradeXp: 5600,
                unlockedSlots: ['core', 'nose', 'utility'], upgrades: { core: 'T3', utility: 'T2' },
                hangarStoneInventory: { counts: { stone_gold_t1: 7 } },
                trailStyleId: 'prism', weaponStyleIds: { mg: 'nova', rockets: 'ember' },
                partStyle: { Utility: { color: 0x123456, scale: 1.1, variant: 'manta' } },
                customProgress: { cleanSectors: 9 }, createdAt: '2025-01-01T00:00:00.000Z',
            },
            ship9: { schemaVersion: 'arcade-vehicle-profile.v1', vehicleId: 'ship9', xp: 700, xpBank: 123, level: 4, upgrades: { nose: 'T1' } },
        },
    });
    const profiles = loadVehicleProfiles(store);
    assert.equal(profiles.ship1.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.equal(profiles.ship1.xp, 5000);
    assert.equal(profiles.ship1.xpBank, 900);
    assert.equal(profiles.ship1.totalXpEarned, 6500);
    assert.equal(profiles.ship1.spentUpgradeXp, 5600);
    assert.ok(profiles.ship1.unlockedSlots.includes('core'));
    assert.ok(profiles.ship1.unlockedSlots.includes('nose'));
    assert.ok(profiles.ship1.unlockedSlots.includes('utility'));
    assert.deepEqual(profiles.ship1.upgrades, { core: 'T3', utility: 'T2' });
    assert.deepEqual(profiles.ship1.hangarStoneInventory, { counts: { stone_gold_t1: 7 } });
    assert.equal(profiles.ship1.trailStyleId, 'prism');
    assert.equal(profiles.ship1.weaponStyleIds.mg, 'nova');
    assert.equal(profiles.ship1.weaponStyleIds.rockets, 'ember');
    assert.deepEqual(profiles.ship1.partStyle, { Utility: { color: 0x123456, scale: 1.1, variant: 'manta' } });
    assert.deepEqual(profiles.ship1.customProgress, { cleanSectors: 9 });
    assert.equal(profiles.ship1.sizeWorkshopUnlocked, false);
    assert.deepEqual(profiles.ship1.partSizes, { hull: 100, nose: 100, wings: 100, engines: 100, utility: 100 });
    assert.equal(profiles.ship9.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.equal(profiles.ship9.xp, 700);
    assert.equal(profiles.ship9.xpBank, 123);
    assert.deepEqual(profiles.ship9.upgrades, { nose: 'T1' });
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.xp, 5000);
    assert.deepEqual(loadVehicleProfiles(store), profiles, 'the canonical migrated records survive another load');

    const legacyOnly = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY]: {
            ship1: { schemaVersion: 'arcade-vehicle-profile.v1', vehicleId: 'ship1', xp: 700, xpBank: 250, level: 4 },
        },
    });
    const legacyProfile = loadVehicleProfiles(legacyOnly).ship1;
    assert.equal(legacyProfile.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.equal(legacyProfile.xp, 700);
    assert.equal(legacyProfile.xpBank, 250);
    assert.equal(legacyProfile.level, 4);
    assert.equal(legacyOnly.data.has(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), false, 'legacy-key loading keeps its previous no-write behavior');
});

test('v3: a stored record without schemaVersion follows the legacy-compatible upgrade path', () => {
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: { vehicleId: 'ship1', xp: 5000, level: 12, xpBank: 900 },
        },
    });
    const profiles = loadVehicleProfiles(store);
    assert.equal(profiles.ship1.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.equal(profiles.ship1.xp, 5000);
    assert.equal(profiles.ship1.level, 12);
    assert.equal(profiles.ship1.xpBank, 900);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.schemaVersion, 'arcade-vehicle-profile.v3');
});

test('v3: v2 records with future cosmetics migrate progress while preserving the raw cosmetic fields', () => {
    const rawProfile = {
        schemaVersion: ARCADE_VEHICLE_PROFILE_V2_SCHEMA_VERSION,
        vehicleId: 'ship5',
        xp: 250,
        level: 2,
        xpBank: 100,
        trailStyleId: 'future-trail',
        weaponStyleIds: { mg: 'future-weapon', futureFamily: 'future-value' },
        customProgress: { clearCount: 7 },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: rawProfile },
    });

    const profile = loadVehicleProfiles(store).ship5;
    assert.equal(profile.xp, 250);
    assert.equal(profile.level, 2);
    assert.equal(profile.xpBank, 100);
    assert.equal(profile.trailStyleId, 'standard');
    assert.equal(profile.weaponStyleIds.mg, 'standard');

    const migrated = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(migrated.schemaVersion, ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION);
    assert.equal(migrated.xp, 250);
    assert.equal(migrated.trailStyleId, rawProfile.trailStyleId);
    assert.deepEqual(migrated.weaponStyleIds, rawProfile.weaponStyleIds);
    assert.deepEqual(migrated.customProgress, rawProfile.customProgress);
});

test('v3: unknown, malformed and future profile records remain recoverable across loads and saves', () => {
    const future = { schemaVersion: 'arcade-vehicle-profile.v9', vehicleId: 'ship1', xp: 9999, newField: { keep: true } };
    const damaged = { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship4', xp: 'broken', xpBank: 'broken' };
    const malformed = 'recoverable raw value';
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship1: future, ship2: malformed, ship4: damaged },
    });
    const profiles = loadVehicleProfiles(store);
    assert.deepEqual(profiles, {}, 'unsupported records are not adopted as current profiles');
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), {
        ship1: future,
        ship2: malformed,
        ship4: damaged,
    }, 'supported-schema records with invalid field types stay opaque');

    const freshRuntimeProfile = getOrCreateProfile(profiles, 'ship1', 0);
    assert.equal(saveVehicleProfiles(store, { ship1: freshRuntimeProfile, ship3: createArcadeVehicleProfile('ship3', 0) }), true);
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1, future, 'a fresh fallback cannot overwrite future data');
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship2, malformed);
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship4, damaged,
        'saving a valid sibling cannot normalize broken xp values to zero');
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship3.schemaVersion, 'arcade-vehicle-profile.v3');
});

test('v3: damaged cosmetics use runtime fallbacks while raw cosmetic and version records stay preserved', () => {
    const damagedWeaponStyle = {
        schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship1', xp: 120,
        weaponStyleIds: { mg: 'newer-style' },
    };
    const damagedPartStyle = {
        schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship2', xp: 240,
        partStyle: { Utility: null },
    };
    const unknownPartStyleField = {
        schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship3', xp: 360,
        partStyle: { Utility: { color: 0x123456, rendererHint: 'future-renderer' } },
    };
    const emptySchemaVersion = { schemaVersion: '', vehicleId: 'ship4', xp: 480 };
    const nullSchemaVersion = { schemaVersion: null, vehicleId: 'ship5', xp: 600 };
    const mismatchedVehicleId = { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship7', xp: 720, upgrades: { core: 'T3' } };
    const validSibling = {
        ...createArcadeVehicleProfile('manta', 0),
        schemaVersion: 'arcade-vehicle-profile.v2',
        trailStyleId: 'prism',
        weaponStyleIds: { mg: 'nova', rockets: 'ember' },
        partStyle: { Utility: { color: 0x123456, scale: 1.1, variant: 'manta' } },
        customField: { keep: true },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            ship1: damagedWeaponStyle,
            ship2: damagedPartStyle,
            ship3: unknownPartStyleField,
            ship4: emptySchemaVersion,
            ship5: nullSchemaVersion,
            ship6: mismatchedVehicleId,
            manta: validSibling,
        },
    });

    const profiles = loadVehicleProfiles(store);
    assert.equal(profiles.ship1.xp, 120);
    assert.equal(profiles.ship1.weaponStyleIds.mg, 'standard');
    assert.equal(profiles.ship2.xp, 240);
    assert.deepEqual(profiles.ship2.partStyle, {});
    assert.equal(profiles.ship3.xp, 360);
    assert.deepEqual(profiles.ship3.partStyle, { Utility: { color: 0x123456 } });
    assert.equal(profiles.manta.schemaVersion, 'arcade-vehicle-profile.v3');
    assert.deepEqual(profiles.manta.weaponStyleIds.mg, 'nova');
    assert.deepEqual(profiles.manta.partStyle, validSibling.partStyle);
    assert.deepEqual(profiles.manta.customField, { keep: true });
    assert.equal(saveVehicleProfiles(store, profiles), true);

    const saved = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    assert.deepEqual(saved.ship1, damagedWeaponStyle);
    assert.deepEqual(saved.ship2, damagedPartStyle);
    assert.deepEqual(saved.ship3, unknownPartStyleField);
    assert.deepEqual(saved.ship4, emptySchemaVersion);
    assert.deepEqual(saved.ship5, nullSchemaVersion);
    assert.deepEqual(saved.ship6, mismatchedVehicleId);
    assert.equal(profiles.ship4, undefined, 'invalid progress stays unavailable rather than being defaulted');
    assert.equal(profiles.ship6, undefined, 'vehicle ID mismatches stay opaque');
    assert.deepEqual(saved.manta.customField, { keep: true });
});

test('v3: migration preserves unknown nested fields without filtering unknown vehicle ids', () => {
    const unknownValue = { source: 'older-game', payload: [1, { keep: true }] };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: {
            futureShipId: {
                schemaVersion: 'arcade-vehicle-profile.v2', vehicleId: 'futureShipId',
                xp: 125, level: 3, upgrades: { legacyPart: 'T2' }, customField: unknownValue,
            },
        },
    });

    const profiles = loadVehicleProfiles(store);
    assert.equal(profiles.futureShipId.xp, 125);
    assert.deepEqual(profiles.futureShipId.upgrades, { legacyPart: 'T2' });
    assert.deepEqual(profiles.futureShipId.customField, unknownValue);
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).futureShipId.customField, unknownValue);
});

test('v3: malformed top-level profile data is not overwritten by a save', () => {
    const malformed = ['recoverable top-level value'];
    const store = createKeyedStore({ [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: malformed });
    assert.equal(saveVehicleProfiles(store, { ship5: createArcadeVehicleProfile('ship5', 0) }), false);
    assert.deepEqual(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), malformed);
});

test('v3: unreadable stored JSON blocks canonical and gameplay saves', () => {
    const store = createKeyedStore();
    store.invalidReads.add(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    assert.deepEqual(loadVehicleProfiles(store), {});
    assert.equal(saveVehicleProfiles(store, { ship5: createArcadeVehicleProfile('ship5', 0) }), false);
    assert.equal(store.data.has(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), false);
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

test('v3: hangar fallback port saves progression and explicit cosmetics without discarding unknown cosmetic data', () => {
    const rawProfile = {
        schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        vehicleId: 'ship5',
        xp: 5300,
        level: 14,
        xpBank: 1777,
        customProgress: { cleanSectors: 9 },
        trailStyleId: 'newer-trail',
        weaponStyleIds: { mg: 'newer-weapon', futureFamily: 'future-value' },
        partStyle: { Utility: { color: 0x123456, rendererHint: 'future-renderer' } },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: rawProfile },
    });
    const port = createFallbackProfilePort(store);
    const profiles = port.load();
    assert.equal(profiles.ship5.xp, 5300);
    assert.equal(profiles.ship5.level, 14);
    assert.equal(profiles.ship5.trailStyleId, 'standard');
    assert.equal(profiles.ship5.weaponStyleIds.mg, 'standard');

    profiles.ship5 = {
        ...addXp(profiles.ship5, 20, 1234).profile,
        trailStyleId: 'ion',
        partStyle: { Utility: { color: 0x654321 } },
    };
    assert.equal(port.save(profiles), true);

    const saved = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(saved.xp, 5320);
    assert.equal(saved.level, 14);
    assert.equal(saved.xpBank, 1797);
    assert.equal(saved.trailStyleId, 'ion', 'an explicit hangar selection replaces the fallback field');
    assert.deepEqual(saved.weaponStyleIds, rawProfile.weaponStyleIds);
    assert.deepEqual(saved.partStyle, {
        Utility: { color: 0x654321, rendererHint: 'future-renderer' },
    });
    assert.deepEqual(saved.customProgress, rawProfile.customProgress);

    const reloaded = port.load().ship5;
    assert.equal(reloaded.xp, 5320);
    assert.equal(reloaded.trailStyleId, 'ion');
    assert.equal(reloaded.weaponStyleIds.mg, 'standard');
    assert.deepEqual(reloaded.partStyle, { Utility: { color: 0x654321 } });
});

test('v3: explicit cosmetic edits add missing fields beside preserved unknown styles', () => {
    const rawProfile = {
        schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        vehicleId: 'ship5',
        xp: 120,
        weaponStyleIds: { mg: 'newer-style' },
        customProgress: { preserve: true },
    };
    const store = createKeyedStore({
        [ARCADE_VEHICLE_PROFILE_STORAGE_KEY]: { ship5: rawProfile },
    });
    const port = createFallbackProfilePort(store);
    const profiles = port.load();
    assert.equal(profiles.ship5.trailStyleId, 'standard');
    assert.deepEqual(profiles.ship5.partStyle, {});

    profiles.ship5 = {
        ...profiles.ship5,
        trailStyleId: 'ion',
        weaponStyleIds: { ...profiles.ship5.weaponStyleIds, rockets: 'nova' },
        partStyle: { Utility: { color: 0xabcdef } },
    };
    assert.equal(port.save(profiles), true);

    const saved = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(saved.trailStyleId, 'ion');
    assert.deepEqual(saved.weaponStyleIds, { mg: 'newer-style', rockets: 'nova' });
    assert.deepEqual(saved.partStyle, { Utility: { color: 0xabcdef } });
    assert.deepEqual(saved.customProgress, rawProfile.customProgress);
    assert.equal(port.load().ship5.trailStyleId, 'ion');
    assert.equal(port.load().ship5.weaponStyleIds.rockets, 'nova');
});
