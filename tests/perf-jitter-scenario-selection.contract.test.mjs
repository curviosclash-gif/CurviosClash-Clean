import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBenchmarkScenarios } from '../scripts/perf-jitter-scenario-selection.mjs';

test('jitter benchmark filters the full matrix before limiting scenarios', () => {
    const matrix = [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
        { id: 'D' },
        { id: 'H-FIGHT-DUEL' },
    ];

    assert.deepEqual(
        selectBenchmarkScenarios(matrix, ['H-FIGHT-DUEL'], 4),
        [{ id: 'H-FIGHT-DUEL' }],
    );
    assert.deepEqual(selectBenchmarkScenarios(matrix, ['MISSING'], 4), []);
});
