// Unreadable stored vehicle profiles keep blocking every profile save (nothing may overwrite them),
// but the raw text is now copied once under a backup key and a warning names that key, instead of
// XP silently never being stored.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_BACKUP_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY as LEGACY_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY,
    ARCADE_VEHICLE_PROFILE_UNREADABLE_BACKUP_SUFFIX as SUFFIX,
    loadArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    createArcadeVehicleProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createPlayerRecordStorePort } from '../src/application/player-profile/PlayerProfileManager.js';

let storeCount = 0;

// Holds raw strings like localStorage; keys are scoped per player profile like the record store port.
function createRawStore(rawByKey) {
    storeCount += 1;
    const prefix = `cuviosclash.player.test${storeCount}.`;
    const scoped = (key) => (key === KEY || key === LEGACY_KEY ? `${prefix}${key}` : key);
    const raw = new Map(Object.entries(rawByKey).map(([key, value]) => [scoped(key), value]));
    const writes = [];
    return {
        raw,
        writes,
        prefix,
        resolveStorageKey: (key) => (key === KEY || key === LEGACY_KEY ? scoped(key) : null),
        readJsonRecordResult(key) {
            const value = raw.get(scoped(key));
            if (typeof value !== 'string') return { status: 'missing', value: null, raw: null };
            try {
                return { status: 'found', value: JSON.parse(value), raw: value };
            } catch {
                return { status: 'invalid', value: null, raw: value };
            }
        },
        loadJsonRecord(key, fallback) {
            const result = this.readJsonRecordResult(key);
            return result.status === 'found' ? result.value : fallback;
        },
        saveJsonRecord(key, value) {
            writes.push(scoped(key));
            raw.set(scoped(key), JSON.stringify(value));
            return true;
        },
    };
}

function createGlobalRawStore(rawByKey) {
    const raw = new Map(Object.entries(rawByKey));
    const writes = [];
    return {
        raw,
        writes,
        readJsonRecordResult(key) {
            const value = raw.get(key);
            if (typeof value !== 'string') return { status: 'missing', raw: null };
            try {
                return { status: 'found', value: JSON.parse(value), raw: value };
            } catch {
                return { status: 'invalid', raw: value, reason: 'invalid_json' };
            }
        },
        loadJsonRecord(key, fallback) {
            const result = this.readJsonRecordResult(key);
            return result.status === 'found' ? result.value : fallback;
        },
        saveJsonRecord(key, value) {
            writes.push(key);
            raw.set(key, JSON.stringify(value));
            return true;
        },
    };
}

function quietly(fn) {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
        return { value: fn(), warnings };
    } finally {
        console.warn = original;
    }
}

test('invalid JSON is copied once to a backup key and the original stays untouched', () => {
    const store = createRawStore({ [KEY]: '{"ship5": {"xp": 9000' });
    const backupKey = `${store.prefix}${KEY}${SUFFIX}`;

    const first = quietly(() => loadVehicleProfiles(store));
    assert.deepEqual(first.value, {});
    assert.equal(store.raw.get(`${store.prefix}${KEY}`), '{"ship5": {"xp": 9000', 'the original text is never rewritten');
    const backup = JSON.parse(store.raw.get(backupKey));
    assert.equal(backup.schemaVersion, ARCADE_VEHICLE_PROFILE_BACKUP_SCHEMA_VERSION);
    assert.equal(backup.raw, '{"ship5": {"xp": 9000');
    assert.equal(backup.sourceKey, `${store.prefix}${KEY}`);
    assert.equal(first.warnings.length, 1);
    assert.match(first.warnings[0], new RegExp(backupKey.replace(/\./g, '\\.')));

    const second = quietly(() => loadVehicleProfiles(store));
    assert.equal(second.warnings.length, 0, 'the warning comes once');
    assert.deepEqual(store.writes, [backupKey], 'only the backup was written, once');

    const saved = quietly(() => saveVehicleProfiles(store, { ship5: createArcadeVehicleProfile('ship5', 0) }));
    assert.equal(saved.value, false, 'saves stay blocked');
    assert.equal(store.raw.get(`${store.prefix}${KEY}`), '{"ship5": {"xp": 9000');
});

test('a missing scoped record backs up an unreadable global fallback at its actual source key', () => {
    const original = '{"ship5":{"xp":9000';
    const rawStore = createGlobalRawStore({ [KEY]: original });
    const port = createPlayerRecordStorePort({
        profileId: 'fallback-source-test',
        globalRecordStore: rawStore,
        allowLegacyFallback: () => true,
    });
    const scopedKey = port.resolveStorageKey(KEY);
    const globalBackupKey = `${KEY}${SUFFIX}`;
    const scopedBackupKey = `${scopedKey}${SUFFIX}`;

    const { value, warnings } = quietly(() => loadVehicleProfiles(port));

    assert.deepEqual(value, {});
    assert.equal(rawStore.raw.get(KEY), original);
    assert.equal(rawStore.raw.has(scopedKey), false);
    assert.equal(JSON.parse(rawStore.raw.get(globalBackupKey)).sourceKey, KEY);
    assert.equal(rawStore.raw.has(scopedBackupKey), false, 'fallback metadata must not be re-scoped');
    assert.deepEqual(rawStore.writes, [globalBackupKey]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], new RegExp(globalBackupKey.replace(/\./g, '\\.')));
    assert.equal(saveVehicleProfiles(port, { ship5: createArcadeVehicleProfile('ship5', 0) }), false);
    assert.deepEqual(rawStore.writes, [globalBackupKey], 'unreadable source keeps profile saves blocked');
});

test('a scoped corrupt record is backed up in its own scope without consulting the global value', () => {
    const scopedKey = `cuviosclash.player.scoped-source-test.arcade-vehicle-profile.v2`;
    const rawStore = createGlobalRawStore({ [KEY]: JSON.stringify({ ship1: { xp: 50 } }), [scopedKey]: '{broken scoped' });
    const port = createPlayerRecordStorePort({
        profileId: 'scoped-source-test',
        globalRecordStore: rawStore,
        allowLegacyFallback: () => true,
    });
    const scopedBackupKey = `${scopedKey}${SUFFIX}`;

    const { warnings } = quietly(() => loadVehicleProfiles(port));

    assert.equal(JSON.parse(rawStore.raw.get(scopedBackupKey)).sourceKey, scopedKey);
    assert.equal(rawStore.raw.get(scopedKey), '{broken scoped');
    assert.equal(rawStore.raw.get(KEY), JSON.stringify({ ship1: { xp: 50 } }));
    assert.deepEqual(rawStore.writes, [scopedBackupKey]);
    assert.equal(warnings.length, 1);
});

test('fallback-disabled reads stay missing and future profile schemas remain opaque', () => {
    const original = JSON.stringify({
        ship5: { schemaVersion: 'arcade-vehicle-profile.v99', vehicleId: 'ship5', opaque: true },
    });
    const rawStore = createGlobalRawStore({ [KEY]: original });
    const futurePort = createPlayerRecordStorePort({
        profileId: 'future-schema-test',
        globalRecordStore: rawStore,
        allowLegacyFallback: () => true,
    });
    const { warnings } = quietly(() => loadVehicleProfiles(futurePort));
    const future = loadArcadeVehicleProfileRecord(futurePort);
    assert.equal(future.canPersist, true);
    assert.deepEqual(future.preservedProfiles.ship5, JSON.parse(original).ship5);
    assert.equal(future.unreadableRecord, undefined);
    assert.equal(rawStore.raw.get(KEY), original, 'fallback parsing never rewrites the global future record');
    assert.equal(warnings.length, 0, 'recognized future schemas are preserved without a corrupt-record backup');
    assert.deepEqual(rawStore.writes, []);

    const disabledStore = createGlobalRawStore({ [KEY]: '{unreadable global' });
    const disabledPort = createPlayerRecordStorePort({
        profileId: 'fallback-disabled-test',
        globalRecordStore: disabledStore,
        allowLegacyFallback: () => false,
    });
    const disabledWarnings = quietly(() => loadVehicleProfiles(disabledPort)).warnings;
    assert.deepEqual(disabledStore.writes, []);
    assert.equal(disabledWarnings.length, 0);
});

test('an existing backup is never overwritten', () => {
    const store = createRawStore({ [KEY]: 'not json' });
    const backupKey = `${store.prefix}${KEY}${SUFFIX}`;
    store.raw.set(backupKey, '"earlier backup"');
    const { warnings } = quietly(() => loadVehicleProfiles(store));
    assert.equal(store.raw.get(backupKey), '"earlier backup"');
    assert.deepEqual(store.writes, []);
    assert.equal(warnings.length, 1, 'still warns that progress is not stored');
});

test('an unreadable legacy record and a non-object record are backed up as well', () => {
    const legacy = createRawStore({ [LEGACY_KEY]: '{oops' });
    quietly(() => loadVehicleProfiles(legacy));
    assert.equal(JSON.parse(legacy.raw.get(`${legacy.prefix}${LEGACY_KEY}${SUFFIX}`)).raw, '{oops');
    assert.equal(legacy.raw.get(`${legacy.prefix}${LEGACY_KEY}`), '{oops');

    const array = createRawStore({ [KEY]: '[1,2]' });
    quietly(() => loadVehicleProfiles(array));
    assert.equal(JSON.parse(array.raw.get(`${array.prefix}${KEY}${SUFFIX}`)).raw, '[1,2]');
    assert.equal(array.raw.get(`${array.prefix}${KEY}`), '[1,2]');
});

test('readable profiles never create a backup', () => {
    const store = createRawStore({ [KEY]: JSON.stringify({ ship5: createArcadeVehicleProfile('ship5', 0) }) });
    const { warnings } = quietly(() => loadVehicleProfiles(store));
    assert.equal(warnings.length, 0);
    assert.equal([...store.raw.keys()].some((key) => key.endsWith(SUFFIX)), false);
});

test('a store that throws while backing up does not break loading', () => {
    for (const failOn of ['save', 'read']) {
        const store = createRawStore({ [KEY]: '{broken' });
        const backupKey = `${store.prefix}${KEY}${SUFFIX}`;
        const read = store.readJsonRecordResult.bind(store);
        store.readJsonRecordResult = (key) => {
            if (failOn === 'read' && key === backupKey) throw new Error('read blew up');
            return read(key);
        };
        store.saveJsonRecord = () => { throw new Error('quota'); };
        const { value, warnings } = quietly(() => loadVehicleProfiles(store));
        assert.deepEqual(value, {}, `loading continues when the backup ${failOn} throws`);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /backup failed/);
        assert.equal(store.raw.get(`${store.prefix}${KEY}`), '{broken');
    }
});
