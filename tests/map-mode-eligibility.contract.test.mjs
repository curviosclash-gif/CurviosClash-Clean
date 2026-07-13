import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isMapEligibleForModePath,
    listEligibleMapKeysForModePath,
    resolveModePathFallbackMapKey,
} from '../src/shared/contracts/MapModeContract.js';

const MODE_PATHS = ['normal', 'fight', 'arcade', 'quick_action'];
const MAP_FIXTURES = Object.freeze({
    standard: Object.freeze({ name: 'Standard' }),
    maze: Object.freeze({ name: 'Maze' }),
    parcours_rift: Object.freeze({ name: 'Parcours Rift', parcours: Object.freeze({ enabled: true }) }),
    frozen_helix: Object.freeze({ name: 'Frozen Helix', parcours: Object.freeze({ enabled: true }) }),
    custom: Object.freeze({ name: 'Custom' }),
});

test('Map mode eligibility allows every map type for every mode path', () => {
    for (let modeIndex = 0; modeIndex < MODE_PATHS.length; modeIndex += 1) {
        const modePath = MODE_PATHS[modeIndex];
        for (const mapKey of Object.keys(MAP_FIXTURES)) {
            const mapDefinition = MAP_FIXTURES[mapKey];
            assert.equal(
                isMapEligibleForModePath(mapDefinition, modePath),
                true,
                `expected ${mapKey} to be eligible for ${modePath}`
            );
        }
    }
});

test('Eligible map key list keeps parcours + non-parcours keys for all mode paths', () => {
    for (let modeIndex = 0; modeIndex < MODE_PATHS.length; modeIndex += 1) {
        const modePath = MODE_PATHS[modeIndex];
        const eligible = listEligibleMapKeysForModePath(MAP_FIXTURES, modePath);
        assert.deepEqual(
            eligible,
            ['standard', 'maze', 'parcours_rift', 'frozen_helix'],
            `eligible map keys mismatch for modePath=${modePath}`
        );
    }
});

test('Mode fallback keeps currently selected map key independent from mode path', () => {
    assert.equal(
        resolveModePathFallbackMapKey(MAP_FIXTURES, 'normal', 'parcours_rift'),
        'parcours_rift'
    );
    assert.equal(
        resolveModePathFallbackMapKey(MAP_FIXTURES, 'arcade', 'standard'),
        'standard'
    );
});
