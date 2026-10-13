// ============================================
// free-play-map-choice.contract.test.mjs - Kartenwahl im freien Spiel (Menü-Umbau Etappe 2):
// Filter nach Variante samt Zähler (K1), Gedächtnis je Variante (V7), Zufallskarte ohne die
// letzten drei (K7). Reine Logik, läuft ohne Browser.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { FREE_PLAY_VARIANTS } from '../src/shared/contracts/FreePlayVariantContract.js';
import {
    FREE_PLAY_RANDOM_RECENT_EXCLUSION,
    describeFreePlayMapCount,
    listFreePlayEligibleMapKeys,
    pickRandomFreePlayMapKey,
    rememberFreePlayMap,
    resolveFreePlayVariantMapKey,
} from '../src/shared/contracts/FreePlayMapChoiceContract.js';

const MAPS = Object.freeze({
    open: {},
    duel: { excludedModes: ['ESCORT'] },
    race: { excludedModes: ['HUNT'] },
    hunt_only: { excludedModes: ['CLASSIC'] },
});

test('the list keeps only maps that fit the variant, in catalog order', () => {
    assert.deepEqual(listFreePlayEligibleMapKeys({ maps: MAPS, variant: 'ffa' }), ['open', 'duel', 'hunt_only']);
    assert.deepEqual(listFreePlayEligibleMapKeys({ maps: MAPS, variant: 'escort' }), ['open', 'hunt_only']);
    assert.deepEqual(listFreePlayEligibleMapKeys({ maps: MAPS, variant: 'classic' }), ['open', 'duel', 'race']);
});

test('the picker rules apply on top of the variant rules', () => {
    const isOffered = (key) => key !== 'open';
    assert.deepEqual(listFreePlayEligibleMapKeys({ maps: MAPS, variant: 'ffa', isOffered }), ['duel', 'hunt_only']);
});

test('no variant (arcade, quick action) filters nothing and counts nothing', () => {
    assert.deepEqual(listFreePlayEligibleMapKeys({ maps: MAPS, variant: null }), Object.keys(MAPS));
    assert.equal(describeFreePlayMapCount(null, 5), '');
});

test('the counter names the variant in plain words', () => {
    assert.equal(describeFreePlayMapCount('flags', 24), '24 Karten passen zu Flaggen');
    assert.equal(describeFreePlayMapCount('classic', 1), '1 Karte passt zu Klassisch');
    assert.equal(describeFreePlayMapCount('escort', 0), 'Keine Karte passt zu Eskorte');
    for (const variant of FREE_PLAY_VARIANTS) {
        assert.match(describeFreePlayMapCount(variant, 3), /^3 Karten passen zu \S/, variant);
    }
});

test('the real catalog gives every variant a non-empty list and Escort is the narrowest', () => {
    const counts = Object.fromEntries(FREE_PLAY_VARIANTS.map((variant) => [
        variant,
        listFreePlayEligibleMapKeys({ maps: CONFIG.MAPS, variant }).length,
    ]));
    for (const variant of FREE_PLAY_VARIANTS) assert.ok(counts[variant] > 0, `${variant}: ${counts[variant]}`);
    assert.ok(counts.escort <= counts.flags, JSON.stringify(counts));
    assert.ok(counts.flags <= Object.keys(CONFIG.MAPS).length);
});

test('remembering a map writes only the entry of that variant and returns a new frozen object', () => {
    const first = rememberFreePlayMap({}, 'flags', ' duel ');
    assert.deepEqual({ ...first }, { flags: 'duel' });
    assert.ok(Object.isFrozen(first));
    const second = rememberFreePlayMap(first, 'classic', 'open');
    assert.deepEqual({ ...second }, { flags: 'duel', classic: 'open' });
    assert.deepEqual({ ...first }, { flags: 'duel' }, 'the old memory stays untouched');
    assert.deepEqual({ ...rememberFreePlayMap(second, 'arcade', 'open') }, { ...second }, 'unknown variants drop out');
    assert.deepEqual({ ...rememberFreePlayMap(second, null, 'open') }, { ...second });
    assert.deepEqual({ ...rememberFreePlayMap(second, 'flags', '') }, { ...second }, 'an empty key keeps the entry');
});

test('switching the variant brings back the remembered map when it still fits', () => {
    const memory = { escort: 'hunt_only', classic: 'race', ffa: 'gone' };
    const base = { maps: MAPS, memory };
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'escort', currentMapKey: 'open' }), 'hunt_only');
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'classic', currentMapKey: 'open' }), 'race');
});

test('a remembered map that vanished or no longer fits yields to the current map, then to nothing', () => {
    const base = { maps: MAPS, memory: { ffa: 'gone', escort: 'race', flags: 'duel' } };
    // The map no longer exists in the catalog.
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'ffa', currentMapKey: 'open' }), 'open');
    // The map exists but is excluded from the variant (race has no HUNT).
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'escort', currentMapKey: 'hunt_only' }), 'hunt_only');
    // The picker rules reject the remembered map.
    assert.equal(resolveFreePlayVariantMapKey({
        ...base, variant: 'flags', currentMapKey: 'open', isOffered: (key) => key !== 'duel',
    }), 'open');
    // Nothing fits: the caller keeps its own fallback logic.
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'escort', currentMapKey: 'race' }), '');
    assert.equal(resolveFreePlayVariantMapKey({ ...base, variant: 'ffa', currentMapKey: '' }), '');
});

test('without a free play variant the current map stays as it is', () => {
    assert.equal(resolveFreePlayVariantMapKey({ variant: null, memory: { ffa: 'duel' }, maps: MAPS, currentMapKey: 'race' }), 'race');
});

test('the random pick skips the last three maps while something else is left', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'];
    assert.equal(FREE_PLAY_RANDOM_RECENT_EXCLUSION, 3);
    const recentKeys = ['a', 'b', 'c', 'd'];
    // Only 'd' and 'e' may come up: d is the fourth recent map and counts as old enough.
    const seen = new Set();
    for (let step = 0; step < 20; step += 1) {
        seen.add(pickRandomFreePlayMapKey({ candidates, recentKeys, rng: () => step / 20 }));
    }
    assert.deepEqual([...seen].sort(), ['d', 'e']);
});

test('the random pick is driven only by the injected rng', () => {
    const candidates = ['a', 'b', 'c', 'd'];
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => 0 }), 'a');
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => 0.5 }), 'c');
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => 0.999999 }), 'd');
    // A broken rng must not run out of the list.
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => 1 }), 'd');
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => Number.NaN }), 'a');
    assert.equal(pickRandomFreePlayMapKey({ candidates, rng: () => -3 }), 'a');
});

test('when every candidate was played recently the whole list is used again', () => {
    assert.equal(pickRandomFreePlayMapKey({ candidates: ['a', 'b'], recentKeys: ['a', 'b', 'x'], rng: () => 0.9 }), 'b');
    assert.equal(pickRandomFreePlayMapKey({ candidates: ['a'], recentKeys: ['a'], rng: () => 0.2 }), 'a');
});

test('the random pick ignores duplicates and blanks and answers an empty list with an empty key', () => {
    assert.equal(pickRandomFreePlayMapKey({ candidates: [], rng: () => 0 }), '');
    assert.equal(pickRandomFreePlayMapKey({ candidates: ['', null, 'a', 'a'], rng: () => 0.9 }), 'a');
    assert.equal(pickRandomFreePlayMapKey({ candidates: ['a', 'b'], recentKeys: undefined, rng: () => 0 }), 'a');
});
