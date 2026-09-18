import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { buildArcadeMissionSeed } from '../src/core/arcade/ArcadeObjectiveRuntimeOps.js';
import { resolveMapSequence } from '../src/state/arcade/ArcadeMapProgression.js';
import { assignSectorMissions } from '../src/state/arcade/ArcadeMissionState.js';
import {
    getRuntimeMapCatalog,
    getRuntimeMapDefinition,
    registerMapCatalogConfigSource,
} from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { ArcadeModeStrategy, ARCADE_SECTOR_TYPES } from '../src/modes/ArcadeModeStrategy.js';

// Moved from tests/core-targeted-runtime.spec.js (P3): neither test took the `page` fixture,
// both ran in Playwright's own node process against the arcade modules. The test ids stay in
// the titles.
//
// T20am1 swaps the map catalog source for synthetic maps. node:test runs the tests of one file
// sequentially in a process of its own, and the finally block unregisters the source again, so
// the second test and every other contract file see the real catalog.

test('T20am1: Arcade-Map- und Missionsfolge folgen dem aktiven Run-Seed', () => {
    const mapKeys = [
        'standard',
        'foam_forest',
        'crossfire',
        'maze',
        'vertical_maze',
        'trench',
        'neon_abyss',
        'complex',
        'pyramid',
        'crystal_ruins',
        'expert_gauntlet',
        'portal_madness',
        'parcours_rift',
        'parcours_rift_sprint',
        'parcours_rift_precision',
    ];
    const maps = Object.fromEntries(mapKeys.map((key) => [key, {
        name: key,
        size: [80, 30, 80],
        obstacles: [],
        portals: [],
    }]));
    const encounterPlan = {
        sequence: [
            { templateId: 'sector_intro' },
            { templateId: 'sector_pressure' },
            { templateId: 'sector_hazard' },
        ],
    };

    registerMapCatalogConfigSource({ MAPS: maps });
    try {
        const configSeed = 1;
        const runSeed = 2;
        const runtime = new ArcadeRunRuntime({ now: () => 1234567890 });
        runtime._enabled = true;
        runtime._config = { ...runtime._config, seed: configSeed };
        const state = runtime.startRun({ seed: runSeed, encounterPlan });
        const catalog = getRuntimeMapCatalog();
        const expectedRunMaps = resolveMapSequence(encounterPlan, runSeed, catalog);
        const expectedConfigMaps = resolveMapSequence(encounterPlan, configSeed, catalog);
        const mapDefinition = getRuntimeMapDefinition(state?.currentMapKey, catalog);
        const mapMissions = Array.isArray(mapDefinition?.missions) && mapDefinition.missions.length > 0
            ? mapDefinition.missions
            : null;
        const actualMissions = Array.isArray(state?.missions?.missions)
            ? state.missions.missions.map((mission) => mission.type)
            : [];
        const missionSeedOptions = {
            scoreModel: state?.config?.scoreModel,
            sectorIndex: 1,
            templateId: 'sector_intro',
            mapKey: state?.currentMapKey,
        };
        const expectedRunMissionSeed = buildArcadeMissionSeed({
            ...missionSeedOptions,
            activeSeed: runSeed,
        });
        const expectedConfigMissionSeed = buildArcadeMissionSeed({
            ...missionSeedOptions,
            activeSeed: configSeed,
        });
        // Mirror the eligibility context the runtime hands to the mission assignment: the
        // synthetic maps carry no items, so item missions are filtered on both sides.
        const sectorProfile = runtime.getSectorRuntimeProfile(1);
        const capabilities = runtime._getMissionCapabilities?.() || {};
        const missionContext = {
            botCount: sectorProfile.botCount,
            respawnEnabled: false,
            parcoursEnabled: sectorProfile.parcoursEnabled,
            hasItems: capabilities.hasItems ?? ((mapDefinition?.items?.length || 0) > 0),
            hasExitPortal: !!mapDefinition?.exitPortal,
            hasHealing: capabilities.hasHealing === true,
            unavoidableDamage: false,
            maximumDurationSec: 0,
            minimumDurationSec: 0,
        };
        const expectedRunMissions = assignSectorMissions(
            { id: 'sector_intro' },
            mapMissions,
            expectedRunMissionSeed,
            1,
            missionContext
        ).map((mission) => mission.type);

        assert.strictEqual(state?.config?.seed, 2);
        assert.deepStrictEqual(state?.mapSequence || [], expectedRunMaps);
        assert.notDeepStrictEqual(state?.mapSequence || [], expectedConfigMaps);
        assert.notStrictEqual(expectedRunMissionSeed, expectedConfigMissionSeed);
        assert.deepStrictEqual(actualMissions, expectedRunMissions);
    } finally {
        registerMapCatalogConfigSource(null);
    }
});

test('T20am2: Arcade-Strategy-Cleanup resettet Sudden-Death-Runstate', () => {
    const strategy = new ArcadeModeStrategy();
    strategy.recordScore(0, 42);
    strategy.setActiveModifier('tight_turns');
    strategy.setSectorType(ARCADE_SECTOR_TYPES.PARCOURS);
    strategy.applyVehicleUpgrades({ turningBonusPct: 25, speedBonusPct: 20, maxHpBonus: 20 });
    strategy.enterSuddenDeath();
    strategy.tickSuddenDeath(65);

    const before = {
        suddenDeathActive: strategy.isSuddenDeathActive(),
        stackedModifiers: strategy.getSuddenDeathState().stackedModifiers.length,
        turnRate: Number(strategy.getTurnRateMultiplier().toFixed(3)),
        speed: Number(strategy.getSpeedMultiplier().toFixed(3)),
        sectorType: strategy.getSectorType(),
        score: strategy.computeRoundResult([{ playerIndex: 0, alive: true, hp: 100 }], {})?.scores?.[0]?.accumulatedScore,
    };

    strategy.cleanup();

    const after = {
        suddenDeathActive: strategy.isSuddenDeathActive(),
        stackedModifiers: strategy.getSuddenDeathState().stackedModifiers.length,
        damageMultiplier: strategy.getSuddenDeathState().damageMultiplier,
        turnRate: strategy.getTurnRateMultiplier(),
        speed: strategy.getSpeedMultiplier(),
        activeModifier: strategy.getActiveModifier(),
        sectorType: strategy.getSectorType(),
        score: strategy.computeRoundResult([{ playerIndex: 0, alive: true, hp: 100 }], {})?.scores?.[0]?.accumulatedScore,
    };

    assert.ok(before.suddenDeathActive);
    assert.ok(before.stackedModifiers > 0);
    assert.notStrictEqual(before.turnRate, 1);
    assert.notStrictEqual(before.speed, 1);
    assert.strictEqual(before.sectorType, 'sector_parcours');
    assert.strictEqual(before.score, 42);
    assert.ok(!after.suddenDeathActive);
    assert.strictEqual(after.stackedModifiers, 0);
    assert.strictEqual(after.damageMultiplier, 1);
    assert.strictEqual(after.turnRate, 1);
    assert.strictEqual(after.speed, 1);
    assert.strictEqual(after.activeModifier, null);
    assert.strictEqual(after.sectorType, null);
    assert.strictEqual(after.score, 0);
});
