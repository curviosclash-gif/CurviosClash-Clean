import assert from 'node:assert/strict';
import test from 'node:test';

import {
    listArcadeModifierDescriptors,
    resolveArcadeModifierMeta,
} from '../src/shared/contracts/ArcadeModifierContract.js';
import { ARCADE_SECTOR_MODIFIERS } from '../src/entities/directors/ArcadeEncounterCatalog.js';

test('arcade modifier portal_storm is presented as an item spawn modifier', () => {
    const meta = resolveArcadeModifierMeta('portal_storm');

    assert.ok(meta, 'portal_storm must stay a known modifier id');
    assert.equal(meta.id, 'portal_storm');
    assert.equal(meta.label, 'Item-Regen');
    assert.match(meta.effectText, /Gegenstände/);
    assert.doesNotMatch(meta.label, /portal/i);
    assert.doesNotMatch(meta.effectText, /portal/i);
});

test('arcade modifier descriptors keep their stable id set and order', () => {
    const ids = listArcadeModifierDescriptors().map((entry) => entry.id);

    assert.deepEqual(ids, ['boost_tax', 'heat_stress', 'portal_storm', 'tight_turns']);
});

test('arcade sector modifier catalog labels match the contract labels', () => {
    ARCADE_SECTOR_MODIFIERS.forEach((entry) => {
        const meta = resolveArcadeModifierMeta(entry.id);
        assert.ok(meta, `Sector modifier without contract meta: ${entry.id}`);
        assert.equal(entry.label, meta.label, `Label drift for modifier ${entry.id}`);
    });
});
