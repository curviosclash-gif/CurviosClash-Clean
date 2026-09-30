import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import {
    isMapEligibleForModePath,
    listEligibleMapKeysForModePath,
    listMapExcludedGameModes,
    resolveModePathFallbackMapKey,
} from '../src/shared/contracts/MapModeContract.js';
import { resolveSurfaceMenuState } from '../src/shared/contracts/PlatformSurfacePolicyOps.js';

const MAPS = CONFIG.MAPS;

function resolveStartMapKey(mapKey, modePath, gameMode) {
    // Desktop is the lead platform; the browser demo would narrow the maps to its curated list.
    return resolveSurfaceMenuState(
        { mapKey, gameMode, localSettings: { modePath } },
        { maps: MAPS, productSurfaceId: 'desktop-app' }
    ).mapKey;
}

test('excludedModes keeps known game modes only, upper-cased and unique', () => {
    assert.deepEqual(
        listMapExcludedGameModes({ excludedModes: ['classic', 'bogus', 42, 'HUNT', 'Hunt', null] }),
        ['CLASSIC', 'HUNT']
    );
    assert.deepEqual(listMapExcludedGameModes({ excludedModes: 'CLASSIC' }), []);
    assert.deepEqual(listMapExcludedGameModes({ name: 'No field' }), []);
    assert.deepEqual(listMapExcludedGameModes(null), []);
});

test('dandelion_sky is not selectable in CLASSIC but in HUNT and ARCADE', () => {
    const dandelion = MAPS.dandelion_sky;
    assert.ok(dandelion, 'dandelion_sky must be part of CONFIG.MAPS');
    assert.deepEqual(listMapExcludedGameModes(dandelion), ['CLASSIC']);

    assert.equal(isMapEligibleForModePath(dandelion, 'normal'), false);
    assert.equal(isMapEligibleForModePath(dandelion, 'fight'), true);
    assert.equal(isMapEligibleForModePath(dandelion, 'arcade'), true);
    // Quick start keeps whatever game mode is set, so the caller has to name it.
    assert.equal(isMapEligibleForModePath(dandelion, 'quick_action', 'CLASSIC'), false);
    assert.equal(isMapEligibleForModePath(dandelion, 'quick_action', 'HUNT'), true);

    assert.equal(listEligibleMapKeysForModePath(MAPS, 'normal').includes('dandelion_sky'), false);
    assert.equal(listEligibleMapKeysForModePath(MAPS, 'fight').includes('dandelion_sky'), true);
    assert.equal(listEligibleMapKeysForModePath(MAPS, 'arcade').includes('dandelion_sky'), true);
    assert.equal(
        listEligibleMapKeysForModePath(MAPS, 'quick_action', { gameMode: 'CLASSIC' }).includes('dandelion_sky'),
        false
    );
});

test('a stored dandelion_sky falls back to the standard map when CLASSIC starts', () => {
    assert.equal(resolveStartMapKey('dandelion_sky', 'normal', 'CLASSIC'), 'standard');
    assert.equal(resolveStartMapKey('dandelion_sky', 'quick_action', 'CLASSIC'), 'standard');
    assert.equal(resolveModePathFallbackMapKey(MAPS, 'normal', 'dandelion_sky'), 'standard');

    assert.equal(resolveStartMapKey('dandelion_sky', 'fight', 'HUNT'), 'dandelion_sky');
    assert.equal(resolveStartMapKey('dandelion_sky', 'arcade', 'ARCADE'), 'dandelion_sky');
    assert.equal(resolveModePathFallbackMapKey(MAPS, 'fight', 'dandelion_sky'), 'dandelion_sky');
});

test('maps without excludedModes stay selectable in every mode', () => {
    const modePaths = ['normal', 'fight', 'arcade', 'quick_action'];
    for (const [mapKey, definition] of Object.entries(MAPS)) {
        if (listMapExcludedGameModes(definition).length > 0) continue;
        for (const modePath of modePaths) {
            assert.equal(
                isMapEligibleForModePath(definition, modePath, 'CLASSIC'),
                true,
                `${mapKey} must stay eligible for ${modePath}`
            );
        }
    }
    assert.equal(resolveStartMapKey('maze', 'normal', 'CLASSIC'), 'maze');
});
