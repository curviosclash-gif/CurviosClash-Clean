import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_FREE_PLAY_VARIANT,
    FREE_PLAY_VARIANTS,
    deriveFreePlayVariant,
    isMapEligibleForFreePlayVariant,
    normalizeFreePlayMapMemory,
    normalizeFreePlayVariant,
    resolveFreePlayVariantSettings,
} from '../src/shared/contracts/FreePlayVariantContract.js';

test('free play offers exactly the five variants, free-for-all first', () => {
    assert.deepEqual([...FREE_PLAY_VARIANTS], ['ffa', 'team', 'flags', 'escort', 'classic']);
    assert.equal(DEFAULT_FREE_PLAY_VARIANT, 'ffa');
    assert.equal(normalizeFreePlayVariant(' FLAGS '), 'flags');
    assert.equal(normalizeFreePlayVariant('arcade'), 'ffa');
    assert.equal(normalizeFreePlayVariant(null, 'classic'), 'classic');
    assert.equal(normalizeFreePlayVariant(undefined, 'nonsense'), 'ffa');
});

test('each variant pins mode path, game mode and team setup', () => {
    assert.deepEqual(
        FREE_PLAY_VARIANTS.map((variant) => {
            const { modePath, gameMode, teamMode, teamObjective, forcesRespawn } = resolveFreePlayVariantSettings(variant);
            return [variant, modePath, gameMode, teamMode, teamObjective, forcesRespawn];
        }),
        [
            ['ffa', 'fight', 'HUNT', false, 'HUNT', false],
            ['team', 'fight', 'HUNT', true, 'HUNT', true],
            ['flags', 'fight', 'HUNT', true, 'FLAGS', true],
            ['escort', 'fight', 'HUNT', true, 'ESCORT', true],
            ['classic', 'normal', 'CLASSIC', false, 'HUNT', false],
        ],
    );
    assert.ok(Object.isFrozen(resolveFreePlayVariantSettings('team')));
});

test('the variant reads back from stored settings and round-trips', () => {
    for (const variant of FREE_PLAY_VARIANTS) {
        const pinned = resolveFreePlayVariantSettings(variant);
        const settings = {
            localSettings: { modePath: pinned.modePath },
            hunt: { teamMode: pinned.teamMode, teamObjective: pinned.teamObjective },
        };
        assert.equal(deriveFreePlayVariant(settings), variant);
    }
    assert.equal(deriveFreePlayVariant({ localSettings: { modePath: 'arcade' } }), null);
    assert.equal(deriveFreePlayVariant({ localSettings: { modePath: 'quick_action' } }), null);
    assert.equal(deriveFreePlayVariant({}), null);
    // Team mode without a readable objective is plain team play.
    assert.equal(deriveFreePlayVariant({ localSettings: { modePath: 'fight' }, hunt: { teamMode: true } }), 'team');
    assert.equal(deriveFreePlayVariant({ localSettings: { modePath: 'fight' }, gameMode: 'ESCORT' }), 'escort');
});

test('map eligibility follows the authored exclusions of the variant game modes', () => {
    const noClassic = { excludedModes: ['CLASSIC'] };
    const noEscort = { excludedModes: ['escort'] };
    const noHunt = { excludedModes: ['HUNT'] };
    assert.equal(isMapEligibleForFreePlayVariant(noClassic, 'classic'), false);
    assert.equal(isMapEligibleForFreePlayVariant(noClassic, 'ffa'), true);
    assert.equal(isMapEligibleForFreePlayVariant(noEscort, 'escort'), false);
    assert.equal(isMapEligibleForFreePlayVariant(noEscort, 'flags'), true);
    assert.equal(isMapEligibleForFreePlayVariant(noHunt, 'escort'), false);
    assert.equal(isMapEligibleForFreePlayVariant(noHunt, 'classic'), true);
    assert.equal(isMapEligibleForFreePlayVariant({}, 'team'), true);
    assert.equal(isMapEligibleForFreePlayVariant(null, 'team'), false);
});

test('the per-variant map memory keeps only known variants with a map key', () => {
    assert.deepEqual(
        { ...normalizeFreePlayMapMemory({ ffa: ' standard ', classic: '', arcade: 'parcours_rift', flags: 7 }) },
        { ffa: 'standard' },
    );
    assert.deepEqual({ ...normalizeFreePlayMapMemory(['standard']) }, {});
    assert.deepEqual({ ...normalizeFreePlayMapMemory(null) }, {});
});
