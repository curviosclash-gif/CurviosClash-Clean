import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ROUND_HEATMAP_CELL_SIZE,
    heatmapCellBounds,
    heatmapCellCenter,
    heatmapKindFromEventType,
    mergeHeatmapCells,
    normalizeHeatmapCells,
    normalizeHeatmapKind,
    summarizeHeatmapCells,
    toHeatmapCellIndex,
    toHeatmapCellKey,
} from '../src/shared/contracts/RoundHeatmapContract.js';
import { RoundHeatmapStore } from '../src/state/recorder/RoundHeatmapStore.js';
import { RoundRecorder } from '../src/state/RoundRecorder.js';

test('heatmap kinds only accept the spatially evaluated event types', () => {
    assert.equal(heatmapKindFromEventType('STUCK'), 'stuck');
    assert.equal(heatmapKindFromEventType('bounce_wall'), 'bounce_wall');
    assert.equal(heatmapKindFromEventType(' BOUNCE_TRAIL '), 'bounce_trail');
    assert.equal(heatmapKindFromEventType('KILL'), 'kill');
    assert.equal(heatmapKindFromEventType('ITEM_USE'), '');
    assert.equal(heatmapKindFromEventType(null), '');

    assert.equal(normalizeHeatmapKind('STUCK'), 'stuck');
    assert.equal(normalizeHeatmapKind('spawn'), '');
});

test('world coordinates map onto a stable grid in both directions', () => {
    assert.equal(toHeatmapCellIndex(0), 0);
    assert.equal(toHeatmapCellIndex(ROUND_HEATMAP_CELL_SIZE - 0.001), 0);
    assert.equal(toHeatmapCellIndex(ROUND_HEATMAP_CELL_SIZE), 1);
    assert.equal(toHeatmapCellIndex(-1), -1);
    assert.equal(toHeatmapCellIndex(-ROUND_HEATMAP_CELL_SIZE), -1);

    assert.equal(heatmapCellCenter(0), ROUND_HEATMAP_CELL_SIZE / 2);
    assert.equal(heatmapCellCenter(-1), -ROUND_HEATMAP_CELL_SIZE / 2);
    assert.equal(toHeatmapCellKey({ kind: 'stuck', cx: 2, cz: -3, count: 1 }), 'stuck|2|-3');
});

test('normalizing merges duplicate cells, drops garbage and keeps the strongest', () => {
    const cells = normalizeHeatmapCells([
        { kind: 'stuck', cx: 1, cz: 1, count: 2 },
        { kind: 'stuck', cx: 1, cz: 1, count: 3 },
        { kind: 'kill', cx: 0, cz: 0, count: 9 },
        { kind: 'nonsense', cx: 0, cz: 0, count: 4 },
        { kind: 'stuck', cx: Number.NaN, cz: 0, count: 4 },
        { kind: 'stuck', cx: 0, cz: 0, count: 0 },
        null,
        'not-a-cell',
    ]);

    assert.deepEqual(cells, [
        { kind: 'kill', cx: 0, cz: 0, count: 9 },
        { kind: 'stuck', cx: 1, cz: 1, count: 5 },
    ]);
    assert.deepEqual(normalizeHeatmapCells('not-an-array'), []);
});

test('normalizing caps to the strongest cells', () => {
    const source = [
        { kind: 'stuck', cx: 0, cz: 0, count: 1 },
        { kind: 'stuck', cx: 1, cz: 0, count: 7 },
        { kind: 'stuck', cx: 2, cz: 0, count: 4 },
    ];
    assert.deepEqual(normalizeHeatmapCells(source, 2), [
        { kind: 'stuck', cx: 1, cz: 0, count: 7 },
        { kind: 'stuck', cx: 2, cz: 0, count: 4 },
    ]);
});

test('merging accumulates the same cell across rounds', () => {
    const first = [{ kind: 'stuck', cx: 4, cz: -2, count: 3 }];
    const second = [
        { kind: 'stuck', cx: 4, cz: -2, count: 2 },
        { kind: 'bounce_wall', cx: 4, cz: -2, count: 1 },
    ];
    assert.deepEqual(mergeHeatmapCells(first, second), [
        { kind: 'stuck', cx: 4, cz: -2, count: 5 },
        { kind: 'bounce_wall', cx: 4, cz: -2, count: 1 },
    ]);
    assert.deepEqual(mergeHeatmapCells(null, null), []);
});

test('summary reports totals per kind and the strongest cells', () => {
    const summary = summarizeHeatmapCells([
        { kind: 'stuck', cx: 0, cz: 0, count: 6 },
        { kind: 'stuck', cx: 1, cz: 0, count: 2 },
        { kind: 'kill', cx: 5, cz: 5, count: 3 },
    ], 2);

    assert.equal(summary.cellCount, 3);
    assert.equal(summary.totalSamples, 11);
    assert.deepEqual(summary.byKind, { stuck: 8, kill: 3 });
    assert.equal(summary.top.length, 2);
    assert.equal(summary.top[0].count, 6);
});

test('cell bounds span the covered world area', () => {
    assert.equal(heatmapCellBounds([]), null);
    assert.deepEqual(heatmapCellBounds([
        { kind: 'stuck', cx: -1, cz: 0, count: 1 },
        { kind: 'kill', cx: 2, cz: 3, count: 1 },
    ]), {
        minX: -ROUND_HEATMAP_CELL_SIZE,
        maxX: 3 * ROUND_HEATMAP_CELL_SIZE,
        minZ: 0,
        maxZ: 4 * ROUND_HEATMAP_CELL_SIZE,
    });
});

test('RoundHeatmapStore buckets samples and ignores what it cannot place', () => {
    const store = new RoundHeatmapStore();

    assert.equal(store.addEventSample('STUCK', { x: 12, z: 12 }), true);
    assert.equal(store.addEventSample('STUCK', { x: 15, z: 19 }), true);
    assert.equal(store.addEventSample('KILL', { x: 12, z: 12 }), true);
    assert.equal(store.addEventSample('ITEM_USE', { x: 12, z: 12 }), false);
    assert.equal(store.addEventSample('STUCK', { x: Number.NaN, z: 1 }), false);
    assert.equal(store.addEventSample('STUCK', null), false);

    assert.deepEqual(store.toCells(), [
        { kind: 'stuck', cx: 1, cz: 1, count: 2 },
        { kind: 'kill', cx: 1, cz: 1, count: 1 },
    ]);

    store.reset();
    assert.equal(store.isEmpty(), true);
    assert.deepEqual(store.toCells(), []);
});

test('RoundHeatmapStore stops opening new cells once the live budget is spent', () => {
    const store = new RoundHeatmapStore({ maxCells: 1 });
    const liveBudget = store.maxLiveCells;

    for (let index = 0; index < liveBudget; index++) {
        assert.equal(store.addEventSample('STUCK', { x: index * ROUND_HEATMAP_CELL_SIZE, z: 0 }), true);
    }
    assert.equal(store.addEventSample('STUCK', { x: liveBudget * ROUND_HEATMAP_CELL_SIZE, z: 0 }), false);
    assert.equal(store.getDroppedSampleCount(), 1);
    // Bereits belegte Zellen zaehlen weiter, auch wenn das Budget erschoepft ist.
    assert.equal(store.addEventSample('STUCK', { x: 0, z: 0 }), true);
    assert.deepEqual(store.toCells(), [{ kind: 'stuck', cx: 0, cz: 0, count: 2 }]);
});

test('RoundRecorder carries the round heatmap into the round summary', () => {
    const recorder = new RoundRecorder();
    const human = { index: 0, isBot: false };
    const bot = { index: 1, isBot: true };

    recorder.startRound([human, bot]);
    recorder.logEvent('STUCK', 1, 'reason=NO_PROGRESS', { x: 31, z: -4 });
    recorder.logEvent('STUCK', 1, 'reason=NO_PROGRESS', { x: 35, z: -9 });
    recorder.logEvent('BOUNCE_WALL', 0, '', { x: 31, z: -4 });
    recorder.logEvent('ITEM_USE', 0, 'type=ROCKET ok=1', { x: 31, z: -4 });
    recorder.logEvent('SPAWN', 0, 'bot=0');

    assert.deepEqual(recorder.getRoundHeatmapCells(), [
        { kind: 'stuck', cx: 3, cz: -1, count: 2 },
        { kind: 'bounce_wall', cx: 3, cz: -1, count: 1 },
    ]);

    const summary = recorder.finalizeRound(human, [human, bot], { reason: 'ELIMINATION' });
    assert.equal(summary.stuckEvents, 2);
    assert.deepEqual(summary.heatmap, [
        { kind: 'stuck', cx: 3, cz: -1, count: 2 },
        { kind: 'bounce_wall', cx: 3, cz: -1, count: 1 },
    ]);
    assert.deepEqual(recorder.getLastRoundMetrics().heatmap, summary.heatmap);

    recorder.startRound([human, bot]);
    assert.deepEqual(recorder.getRoundHeatmapCells(), []);
});
