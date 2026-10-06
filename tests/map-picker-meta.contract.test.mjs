import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_PICKER_COLLECTION_DEFS,
    MAP_PICKER_META_LIMITS,
    MAP_PICKER_TAGS,
    MAP_PICKER_TIERS,
    normalizeMapPickerMeta,
} from '../src/shared/contracts/MapPickerMetaContract.js';
import { MAP_PICKER_META, getMapPickerMeta } from '../src/shared/maps/MapPickerMeta.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PICKER_COLLECTIONS, resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';

const catalogKeys = Object.keys(MAP_PRESET_CATALOG);
const metaKeys = Object.keys(MAP_PICKER_META);

test('normalizer returns a complete valid entry for any input', () => {
    for (const junk of [undefined, null, [], 'abc', 7, {}]) {
        const meta = normalizeMapPickerMeta(junk);
        assert.equal(meta.collection, 'other');
        assert.equal(meta.tier, 'public');
        assert.equal(meta.difficulty, 2);
        assert.deepEqual(meta.tags, []);
        assert.equal(meta.description, '');
        assert.ok(meta.players.min <= meta.players.recommended && meta.players.recommended <= meta.players.max);
    }
});

test('normalizer clamps, orders and filters', () => {
    const meta = normalizeMapPickerMeta({
        collection: 'parcours',
        tier: 'secret',
        difficulty: 9,
        players: { min: 6, recommended: 2, max: 3 },
        tags: ['boss', 'nonsense', 'destructible', 'boss', 7],
        description: '  Ein Satz.  ',
    });
    assert.equal(meta.collection, 'parcours');
    assert.equal(meta.tier, 'public');
    assert.equal(meta.difficulty, MAP_PICKER_META_LIMITS.difficulty.max);
    assert.deepEqual(meta.players, { min: 6, recommended: 6, max: 6 });
    assert.deepEqual(meta.tags, ['destructible', 'boss']);
    assert.equal(meta.description, 'Ein Satz.');
    assert.equal(normalizeMapPickerMeta({ difficulty: 0 }).difficulty, 1);
    assert.equal(normalizeMapPickerMeta({ difficulty: '3' }).difficulty, 3);
    assert.equal(normalizeMapPickerMeta({ tier: 'dev' }).tier, 'dev');
    assert.equal(normalizeMapPickerMeta({ description: 'x'.repeat(999) }).description.length, MAP_PICKER_META_LIMITS.descriptionLength);
});

test('every catalog map has exactly one entry and every entry a catalog map', () => {
    assert.deepEqual([...catalogKeys].sort(), [...metaKeys].sort());
    assert.equal(new Set(metaKeys).size, metaKeys.length);
});

test('every entry is already normalized and has a text', () => {
    const collectionIds = new Set(MAP_PICKER_COLLECTION_DEFS.map((entry) => entry.id));
    for (const key of metaKeys) {
        const meta = MAP_PICKER_META[key];
        assert.deepEqual(normalizeMapPickerMeta(meta), meta, `${key} is not normalized`);
        assert.ok(collectionIds.has(meta.collection), `${key} has no collection`);
        assert.ok(MAP_PICKER_TIERS.includes(meta.tier));
        assert.ok(meta.description.length >= 20, `${key} has no description`);
        assert.ok(!meta.description.includes('\n'), `${key} description is one line`);
        for (const tag of meta.tags) assert.ok(MAP_PICKER_TAGS.includes(tag));
    }
    assert.equal(getMapPickerMeta('standard'), MAP_PICKER_META.standard);
    assert.equal(getMapPickerMeta('not_a_map').collection, 'other');
});

test('tags follow what the preset really carries', () => {
    for (const key of catalogKeys) {
        const map = MAP_PRESET_CATALOG[key];
        const tags = MAP_PICKER_META[key].tags;
        assert.equal(tags.includes('destructible'), !!map.destructibles, `${key} destructible tag`);
        assert.equal(tags.includes('secretRoom'), Array.isArray(map.secretRooms) && map.secretRooms.length > 0, `${key} secretRoom tag`);
        assert.equal(tags.includes('parcours'), map.parcours?.enabled === true, `${key} parcours tag`);
        const huge = Math.max(map.size[0], map.size[2]) >= 400;
        assert.equal(tags.includes('huge'), huge, `${key} huge tag`);
    }
});

test('E8: the developer maps are tier dev and nothing else is', () => {
    const dev = metaKeys.filter((key) => MAP_PICKER_META[key].tier === 'dev').sort();
    assert.deepEqual(dev, ['empty', 'glb_gallery', 'glb_hangar', 'item_showcase', 'showcase_nexus', 'upgrade_showcase']);
});

test('parcours difficulty follows the agreed steps', () => {
    const expected = {
        tutorial_classic: 1, micro_maw: 1, parcours_rift_sprint: 2, aether_relay: 2,
        parcours_rift: 3, mirror_docks: 3, glass_serpent: 3, storm_switchyard: 3, wind_cathedral: 3, parcours_assault: 3,
        parcours_rift_precision: 4, chrono_spillway: 4, sky_ladder_abyss: 4, sky_ladder_foundry: 4,
        sky_ladder_storm: 5, sky_ladder_star: 5,
    };
    for (const [key, difficulty] of Object.entries(expected)) {
        assert.equal(MAP_PICKER_META[key].difficulty, difficulty, key);
    }
});

test('the picker collections come from the table', () => {
    const listed = MAP_PICKER_COLLECTIONS.flatMap((collection) => collection.mapKeys);
    assert.deepEqual([...listed].sort(), [...metaKeys].sort());
    for (const collection of MAP_PICKER_COLLECTIONS) {
        for (const key of collection.mapKeys) assert.equal(MAP_PICKER_META[key].collection, collection.id, key);
    }
    assert.equal(resolveMapPickerCollection('neon_carnival').id, 'parcours');
    assert.equal(resolveMapPickerCollection('aether_relay').id, 'parcours');
    assert.equal(resolveMapPickerCollection('not_a_map').id, 'other');
});
