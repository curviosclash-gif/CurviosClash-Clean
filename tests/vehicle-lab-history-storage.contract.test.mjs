import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { persistVehicleLabConfig } from '../prototypes/vehicle-lab/src/VehicleLabPersistence.js';
import { VehicleHistory } from '../prototypes/vehicle-lab/src/VehicleHistory.js';

const VEHICLE_LAB_SOURCE = readFileSync(
    new URL('../prototypes/vehicle-lab/main.js', import.meta.url),
    'utf8'
);

function readMethodBody(source, methodName) {
    const signatureIndex = source.indexOf(`\n    ${methodName}(`);
    assert.notEqual(signatureIndex, -1, `main.js must define ${methodName}()`);
    const bodyStart = source.indexOf('{', signatureIndex);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(bodyStart, index + 1);
        }
    }
    throw new Error(`${methodName}() body is not balanced`);
}

function throwingStorage() {
    return { setItem() { throw new Error('quota exceeded'); } };
}

test('undo and redo keep the VehicleHistory branch and report storage errors', () => {
    const first = { parts: [{ id: 'base' }] };
    const second = { parts: [{ id: 'base' }, { id: 'wing' }] };
    const history = new VehicleHistory(first);
    history.save(second);

    const undoConfig = history.undo();
    const undoState = history.getState();
    const undoStatuses = [];
    const undoOk = persistVehicleLabConfig({
        config: undoConfig,
        history,
        storage: throwingStorage(),
        storageKey: 'vehicle_lab_config',
        saveHistory: false,
        statusMessage: 'Undo angewendet.',
        statusTone: 'info',
        onSaveState: (...args) => undoStatuses.push(['save', ...args]),
        onStatus: (...args) => undoStatuses.push(['status', ...args]),
        onError: (error) => undoStatuses.push(['error', error.message]),
    });

    assert.equal(undoOk, false);
    assert.deepEqual(history.getState(), undoState);
    assert.equal(history.canRedo(), true);
    assert.deepEqual(undoStatuses, [
        ['error', 'quota exceeded'],
        ['save', 'error', 'Speichern fehlgeschlagen'],
        ['status', 'Lokales Speichern fehlgeschlagen: quota exceeded', 'error'],
    ]);

    const redoConfig = history.redo();
    const redoState = history.getState();
    const redoStatuses = [];
    const redoOk = persistVehicleLabConfig({
        config: redoConfig,
        history,
        storage: throwingStorage(),
        storageKey: 'vehicle_lab_config',
        saveHistory: false,
        statusMessage: 'Redo angewendet.',
        statusTone: 'info',
        onSaveState: (...args) => redoStatuses.push(['save', ...args]),
        onStatus: (...args) => redoStatuses.push(['status', ...args]),
        onError: (error) => redoStatuses.push(['error', error.message]),
    });

    assert.equal(redoOk, false);
    assert.deepEqual(history.getState(), redoState);
    assert.equal(history.canUndo(), true);
    assert.deepEqual(redoStatuses, [
        ['error', 'quota exceeded'],
        ['save', 'error', 'Speichern fehlgeschlagen'],
        ['status', 'Lokales Speichern fehlgeschlagen: quota exceeded', 'error'],
    ]);
});

test('normal persistence still records history by default', () => {
    const history = new VehicleHistory({ parts: [{ id: 'base' }] });
    const next = { parts: [{ id: 'base' }, { id: 'engine' }] };
    const writes = [];

    assert.equal(persistVehicleLabConfig({
        config: next,
        history,
        storage: { setItem: (...args) => writes.push(args) },
        storageKey: 'vehicle_lab_config',
    }), true);

    assert.equal(history.canUndo(), true);
    assert.equal(history.getState().index, 1);
    assert.deepEqual(writes, [['vehicle_lab_config', JSON.stringify(next)]]);
});

test('undo and redo refresh selection and UI after the shared guarded persistence path', () => {
    for (const methodName of ['undo', 'redo']) {
        const body = readMethodBody(VEHICLE_LAB_SOURCE, methodName);
        const persistIndex = body.indexOf('this.persistCurrentConfig(');
        const clearSelectionIndex = body.indexOf('this.selectPart(null)');
        const updateUiIndex = body.indexOf('this.updateUI()');

        assert.match(body, /saveHistory:\s*false/);
        assert.notEqual(persistIndex, -1);
        assert.ok(persistIndex < clearSelectionIndex, `${methodName} must clear the selection after saving`);
        assert.ok(clearSelectionIndex < updateUiIndex, `${methodName} must refresh the UI after clearing selection`);
    }
});
