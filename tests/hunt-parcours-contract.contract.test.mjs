import test from 'node:test';
import assert from 'node:assert/strict';

import {
    HUNT_PARCOURS_PATHS,
    HUNT_PARCOURS_RUN_TYPE,
    isHuntParcoursConfig,
    isHuntParcoursRunType,
    isHuntParcoursVariantUnlocked,
    listHuntParcoursVariants,
    normalizeHuntParcoursVariantId,
    resolveHuntParcoursMedal,
    resolveHuntParcoursVariant,
} from '../src/shared/contracts/HuntParcoursContract.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

const EXPECTED_IDS = ['nemesis', 'fox_hunt', 'trail_scent', 'herd_drive', 'fire_front', 'beacon_hold', 'guided_breach'];

test('hunt parcours lists the seven variants of the Jagdgruende world in a stable order', () => {
    assert.deepEqual(listHuntParcoursVariants().map((variant) => variant.id), EXPECTED_IDS);
});

test('every variant map exists in the preset catalog and has three stages', () => {
    for (const variant of listHuntParcoursVariants()) {
        assert.equal(variant.mapKeys.length, 3, variant.id);
        for (const mapKey of variant.mapKeys) {
            assert.ok(MAP_PRESET_CATALOG[mapKey], `${variant.id}: unknown map ${mapKey}`);
        }
    }
});

test('variant seeds are fixed, positive and unique so medals stay comparable', () => {
    const seeds = listHuntParcoursVariants().map((variant) => variant.seed);
    assert.ok(seeds.every((seed) => Number.isInteger(seed) && seed > 0));
    assert.equal(new Set(seeds).size, seeds.length);
});

test('world graph: nemesis opens both paths, each path is a chain', () => {
    const byId = new Map(listHuntParcoursVariants().map((variant) => [variant.id, variant]));
    assert.equal(byId.get('nemesis').path, HUNT_PARCOURS_PATHS.ENTRY);
    assert.equal(byId.get('nemesis').unlockAfter, '');
    assert.deepEqual(
        ['fox_hunt', 'trail_scent', 'herd_drive'].map((id) => [byId.get(id).path, byId.get(id).unlockAfter]),
        [[HUNT_PARCOURS_PATHS.HETZEN, 'nemesis'], [HUNT_PARCOURS_PATHS.HETZEN, 'fox_hunt'], [HUNT_PARCOURS_PATHS.HETZEN, 'trail_scent']]
    );
    assert.deepEqual(
        ['fire_front', 'beacon_hold', 'guided_breach'].map((id) => [byId.get(id).path, byId.get(id).unlockAfter]),
        [[HUNT_PARCOURS_PATHS.STUERMEN, 'nemesis'], [HUNT_PARCOURS_PATHS.STUERMEN, 'fire_front'], [HUNT_PARCOURS_PATHS.STUERMEN, 'beacon_hold']]
    );
});

test('variant ids normalize case-insensitively and reject unknown values', () => {
    assert.equal(normalizeHuntParcoursVariantId(' Fox_Hunt '), 'fox_hunt');
    assert.equal(normalizeHuntParcoursVariantId('gauntlet'), '');
    assert.equal(normalizeHuntParcoursVariantId(null), '');
    assert.equal(resolveHuntParcoursVariant('nope'), null);
    assert.equal(resolveHuntParcoursVariant('NEMESIS').id, 'nemesis');
});

test('run type and config detection need the exact run type and an enabled arcade', () => {
    assert.equal(isHuntParcoursRunType(HUNT_PARCOURS_RUN_TYPE), true);
    assert.equal(isHuntParcoursRunType('Hunt_Parcours'), true);
    assert.equal(isHuntParcoursRunType('endless_parcours'), false);
    assert.equal(isHuntParcoursConfig({ arcade: { enabled: true, runType: 'hunt_parcours' } }), true);
    assert.equal(isHuntParcoursConfig({ arcade: { enabled: false, runType: 'hunt_parcours' } }), false);
    assert.equal(isHuntParcoursConfig(null), false);
});

test('a stage unlocks only with at least bronze in its predecessor', () => {
    assert.equal(isHuntParcoursVariantUnlocked('nemesis', {}), true);
    assert.equal(isHuntParcoursVariantUnlocked('fox_hunt', {}), false);
    assert.equal(isHuntParcoursVariantUnlocked('fox_hunt', { nemesis: '' }), false);
    assert.equal(isHuntParcoursVariantUnlocked('fox_hunt', { nemesis: 'bronze' }), true);
    assert.equal(isHuntParcoursVariantUnlocked('fire_front', { nemesis: 'gold' }), true);
    assert.equal(isHuntParcoursVariantUnlocked('trail_scent', { nemesis: 'gold' }), false);
    assert.equal(isHuntParcoursVariantUnlocked('trail_scent', { fox_hunt: 'platinum' }), false);
    assert.equal(isHuntParcoursVariantUnlocked('unknown', { nemesis: 'gold' }), false);
});

test('medals follow 50/70/90 percent of the variant reference score', () => {
    const reference = resolveHuntParcoursVariant('nemesis').referenceScore;
    assert.equal(resolveHuntParcoursMedal('nemesis', reference * 0.49), '');
    assert.equal(resolveHuntParcoursMedal('nemesis', reference * 0.5), 'bronze');
    assert.equal(resolveHuntParcoursMedal('nemesis', reference * 0.7), 'silver');
    assert.equal(resolveHuntParcoursMedal('nemesis', reference * 0.9), 'gold');
    assert.equal(resolveHuntParcoursMedal('nemesis', Number.NaN), '');
    assert.equal(resolveHuntParcoursMedal('unknown', 999999), '');
});
