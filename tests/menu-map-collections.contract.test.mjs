import assert from 'node:assert/strict';
import test from 'node:test';

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