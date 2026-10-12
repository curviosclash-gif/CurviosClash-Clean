import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_DIFFICULTY_STAGES, resolveMapDifficultyStage } from '../src/shared/contracts/MapPickerMetaContract.js';
import { MAP_PICKER_META } from '../src/shared/maps/MapPickerMeta.js';
import { MAP_PICKER_COLLECTIONS, resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';

// A key listed twice would silently take the position of its last entry, and a key in two
// collections would show up in only one of them (the later one wins in the lookup table).
test('every map key appears once in the picker collections', () => {
    const owner = new Map();
    for (const collection of MAP_PICKER_COLLECTIONS) {
        const seen = new Set();
        for (const key of collection.mapKeys) {
            assert.equal(seen.has(key), false, `${key} is listed twice in ${collection.id}`);
            seen.add(key);
            assert.equal(owner.has(key), false, `${key} is in both ${owner.get(key)} and ${collection.id}`);
            owner.set(key, collection.id);
        }
    }
});

test('aether_relay is a parcours and sits with the parcours maps', () => {
    assert.equal(resolveMapPickerCollection('aether_relay').id, 'parcours');
});
test('the parcours collection runs from easy to hard in stable table order', () => {
    const parcours = MAP_PICKER_COLLECTIONS.find((collection) => collection.id === 'parcours');
    const tableOrder = Object.keys(MAP_PICKER_META).filter((key) => MAP_PICKER_META[key].collection === 'parcours');
    const difficultyOf = (key) => MAP_PICKER_META[key].difficulty;
    for (let index = 1; index < parcours.mapKeys.length; index += 1) {
        assert.ok(difficultyOf(parcours.mapKeys[index - 1]) <= difficultyOf(parcours.mapKeys[index]),
            `${parcours.mapKeys[index - 1]} must not come before the easier ${parcours.mapKeys[index]}`);
    }
    // Equal difficulty keeps the original table order.
    for (let level = 1; level <= 5; level += 1) {
        const atLevel = (key) => difficultyOf(key) === level;
        assert.deepEqual(parcours.mapKeys.filter(atLevel), tableOrder.filter(atLevel), `difficulty ${level}`);
    }
    // Teaching (1-2) first, craft (3) in the middle, mastery (4-5) last.
    const stages = parcours.mapKeys.map((key) => resolveMapDifficultyStage(difficultyOf(key)).id);
    assert.deepEqual([...new Set(stages)], MAP_DIFFICULTY_STAGES.map((stage) => stage.id));
    assert.deepEqual(parcours.mapKeys.slice(0, 2), ['tutorial_classic', 'micro_maw']);
});
test('only the parcours collection is reordered by difficulty', () => {
    for (const collection of MAP_PICKER_COLLECTIONS.filter((entry) => entry.id !== 'parcours')) {
        const tableOrder = Object.keys(MAP_PICKER_META).filter((key) => MAP_PICKER_META[key].collection === collection.id);
        assert.deepEqual([...collection.mapKeys], tableOrder, collection.id);
    }
});