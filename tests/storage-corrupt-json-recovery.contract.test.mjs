import assert from 'node:assert/strict';
import test from 'node:test';
import { StoragePlatform } from '../src/shared/storage/StoragePlatform.js';
import { MenuPresetStore } from '../src/ui/menu/MenuPresetStore.js';

function memoryStorage(initial = {}, faults = {}) {
    const records = new Map(Object.entries(initial));
    const writes = [], removals = [];
    return {
        records, writes, removals,
        getItem(key) {
            if (faults.read?.(key)) throw Error('read blocked');
            return records.get(key) ?? null;
        },
        setItem(key, value) {
            writes.push(key);
            if (faults.quota?.(key)) { const error = Error('quota exceeded'); error.name = 'QuotaExceededError'; throw error; }
            if (!faults.drop?.(key)) records.set(key, faults.alter?.(key) ? 'different bytes' : String(value));
        },
        removeItem(key) { removals.push(key); records.delete(key); },
    };
}

test('invalid primary JSON survives fallback loading and a later default save byte for byte', () => {
    const raw = '\n {broken\r\n';
    const storage = memoryStorage({ record: raw });
    const platform = new StoragePlatform({ storage });
    assert.deepEqual(platform.readJson('record', [], {}), {});
    assert.equal(storage.records.get('record'), raw);
    assert.equal(storage.records.get('record.corrupt'), raw);
    assert.equal(platform.writeJson('record', {}).ok, true);
    assert.equal(storage.records.get('record'), '{}');
    assert.equal(storage.records.get('record.corrupt'), raw);
});

test('saving without an earlier read preserves the actual overwritten key', () => {
    const storage = memoryStorage({ ' spaced ': '{bad' });
    const platform = new StoragePlatform({ storage });
    assert.equal(platform.writeJson(' spaced ', { value: 1 }).ok, true);
    assert.equal(storage.records.get(' spaced .corrupt'), '{bad');
    assert.equal(storage.records.get(' spaced '), '{"value":1}');
});

test('distinct backups remain intact and repeated reads reuse an identical backup', () => {
    const storage = memoryStorage({ record: '{new bad', 'record.corrupt': '{old bad', 'record.corrupt.1': '' });
    const platform = new StoragePlatform({ storage });
    platform.readJson('record'); platform.readJson('record');
    assert.equal(storage.records.get('record.corrupt'), '{old bad');
    assert.equal(storage.records.get('record.corrupt.1'), '');
    assert.equal(storage.records.get('record.corrupt.2'), '{new bad');
    assert.equal(storage.records.has('record.corrupt.3'), false);
    assert.deepEqual(storage.writes, ['record.corrupt.2']);
});

test('corrupt primary and legacy bytes are preserved before migrating the first valid legacy value', () => {
    const storage = memoryStorage({ record: '{primary', old: '{legacy', older: '{"pilot":7}' });
    const platform = new StoragePlatform({ storage });
    assert.deepEqual(platform.readJson(' record ', ['old', 'old', 'older']), { pilot: 7 });
    assert.equal(storage.records.get('record.corrupt'), '{primary');
    assert.equal(storage.records.get('record.corrupt.1'), '{legacy');
    assert.equal(storage.records.get('old'), '{legacy');
    assert.equal(storage.records.get('record'), '{"pilot":7}');
    assert.equal(storage.records.has('older'), false);
    assert.equal(platform.getLastMigrationResult('record').status, 'migrated');
});

test('a failed corrupt backup allows a legacy read but blocks migration and later overwrite', () => {
    const storage = memoryStorage({ record: '{bad', old: '{"pilot":7}' }, { quota: key => key.endsWith('.corrupt') });
    const warnings = [];
    const platform = new StoragePlatform({ storage, onQuotaExceeded: value => warnings.push(value) });
    assert.deepEqual(platform.readJson('record', ['old']), { pilot: 7 });
    const save = platform.writeJson('record', {});
    assert.equal(save.ok, false); assert.equal(save.quotaExceeded, true);
    assert.equal(storage.records.get('record'), '{bad');
    assert.equal(storage.records.get('old'), '{"pilot":7}');
    assert.deepEqual(storage.removals, []);
    assert.ok(warnings.some(value => value.quotaExceeded));
});

test('backup success must include an exact readback before replacing corrupt data', () => {
    const storage = memoryStorage({ record: '{bad' }, { alter: key => key.endsWith('.corrupt') });
    const platform = new StoragePlatform({ storage });
    assert.equal(platform.writeJson('record', {}).ok, false);
    assert.equal(storage.records.get('record'), '{bad');
});

test('an unreadable backup slot blocks both migration and direct overwrite without reporting quota', () => {
    for (const primary of ['{bad', null]) {
        const initial = { badLegacy: '{bad legacy', old: '{"pilot":7}', 'record.corrupt': 'previous recovery' };
        if (primary !== null) initial.record = primary;
        const storage = memoryStorage(initial, { read: key => key === 'record.corrupt' });
        const platform = new StoragePlatform({ storage });
        assert.deepEqual(platform.readJson('record', ['badLegacy', 'old']), { pilot: 7 });
        assert.equal(storage.records.get('record') ?? null, primary);
        assert.equal(storage.records.get('old'), '{"pilot":7}');
        assert.deepEqual(storage.removals, []);
        if (primary !== null) {
            const save = platform.writeJson('record', {});
            assert.equal(save.ok, false); assert.equal(save.quotaExceeded, false);
            assert.equal(save.reason, 'read blocked');
            assert.equal(storage.records.get('record'), primary);
        }
        assert.deepEqual(storage.writes, []);
    }
});

test('an unreadable primary is not overwritten or migrated from a readable legacy key', () => {
    const storage = memoryStorage({ record: '{"keep":1}', old: '{"pilot":7}' }, { read: key => key === 'record' });
    const platform = new StoragePlatform({ storage });
    assert.deepEqual(platform.readJson('record', ['old']), { pilot: 7 });
    assert.equal(platform.writeJson('record', {}).ok, false);
    assert.equal(storage.records.get('record'), '{"keep":1}');
    assert.equal(storage.records.get('old'), '{"pilot":7}');
    assert.deepEqual(storage.writes, []); assert.deepEqual(storage.removals, []);
});

test('invalid-only legacy data is preserved without promoting it to the primary key', () => {
    const storage = memoryStorage({ old: '{bad' });
    const platform = new StoragePlatform({ storage });
    assert.equal(platform.readJson('record', ['old'], 'fallback'), 'fallback');
    assert.equal(storage.records.has('record'), false);
    assert.equal(storage.records.get('record.corrupt'), '{bad');
    assert.equal(storage.records.get('old'), '{bad');
});

test('a migration cannot delete its legacy source when the primary write silently fails or changes bytes', () => {
    for (const faults of [{ drop: key => key === 'record' }, { alter: key => key === 'record' }]) {
        const storage = memoryStorage({ old: '{"pilot":7}' }, faults);
        const platform = new StoragePlatform({ storage });
        assert.deepEqual(platform.readJson('record', ['old']), { pilot: 7 });
        assert.equal(storage.records.get('old'), '{"pilot":7}');
        assert.deepEqual(storage.removals, []);
        assert.equal(platform.getLastMigrationResult('record').ok, false);
    }
});

test('valid JSON primitives retain their value and do not create recovery records', () => {
    for (const raw of ['null', 'false', '0', '""']) {
        const storage = memoryStorage({ record: raw });
        const platform = new StoragePlatform({ storage });
        assert.deepEqual(platform.readJson('record', [], 'fallback'), JSON.parse(raw));
        assert.equal(storage.records.size, 1);
    }
});

test('raw APIs remain explicit and serialization errors do not touch storage', () => {
    const storage = memoryStorage({ record: '{bad' });
    const platform = new StoragePlatform({ storage });
    const cyclic = {}; cyclic.self = cyclic;
    assert.equal(platform.writeJson('record', cyclic).reason, 'serialize_failed');
    assert.deepEqual(storage.writes, []);
    assert.equal(platform.readRaw('record').raw, '{bad');
    assert.equal(platform.writeRaw('raw', '{raw').ok, true);
    assert.equal(storage.records.get('raw'), '{raw');
});

test('the real menu preset store preserves malformed JSON when its next save writes defaults', () => {
    const storage = memoryStorage({ presets: '{broken presets' });
    const store = new MenuPresetStore({ storage, storageKey: 'presets', storageLegacyKeys: [] });
    assert.deepEqual(store._loadPersistedPresets(), []);
    store._savePersistedPresets([]);
    assert.equal(storage.records.get('presets.corrupt'), '{broken presets');
    assert.ok(JSON.parse(storage.records.get('presets')));
});

test('an empty primary string is skipped like a missing key so a valid legacy value migrates without a backup', () => {
    const storage = memoryStorage({ record: '', old: '{"pilot":7}' });
    const platform = new StoragePlatform({ storage });
    assert.deepEqual(platform.readJson('record', ['old']), { pilot: 7 });
    assert.equal(storage.records.has('record.corrupt'), false, 'an empty string has nothing worth rescuing');
    assert.equal(storage.records.get('record'), '{"pilot":7}');
    assert.equal(platform.getLastMigrationResult('record').status, 'migrated');
});

test('a full storage does not block replacing an empty primary string', () => {
    const storage = memoryStorage({ record: '' }, { quota: key => key.endsWith('.corrupt') });
    const platform = new StoragePlatform({ storage });
    assert.equal(platform.readJson('record', [], 'fallback'), 'fallback');
    assert.equal(platform.writeJson('record', { value: 1 }).ok, true, 'no backup is needed before overwriting an empty string');
    assert.equal(storage.records.get('record'), '{"value":1}');
    assert.equal(storage.records.has('record.corrupt'), false);
});