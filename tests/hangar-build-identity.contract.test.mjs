import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultHangarBuild } from '../src/ui/hangar/HangarBuildDraftState.js';
import {
    HANGAR_BUILD_STORAGE_KEYS,
    createHangarBuildPersistenceAdapter,
} from '../src/ui/hangar/HangarBuildPersistence.js';

function createStore() {
    const records = new Map();
    return {
        records,
        loadJsonRecord(key, fallback) {
            return records.has(key) ? structuredClone(records.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            records.set(key, structuredClone(value));
            return { success: true };
        },
    };
}

for (const mode of ['arcade', 'fight']) {
    test(`${mode} hangar keeps same-name save-as, duplicate and import builds created in one millisecond`, async () => {
        const store = createStore();
        const adapter = createHangarBuildPersistenceAdapter({ store, mode });
        const source = createDefaultHangarBuild('ship5', {
            buildId: `${mode}-source`,
            mode,
            name: 'Twin',
            nowMs: 10,
        });
        assert.equal((await adapter.saveBuild(source)).ok, true);

        const originalNow = Date.now;
        Date.now = () => 1_234_567;
        try {
            const savedAs = await adapter.saveBuild(source, { asNew: true, name: 'Twin' });
            const duplicate = await adapter.duplicateBuild(source, 'Twin');
            const imported = await adapter.importBuilds({ builds: [source, source] });

            assert.equal(savedAs.ok, true);
            assert.equal(duplicate.ok, true);
            assert.equal(imported.ok, true);
            assert.equal(imported.builds.length, 2);

            const generatedIds = [
                savedAs.build.buildId,
                duplicate.build.buildId,
                ...imported.builds.map((build) => build.buildId),
            ];
            assert.equal(new Set(generatedIds).size, generatedIds.length);
            assert.equal(adapter.listBuilds('ship5').length, 5);
            assert.equal(store.records.get(HANGAR_BUILD_STORAGE_KEYS[mode]).builds.length, 5);
        } finally {
            Date.now = originalNow;
        }
    });
}
