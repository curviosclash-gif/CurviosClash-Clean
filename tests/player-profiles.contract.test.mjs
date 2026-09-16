import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerProfileManager } from '../src/application/player-profile/PlayerProfileManager.js';
import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';
import { flushArcadePersistenceSavesResult } from '../src/core/arcade/ArcadeRunPersistenceOps.js';
import {
    PLAYER_PROFILE_MIGRATION_STORAGE_KEY,
    PLAYER_PROFILE_REGISTRY_STORAGE_KEY,
} from '../src/shared/contracts/PlayerProfileStorageContract.js';
import {
    normalizePlayerProfileRegistry,
    resolvePlayerProfileMultiplayerIdentity,
} from '../src/shared/contracts/PlayerProfileContract.js';

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRecordStore(seed = {}) {
    const records = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
    const failures = new Set();
    return {
        records,
        failures,
        readJsonRecordResult(key) {
            if (!records.has(key)) return { ok: true, status: 'missing', value: null, reason: 'missing' };
            return { ok: true, status: 'found', value: clone(records.get(key)), reason: 'ok' };
        },
        loadJsonRecord(key, fallback = null) { return records.has(key) ? clone(records.get(key)) : fallback; },
        saveJsonRecord(key, value) {
            if (failures.has(key)) return { success: false, reason: 'quota_exceeded' };
            records.set(key, clone(value));
            return { success: true, reason: 'ok' };
        },
        removeJsonRecord(key) { records.delete(key); return { success: true, reason: 'ok' }; },
    };
}

function createIds() {
    let value = 1;
    return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function createManager(store, ids = createIds()) {
    return new PlayerProfileManager({
        recordStore: store,
        createId: ids,
        now: () => '2026-08-17T12:00:00.000Z',
    });
}

test('player profile bootstrap copies legacy records without deleting their source', () => {
    const legacyKey = 'cuviosclash.arcade-run-profile.v1';
    const store = createRecordStore({ [legacyKey]: { bestScore: 42 } });
    const manager = createManager(store);
    const result = manager.bootstrap();
    assert.equal(result.ok, true);
    const active = manager.getActiveProfile();
    const scopedKey = manager.getActiveRecordStorePort().resolveStorageKey(legacyKey);
    assert.deepEqual(store.records.get(scopedKey), { bestScore: 42 });
    assert.deepEqual(store.records.get(legacyKey), { bestScore: 42 });
    assert.equal(store.records.get(PLAYER_PROFILE_MIGRATION_STORAGE_KEY).status, 'complete');
});

test('bound ports isolate profiles and never follow the active registry pointer', () => {
    const store = createRecordStore();
    const manager = createManager(store);
    assert.equal(manager.bootstrap().ok, true);
    const first = manager.getActiveProfile();
    const firstPort = manager.getActiveRecordStorePort();
    const second = manager.createProfile('Zweiter Spieler').profile;
    assert.equal(manager.setActiveProfile(second.id).ok, true);
    const secondPort = manager.getActiveRecordStorePort();
    firstPort.saveJsonRecord('cuviosclash.arcade-run-profile.v1', { score: 10 });
    secondPort.saveJsonRecord('cuviosclash.arcade-run-profile.v1', { score: 20 });
    assert.equal(firstPort.profileId, first.id);
    assert.deepEqual(firstPort.loadJsonRecord('cuviosclash.arcade-run-profile.v1'), { score: 10 });
    assert.deepEqual(secondPort.loadJsonRecord('cuviosclash.arcade-run-profile.v1'), { score: 20 });
});

test('resumed migration preserves a scoped record written before the retry', () => {
    const legacyKey = 'cuviosclash.arcade-run-profile.v1';
    const store = createRecordStore({ [legacyKey]: { score: 1 } });
    const ids = createIds();
    const firstManager = createManager(store, ids);
    const activeId = '00000000-0000-4000-8000-000000000001';
    const scopedKey = `cuviosclash.player.${activeId}.arcade-run-profile.v1`;
    store.failures.add(scopedKey);
    assert.equal(firstManager.bootstrap().ok, false);
    store.failures.delete(scopedKey);
    store.records.set(scopedKey, { score: 99 });
    const resumed = createManager(store, ids);
    assert.equal(resumed.bootstrap().ok, true);
    assert.deepEqual(store.records.get(scopedKey), { score: 99 });
    assert.equal(store.records.get(PLAYER_PROFILE_REGISTRY_STORAGE_KEY).activeProfileId, activeId);
});

test('profile export and staged import include only scoped records and create a new UUID', () => {
    const store = createRecordStore({
        'cuviosclash.settings.v1': { localSettings: { actorId: 'owner' } },
        'cuviosclash.multiplayer.peer.v1': 'secret-peer',
    });
    const manager = createManager(store);
    manager.bootstrap();
    const source = manager.getActiveProfile();
    manager.getActiveRecordStorePort().saveJsonRecord('cuviosclash.arcade-run-profile.v1', { score: 77 });
    const exported = manager.exportProfile(source.id);
    const json = JSON.stringify(exported.value);
    assert.equal(json.includes(source.id), false);
    assert.equal(json.includes('secret-peer'), false);
    assert.equal(json.includes('actorId'), false);
    const imported = manager.importProfile(json);
    assert.equal(imported.ok, true);
    assert.notEqual(imported.profile.id, source.id);
    assert.deepEqual(manager.getRecordStorePort(imported.profile.id).loadJsonRecord('cuviosclash.arcade-run-profile.v1'), { score: 77 });
});

test('structured arcade flush treats no pending work as success and reports partial failures', () => {
    const scheduler = new ArcadeRunPersistenceScheduler({ saveThrottleMs: 1000 });
    const emptyRuntime = { _persistenceScheduler: scheduler, _pendingGhostLibrarySave: null };
    assert.deepEqual(flushArcadePersistenceSavesResult(emptyRuntime), { ok: true, hadPending: false, failures: [] });
    scheduler._pendingSaves.set('broken', () => false);
    const failed = flushArcadePersistenceSavesResult(emptyRuntime);
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.failures, ['broken']);
    scheduler.dispose();
});

test('registry normalization keeps a valid UUID stable and resolves duplicate names', () => {
    const registry = normalizePlayerProfileRegistry({
        schemaVersion: 'player-profiles.v1',
        activeProfileId: '00000000-0000-4000-8000-000000000007',
        profiles: [
            { id: '00000000-0000-4000-8000-000000000007', displayName: ' Gunda ' },
            { id: '00000000-0000-4000-8000-000000000008', displayName: 'Gunda' },
        ],
    });
    assert.equal(registry.ok, true);
    assert.equal(registry.registry.activeProfileId, '00000000-0000-4000-8000-000000000007');
    assert.deepEqual(registry.registry.profiles.map((profile) => profile.displayName), ['Gunda', 'Gunda 2']);
});

test('profiles preserve their preferred settings profile and refuse to archive the last profile', () => {
    const manager = new PlayerProfileManager({
        recordStore: createRecordStore(),
        createId: createIds(),
        now: () => '2026-08-17T12:00:00.000Z',
        getPreferredSettingsProfileName: () => 'Standard',
    });
    assert.equal(manager.bootstrap().ok, true);
    const active = manager.getActiveProfile();
    assert.equal(active.preferredSettingsProfileName, 'Standard');
    assert.equal(manager.archiveProfile(active.id).reason, 'last_profile');
    assert.equal(manager.setPreferredSettingsProfile(active.id, 'Gamepad').ok, true);
    assert.equal(manager.getActiveProfile().preferredSettingsProfileName, 'Gamepad');
});

test('future export schemas are rejected before any profile data is written', () => {
    const store = createRecordStore();
    const manager = createManager(store);
    manager.bootstrap();
    const before = [...store.records.keys()];
    const result = manager.importProfile(JSON.stringify({
        exportVersion: 'player-profile-export.v99',
        schemaVersion: 'player-profiles.v99',
        profile: { displayName: 'Zukunft' },
        records: {},
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported_schema');
    assert.deepEqual([...store.records.keys()], before);
});

test('an unreadable registry is preserved instead of being replaced with an empty profile', () => {
    const store = createRecordStore();
    const originalRead = store.readJsonRecordResult;
    store.readJsonRecordResult = (key) => key === PLAYER_PROFILE_REGISTRY_STORAGE_KEY
        ? { ok: false, status: 'invalid', value: null, reason: 'invalid_json' }
        : originalRead.call(store, key);
    const manager = createManager(store);
    const result = manager.bootstrap();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_json');
    assert.equal(store.records.has(PLAYER_PROFILE_REGISTRY_STORAGE_KEY), false);
});

test('failed import rolls back records and leaves the registry unchanged', () => {
    const store = createRecordStore();
    const manager = createManager(store);
    manager.bootstrap();
    const source = manager.getActiveProfile();
    const exported = manager.exportProfile(source.id).value;
    exported.records = { arcadeRunProfile: { score: 4 }, arcadeSeed: { seed: 12 } };
    const importedId = '00000000-0000-4000-8000-000000000002';
    store.failures.add(`cuviosclash.player.${importedId}.arcade.seed.v1`);
    const result = manager.importProfile(JSON.stringify(exported));
    assert.equal(result.ok, false);
    assert.equal(manager.getProfiles().length, 1);
    assert.equal(store.records.has(`cuviosclash.player.${importedId}.arcade-run-profile.v1`), false);
});

test('multiplayer identity exposes profile UUID and name without changing access identity', () => {
    const accessIdentity = { actorId: 'expert-owner', isOwner: true };
    const identity = resolvePlayerProfileMultiplayerIdentity({
        id: '00000000-0000-4000-8000-000000000042',
        displayName: 'Gunda',
    }, accessIdentity.actorId);
    assert.deepEqual(identity, {
        profileId: '00000000-0000-4000-8000-000000000042',
        actorId: '00000000-0000-4000-8000-000000000042',
        displayName: 'Gunda',
    });
    assert.deepEqual(accessIdentity, { actorId: 'expert-owner', isOwner: true });
});

test('a profile created after the legacy migration starts empty', () => {
    const legacyKey = 'cuviosclash.arcade-run-profile.v1';
    const store = createRecordStore({ [legacyKey]: { bestScore: 42 } });
    const ids = createIds();
    const firstManager = createManager(store, ids);
    assert.equal(firstManager.bootstrap().ok, true);
    const migratedProfileId = firstManager.getActiveProfile().id;
    const second = firstManager.createProfile('Zweiter Spieler').profile;
    assert.equal(firstManager.setActiveProfile(second.id).ok, true);

    // Switching profiles reloads the page, so bootstrap() runs again.
    const reloaded = createManager(store, ids);
    assert.equal(reloaded.bootstrap().ok, true);
    assert.equal(reloaded.getActiveProfile().id, second.id);

    const secondPort = reloaded.getActiveRecordStorePort();
    assert.equal(store.records.has(secondPort.resolveStorageKey(legacyKey)), false);
    assert.equal(secondPort.loadJsonRecord(legacyKey), null);
    assert.equal(reloaded.getMigrationState().profileId, migratedProfileId);
});
