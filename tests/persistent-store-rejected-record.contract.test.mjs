import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuPresetStore } from '../src/ui/menu/MenuPresetStore.js';
import { loadVersionedRecord } from '../src/shared/storage/PersistentStoreLoadUtils.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: (key) => { values.delete(key); },
    };
}

test('presets saved by a newer app version are backed up before defaults take over', () => {
    const newerRecord = JSON.stringify({
        schemaVersion: 'menu-preset-store.v2',
        presets: [{ id: 'my-newer-preset', name: 'From the future' }],
    });
    const storage = createMemoryStorage({ 'test.presets': newerRecord });
    const store = new MenuPresetStore({ storage, storageKey: 'test.presets', storageLegacyKeys: [] });

    assert.deepEqual(store._loadPersistedPresets(), [], 'this build cannot read v2 and falls back to defaults');
    store._savePersistedPresets([]);

    assert.equal(storage.getItem('test.presets.rejected'), newerRecord, 'the unreadable record survives the next save');
});

test('the versioned loader reports rejected records before returning the default', () => {
    const rejected = [];
    const value = loadVersionedRecord(() => ({ schemaVersion: 'other.v9', data: 1 }), {
        artifactType: 'test-store',
        schemaVersion: 'test-store.v1',
        createDefault: () => 'default',
        transform: () => 'transformed',
        onReject: (record) => rejected.push(record),
    });
    assert.equal(value, 'default');
    assert.deepEqual(rejected, [{ schemaVersion: 'other.v9', data: 1 }]);
});
