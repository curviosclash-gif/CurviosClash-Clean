import test from 'node:test';
import assert from 'node:assert/strict';
import { TuningPresetManager } from '../src/dev/tuning/TuningPresetManager.js';

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
    };
}

test('tuning preset manager stores only value deltas', () => {
    const manager = new TuningPresetManager({
        storage: createMemoryStorage(),
        now: () => 1700000000000,
    });
    const saveResult = manager.savePreset({
        name: 'Aggro',
        valuesByPath: {
            'PLAYER.SPEED': 22,
            'PLAYER.TURN_RATE': 8.5,
            'HUNT.MG.DAMAGE': 6,
        },
        defaultsByPath: {
            'PLAYER.SPEED': 20,
            'PLAYER.TURN_RATE': 8.5,
            'HUNT.MG.DAMAGE': 4,
        },
    });
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.changedCount, 2);
    assert.deepEqual(saveResult.preset.delta, {
        'PLAYER.SPEED': 22,
        'HUNT.MG.DAMAGE': 6,
    });
});

test('tuning preset manager applies all stored delta entries', async () => {
    const manager = new TuningPresetManager({
        storage: createMemoryStorage(),
        now: () => 1700000000000,
    });
    const saveResult = manager.savePreset({
        name: 'Load Test',
        valuesByPath: {
            'PLAYER.SPEED': 18,
            'PLAYER.TURN_RATE': 7.25,
        },
        defaultsByPath: {
            'PLAYER.SPEED': 20,
            'PLAYER.TURN_RATE': 8.0,
        },
    });
    const applied = [];
    const applyResult = await manager.applyPreset(saveResult.preset.id, async (path, value) => {
        applied.push([path, value]);
        return { ok: true };
    });
    assert.equal(applyResult.ok, true);
    assert.equal(applyResult.appliedCount, 2);
    assert.deepEqual(applied, [
        ['PLAYER.SPEED', 18],
        ['PLAYER.TURN_RATE', 7.25],
    ]);
});

test('tuning preset manager exports and imports preset documents', () => {
    const storageA = createMemoryStorage();
    const managerA = new TuningPresetManager({
        storage: storageA,
        now: () => 1700000000000,
    });
    const saveResult = managerA.savePreset({
        name: 'Roundtrip',
        valuesByPath: { 'PLAYER.SPEED': 24 },
        defaultsByPath: { 'PLAYER.SPEED': 20 },
    });

    const exportResult = managerA.createExportDocument(saveResult.preset.id);
    assert.equal(exportResult.ok, true);

    const managerB = new TuningPresetManager({
        storage: createMemoryStorage(),
        now: () => 1700001000000,
    });
    const importResult = managerB.importPresetDocument(exportResult.document);
    assert.equal(importResult.ok, true);

    const importedPreset = managerB.getPreset(importResult.preset.id);
    assert.equal(importedPreset.name, 'Roundtrip');
    assert.deepEqual(importedPreset.delta, { 'PLAYER.SPEED': 24 });
});
