import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PICKER_META } from '../src/shared/maps/MapPickerMeta.js';
import {
    TIME_GOAL_FACTOR_BY_DIFFICULTY,
    idealTimeSeconds,
    parcoursTimeGoals,
} from './helpers/parcours-ideal-time.mjs';

// Pure parcours maps are the picker collection 'parcours'. Adventure maps with combat or collect
// goals (notre_dame, eclipse_foundry, kinetic_tide, ...) keep their own, longer time goals.
const TOLERANCE = 0.05;

function pureParcoursMaps() {
    return Object.entries(MAP_PRESET_CATALOG).filter(([mapKey, map]) =>
        MAP_PICKER_META[mapKey]?.collection === 'parcours'
        && map.parcours?.enabled === true
        && parcoursTimeGoals(map).length > 0);
}

test('every pure parcours time goal is the ideal time times the factor of its difficulty step', () => {
    const maps = pureParcoursMaps();
    assert.ok(maps.length >= 15, `only ${maps.length} parcours maps carry a time goal`);
    const failures = [];
    for (const [mapKey, map] of maps) {
        const factor = TIME_GOAL_FACTOR_BY_DIFFICULTY[MAP_PICKER_META[mapKey].difficulty];
        assert.ok(factor, `${mapKey} has no factor for its difficulty`);
        const expected = idealTimeSeconds(map) * factor;
        for (const goal of parcoursTimeGoals(map)) {
            if (Math.abs(goal - expected) > expected * TOLERANCE) {
                failures.push(`${mapKey}: goal ${goal}s, expected ${expected.toFixed(1)}s (ideal ${idealTimeSeconds(map).toFixed(1)}s x ${factor})`);
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('harder steps get tighter factors', () => {
    const f = TIME_GOAL_FACTOR_BY_DIFFICULTY;
    assert.ok(f[1] === f[2] && f[2] > f[3] && f[3] > f[4] && f[4] > f[5]);
});
