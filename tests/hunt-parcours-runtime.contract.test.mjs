import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCADE_RUN_KINDS,
    resolveArcadeInitialMapKey,
    resolveArcadeRunKind,
    resolveArcadeRuntimeKind,
} from '../src/shared/contracts/ArcadeRunTypeDispatchContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolveHuntParcoursVariant } from '../src/shared/contracts/HuntParcoursContract.js';

test('hunt_parcours resolves to its own run kind from the run type and the runtime config', () => {
    assert.equal(ARCADE_RUN_KINDS.HUNT_PARCOURS, 'hunt_parcours');
    assert.equal(resolveArcadeRunKind('hunt_parcours'), ARCADE_RUN_KINDS.HUNT_PARCOURS);
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: true, runType: 'hunt_parcours' } }), ARCADE_RUN_KINDS.HUNT_PARCOURS);
    assert.equal(resolveArcadeRuntimeKind({ arcade: { enabled: false, runType: 'hunt_parcours' } }), ARCADE_RUN_KINDS.GAUNTLET);
});

test('hunt_parcours starts on the first map of its variant', () => {
    const foxHunt = resolveHuntParcoursVariant('fox_hunt');
    assert.equal(resolveArcadeInitialMapKey({ arcadeEnabled: true, arcade: { runType: 'hunt_parcours', huntParcoursVariantId: 'fox_hunt' } }), foxHunt.mapKeys[0]);
    assert.equal(resolveArcadeInitialMapKey({ arcadeEnabled: true, arcade: { runType: 'hunt_parcours', huntParcoursVariantId: 'bogus' } }), 'mirror_docks');
});

test('settings keep the hunt_parcours variant, the hunt combat profile and the variant seed', () => {
    const settings = normalizeArcadeRunSettings({ runType: 'hunt_parcours', huntParcoursVariantId: ' Fox_Hunt ', seed: 42 });
    assert.equal(settings.runType, 'hunt_parcours');
    assert.equal(settings.combatProfile, 'hunt');
    assert.equal(settings.huntParcoursVariantId, 'fox_hunt');
    assert.equal(settings.seed, resolveHuntParcoursVariant('fox_hunt').seed);

    const fallback = normalizeArcadeRunSettings({ runType: 'hunt_parcours', huntParcoursVariantId: 'nope' });
    assert.equal(fallback.huntParcoursVariantId, 'nemesis');
    assert.equal(fallback.seed, resolveHuntParcoursVariant('nemesis').seed);

    const gauntlet = normalizeArcadeRunSettings({ runType: 'gauntlet', huntParcoursVariantId: 'fox_hunt', seed: 42 });
    assert.equal(gauntlet.huntParcoursVariantId, '');
    assert.equal(gauntlet.seed, 42);
});
