import test from 'node:test';
import assert from 'node:assert/strict';

import {
    HUNT_PARCOURS_MEDAL_RECORD_VERSION,
    getHuntParcoursMedalsByVariant,
    isWritableHuntParcoursMedalRecord,
    normalizeHuntParcoursMedalRecord,
    recordHuntParcoursResult,
    resolveHuntParcoursLeaderboardKey,
} from '../src/shared/contracts/HuntParcoursMedalRecordContract.js';
import { isHuntParcoursVariantUnlocked } from '../src/shared/contracts/HuntParcoursContract.js';

test('garbage and foreign versions become an empty record; unknown variants are dropped', () => {
    for (const raw of [null, 7, [], { version: 99, variants: { nemesis: { bestScore: 5 } } }]) {
        assert.deepEqual(normalizeHuntParcoursMedalRecord(raw), { version: HUNT_PARCOURS_MEDAL_RECORD_VERSION, variants: {} });
    }
    const record = normalizeHuntParcoursMedalRecord({
        version: HUNT_PARCOURS_MEDAL_RECORD_VERSION,
        variants: { nemesis: { bestScore: '3000.7', bestMedal: 'platinum', plays: -2, lastScore: 'x' }, gauntlet: { bestScore: 1 }, fox_hunt: null },
    });
    assert.deepEqual(record.variants, { nemesis: { bestScore: 3000, bestMedal: '', plays: 0, lastScore: 0 } });
});

test('results count plays and only ever improve best score and medal', () => {
    const original = normalizeHuntParcoursMedalRecord(null);
    let record = recordHuntParcoursResult(original, { variantId: 'nemesis', score: 3300 });
    assert.deepEqual(original.variants, {}, 'input stays untouched');
    assert.deepEqual(record.variants.nemesis, { bestScore: 3300, bestMedal: 'gold', plays: 1, lastScore: 3300 });
    record = recordHuntParcoursResult(record, { variantId: 'NEMESIS', score: 1000 });
    assert.deepEqual(record.variants.nemesis, { bestScore: 3300, bestMedal: 'gold', plays: 2, lastScore: 1000 });
    record = recordHuntParcoursResult(record, { variantId: 'fox_hunt', score: 2100 });
    assert.equal(record.variants.fox_hunt.bestMedal, 'bronze');
    assert.deepEqual(recordHuntParcoursResult(record, { variantId: 'gauntlet', score: 9999 }), record);
    assert.deepEqual(recordHuntParcoursResult(record, { variantId: 'nemesis', score: 'junk' }), record);
    assert.deepEqual(recordHuntParcoursResult(record), record);
});

test('medals by variant feed the unlock rule', () => {
    const record = recordHuntParcoursResult(null, { variantId: 'nemesis', score: 1800 });
    const medals = getHuntParcoursMedalsByVariant(record);
    assert.deepEqual(medals, { nemesis: 'bronze' });
    assert.equal(isHuntParcoursVariantUnlocked('fox_hunt', medals), true);
    assert.equal(isHuntParcoursVariantUnlocked('trail_scent', medals), false);
});

test('only an absent record or one of this version may be overwritten', () => {
    assert.equal(isWritableHuntParcoursMedalRecord(null), true);
    assert.equal(isWritableHuntParcoursMedalRecord({ version: HUNT_PARCOURS_MEDAL_RECORD_VERSION }), true);
    assert.equal(isWritableHuntParcoursMedalRecord({ version: 2 }), false);
    assert.equal(isWritableHuntParcoursMedalRecord([]), false);
});

test('leaderboard keys: nemesis splits by rival tier group, other variants do not', () => {
    assert.equal(resolveHuntParcoursLeaderboardKey({ variantId: 'nemesis', rivalTierGroup: '2-3' }), 'hunt_parcours:nemesis:2-3');
    assert.equal(resolveHuntParcoursLeaderboardKey({ variantId: 'nemesis', rivalTierGroup: '9-9' }), '');
    assert.equal(resolveHuntParcoursLeaderboardKey({ variantId: 'Fox_Hunt', rivalTierGroup: '2-3' }), 'hunt_parcours:fox_hunt');
    assert.equal(resolveHuntParcoursLeaderboardKey({ variantId: 'gauntlet' }), '');
    assert.equal(resolveHuntParcoursLeaderboardKey(), '');
});
