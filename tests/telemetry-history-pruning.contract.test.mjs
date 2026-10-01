// Belegt, dass Testserien und unbediente Fenster echte Runden nicht aus der
// Rundenhistorie draengen. Eine einzige Serie von 61 automatischen Runden
// schob bisher genauso viele echte Runden aus dem Speicher.

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTelemetryPruneIds } from '../src/state/telemetry/TelemetryHistoryPruning.js';

function rows(sources) {
    return sources.map((source, index) => ({ id: index + 1, control: source ? { source } : undefined }));
}

test('machine rounds keep their own small budget and leave real rounds alone', () => {
    const history = rows([
        ...Array.from({ length: 5 }, () => 'human'),
        ...Array.from({ length: 8 }, () => 'automation'),
        ...Array.from({ length: 2 }, () => 'idle'),
    ]);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 50, maxMachineEntries: 4, pruneBatch: 2 });
    // Zehn Maschinenrunden, vier duerfen bleiben: die sechs aeltesten fallen weg.
    assert.deepEqual(dropped, [6, 7, 8, 9, 10, 11]);
});

test('the overall limit removes machine rounds before any real round', () => {
    const history = rows(['human', 'automation', 'human', 'idle', 'human', 'human']);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 4, maxMachineEntries: 10, pruneBatch: 0 });
    assert.deepEqual(dropped, [2, 4]);
});

test('without machine rounds the oldest real rounds go first, as before', () => {
    const history = rows(['human', undefined, 'human', 'human', 'human']);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 3, maxMachineEntries: 10, pruneBatch: 1 });
    // Altdaten ohne Steuerungsblock zaehlen als echte Runden, nie als Maschine.
    assert.deepEqual(dropped, [1, 2, 3]);
});

test('nothing is dropped while every budget holds', () => {
    const history = rows(['human', 'automation', 'idle']);
    assert.deepEqual(selectTelemetryPruneIds(history, { maxEntries: 10, maxMachineEntries: 5, pruneBatch: 2 }), []);
    assert.deepEqual(selectTelemetryPruneIds([], {}), []);
});
