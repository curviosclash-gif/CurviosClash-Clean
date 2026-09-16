import assert from 'node:assert/strict';
import test from 'node:test';

import { HEURISTIC_PROFILE_FIELD_BOUNDS } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { HEURISTIC_IMPROVEMENT_BASELINE } from '../scripts/heuristic-improvement-baseline.mjs';

test('fixed benchmark opponents retain every original profile field', () => {
    assert.deepEqual(Object.keys(HEURISTIC_IMPROVEMENT_BASELINE), ['defensive', 'balanced', 'aggressive']);
    for (const profile of Object.values(HEURISTIC_IMPROVEMENT_BASELINE)) {
        assert.deepEqual(Object.keys(profile).sort(), Object.keys(HEURISTIC_PROFILE_FIELD_BOUNDS).sort());
        for (const [field, [minimum, maximum]] of Object.entries(HEURISTIC_PROFILE_FIELD_BOUNDS)) {
            assert.ok(profile[field] >= minimum && profile[field] <= maximum, field);
        }
    }
    assert.equal(HEURISTIC_IMPROVEMENT_BASELINE.defensive.retreatVitality, 0.54);
    assert.equal(HEURISTIC_IMPROVEMENT_BASELINE.balanced.attackWindow, 0.72);
    assert.equal(HEURISTIC_IMPROVEMENT_BASELINE.aggressive.safetyDistance, 0.18);
});
