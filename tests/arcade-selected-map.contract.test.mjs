import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import {
    registerMapCatalogConfigSource,
} from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { resolveMapSequence } from '../src/state/arcade/ArcadeMapProgression.js';

test.before(() => {
    registerMapCatalogConfigSource({ MAPS: MAP_PRESET_CATALOG });
});

test.after(() => {
    registerMapCatalogConfigSource(null);
});

function createArcadeSupport(mapKey, options = {}) {
    const appliedProfiles = [];
    const runtimeState = {
        numHumans: 1,
        runtimeConfig: {
            arcade: {
                enabled: true,
                seed: options.seed ?? 12,
                sectorCount: options.sectorCount ?? 6,
                dailyChallenge: options.dailyChallenge === true,
            },
            bot: { activeDifficulty: 'NORMAL' },
            session: { mapKey, numBots: 3 },
            player: { vehicles: { PLAYER_1: 'ship8' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        applySectorRuntimeProfile: (profile) => appliedProfiles.push(profile),
    });
    support.syncRuntimeConfig();
    return { appliedProfiles, runtimeState, support };
}

test('locked map entries bypass the seeded sector pool', () => {
    const sequence = resolveMapSequence({
        sequence: [
            {
                templateId: 'sector_parcours',
                mapKey: 'aether_relay',
                mapKeyLocked: true,
            },
            { templateId: 'sector_intro' },
        ],
    }, 'selected-map', MAP_PRESET_CATALOG);

    assert.equal(sequence[0], 'aether_relay');
    assert.ok(sequence[1]);
});

test('selected Aether Relay starts sector one as a bot-free parcours', () => {
    const { appliedProfiles, support } = createArcadeSupport('aether_relay');
    const profile = support.prepareMatchStartRuntime();

    assert.equal(profile.mapKey, 'aether_relay');
    assert.equal(profile.templateId, 'sector_parcours');
    assert.equal(profile.parcoursEnabled, true);
    assert.equal(profile.botCount, 0);
    assert.equal(appliedProfiles[0], profile);

    const state = support.startRunIfEnabled();
    assert.equal(state.currentMapKey, 'aether_relay');
    assert.equal(state.mapSequence[0], 'aether_relay');
    assert.equal(state.encounterSequence[0].mapKeyLocked, true);
    assert.equal(state.encounterSequence[0].parcoursEnabled, true);
    assert.equal(support.arcadeRunRuntime.isCurrentSectorParcours(), true);
});

test('selected combat map starts sector one without disabling later map rotation', () => {
    const { support } = createArcadeSupport('rift_bazaar');
    const profile = support.prepareMatchStartRuntime();
    const state = support.startRunIfEnabled();

    assert.equal(profile.mapKey, 'rift_bazaar');
    assert.equal(profile.templateId, 'sector_intro');
    assert.equal(profile.parcoursEnabled, false);
    assert.ok(profile.botCount > 0);
    assert.equal(state.mapSequence[0], 'rift_bazaar');
    assert.ok(state.mapSequence.slice(1).some((mapKey) => mapKey !== 'rift_bazaar'));
    assert.equal(support.arcadeRunRuntime.isCurrentSectorParcours(), false);
});

test('daily challenge keeps its seeded first map', () => {
    const { support } = createArcadeSupport('aether_relay', { dailyChallenge: true });
    const profile = support.prepareMatchStartRuntime();

    assert.notEqual(profile.mapKey, 'aether_relay');
    assert.equal(support._preparedEncounterPlan.sequence[0].mapKeyLocked, undefined);
});
