import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeArcadeScenario,
    resolveArcadeSectorObjectiveDefinition,
} from '../src/shared/contracts/ArcadeScenarioContract.js';
import { ARCADE_SCENARIOS, normalizeArcadeScenarioCatalog } from '../src/entities/directors/ArcadeScenarioCatalog.js';
import {
    buildArcadeSectorPlan,
    resolveArcadeSectorRuntimeProfile,
} from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { resolveMapSequence } from '../src/state/arcade/ArcadeMapProgression.js';
import {
    createArcadeObjectiveState,
    doesArcadeObjectiveHoldRound,
    updateArcadeObjectiveState,
} from '../src/state/arcade/ArcadeObjectiveState.js';
import { updateArcadeObjectiveRuntimeState } from '../src/core/arcade/ArcadeObjectiveRuntimeOps.js';
import { buildArcadeEncounterPlan, requestObjectiveRoundEnd, syncArcadeObjectiveIntoEntities } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { createGameRuntimeBundle } from '../src/core/runtime/GameRuntimeBundle.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    buildArcadeIntermissionChoices,
    prepareArcadeIntermissionState,
} from '../src/core/arcade/ArcadeIntermissionPlanOps.js';
import { createArcadeNextSectorBlock } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';
import { resolveArcadeRunCombatProfile } from '../src/modes/ArcadeRunRulesOps.js';
import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { rewardMapUnitDestruction } from '../src/entities/systems/map-units/MapUnitRewardOps.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { WaterZoneSystem } from '../src/entities/systems/WaterZoneSystem.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { isTurretCombatActive } from '../src/shared/contracts/TurretCombatContract.js';
import { MAP_UNIT_LIMITS } from '../src/shared/contracts/MapUnitContract.js';
import { WATER_PHASES } from '../src/shared/contracts/WaterZoneContract.js';

const scenarioById = (id) => ARCADE_SCENARIOS.find((entry) => entry.id === id);

function planFor(seed, sectorCount = 5) {
    return buildArcadeSectorPlan({ seed, sectorCount, difficulty: 'normal' });
}

test('every catalog scenario survives normalization and names a real map', () => {
    assert.ok(ARCADE_SCENARIOS.length >= 5);
    for (const scenario of ARCADE_SCENARIOS) {
        assert.deepEqual(normalizeArcadeScenario(scenario), scenario, `${scenario.id} is already normalized`);
        assert.ok(scenario.mapKey in MAP_PRESET_CATALOG, `${scenario.id} map ${scenario.mapKey} exists`);
    }
    assert.equal(normalizeArcadeScenario({ id: 'x' }), null, 'a scenario without map is dropped');
    assert.equal(normalizeArcadeScenario({ id: 'x', mapKey: 'standard', objective: { id: 'teleport' } }), null);
    assert.equal(new Set(ARCADE_SCENARIOS.map((scenario) => scenario.id)).size, ARCADE_SCENARIOS.length);
    assert.throws(() => normalizeArcadeScenarioCatalog([
        { id: 'Same Id', mapKey: 'standard' },
        { id: 'same-id', mapKey: 'standard' },
    ]), /Duplicate Arcade scenario id: same_id/);
    const clamped = normalizeArcadeScenario({
        id: 'Clamp Me', mapKey: 'standard', combatProfile: 'laser', botCount: 99,
        objective: { id: 'destroy_units', unitKind: 'dragon', count: -3, durationSec: -1, scoreWeight: 0.2 },
    });
    assert.equal(clamped.id, 'clamp_me');
    assert.equal(clamped.combatProfile, '');
    assert.equal(clamped.botCount, 12);
    assert.deepEqual(
        { ...clamped.objective },
        { id: 'destroy_units', label: 'Einheiten zerstören', unitKind: 'creature', count: 1, durationSec: 0, scoreWeight: 1 },
    );
});

test('sector scenarios use their own map; parcours scenarios keep the course objective and leave normal maps in the pool', () => {
    let scenarioParcours = 0;
    let regularParcours = 0;
    const laterSlotCounts = new Map([[4, { scenario: 0, regular: 0 }], [8, { scenario: 0, regular: 0 }], [12, { scenario: 0, regular: 0 }]]);
    for (const seed of Array.from({ length: 48 }, (_, index) => `scenario-cadence-${index}`)) {
        const plan = buildArcadeSectorPlan({ seed, sectorCount: 13, difficulty: 'normal' });
        const [first, second, third, fourth] = plan.sequence;
        const finale = plan.sequence.at(-1);
        assert.equal(first.scenarioId, undefined);
        assert.equal(second.scenarioId, undefined);
        assert.equal(fourth.parcoursEnabled, true, 'sector 4 stays a parcours');
        assert.equal(fourth.objectiveId, 'parcours_run', 'the course completion objective is preserved');
        if (fourth.scenarioId) {
            scenarioParcours += 1;
            assert.equal(fourth.scenarioId, 'spiessrutenlauf');
            assert.equal(fourth.mapKey, 'mirror_docks');
            assert.equal(fourth.combatProfile, 'hunt');
        } else {
            regularParcours += 1;
            assert.equal(fourth.combatProfile, undefined);
        }
        assert.equal(finale.isBoss, true);
        assert.equal(finale.bossMultiplier, 2);
        for (const sectorNumber of laterSlotCounts.keys()) {
            const entry = plan.sequence[sectorNumber - 1];
            const counts = laterSlotCounts.get(sectorNumber);
            counts[entry.scenarioId ? 'scenario' : 'regular'] += 1;
        }

        const scenario = scenarioById(third.scenarioId);
        assert.ok(scenario && scenario.slot === 'sector', `${seed}: sector 3 is a sector scenario`);
        assert.equal(third.mapKey, scenario.mapKey);
        assert.equal(third.mapKeyLocked, true);
        assert.equal(third.modifierId, null, 'a scenario brings its own rules instead of a modifier');
        assert.equal(third.objectiveId, scenario.objective.id);
        assert.equal(third.templateId, 'sector_pressure', 'score base and missions follow the slot');
        assert.equal(resolveMapSequence(plan, seed, MAP_PRESET_CATALOG)[2], scenario.mapKey);
    }
    assert.ok(scenarioParcours > 0 && regularParcours > 0, 'the scenario is occasional and leaves the map pool reachable');
    for (const [sectorNumber, counts] of laterSlotCounts) {
        assert.ok(counts.scenario > 0 && counts.regular > 0, `sector ${sectorNumber} keeps an independent occasional scenario cadence`);
    }
});

test('daily plans keep the v1 scenario pool and do not consume new slot randomness', () => {
    const plan = buildArcadeSectorPlan({ seed: 'daily-compatibility', sectorCount: 12, dailyChallenge: true });
    assert.equal(plan.sequence.some((entry) => ['spiessrutenlauf', 'bomber_alarm'].includes(entry.scenarioId)), false);
    assert.equal(plan.sequence.some((entry) => entry.parcoursEnabled && entry.scenarioId), false);
    assert.deepEqual(plan, buildArcadeSectorPlan({ seed: 'daily-compatibility', sectorCount: 12, dailyChallenge: true }));
    const legacySeeds = [
        { seed: 4, scenarios: [null, null, 'worm_hunt', null, 'hydra_finale'], maps: ['crossfire', 'standard', 'standard', 'chrono_spillway', 'hydra_temple'] },
        { seed: 6, scenarios: [null, null, 'storm_flood', null, null], maps: ['crossfire', 'foam_forest', 'storm_dam_siege', 'parcours_rift_sprint', 'neon_abyss'] },
    ];
    for (const expected of legacySeeds) {
        const actual = buildArcadeSectorPlan({ seed: expected.seed, sectorCount: 5, dailyChallenge: true }).sequence;
        assert.deepEqual(actual.map((entry) => entry.scenarioId || null), expected.scenarios);
        assert.deepEqual(actual.map((entry) => entry.mapKey), expected.maps);
    }
    const runtimePlan = buildArcadeEncounterPlan({
        arcade: { seed: 'daily-compatibility', sectorCount: 12, dailyChallenge: true },
        session: { mapKey: 'standard' },
    });
    assert.equal(runtimePlan.sequence.some((entry) => ['spiessrutenlauf', 'bomber_alarm'].includes(entry.scenarioId)), false);
});

test('the finale is sometimes a boss scenario, decided by the seed alone', () => {
    const finales = new Set();
    for (let index = 0; index < 24; index += 1) {
        const seed = `finale-${index}`;
        const boss = planFor(seed).sequence[4];
        assert.deepEqual(boss, planFor(seed).sequence[4], 'same seed, same finale');
        assert.equal(boss.isBoss, true);
        if (boss.scenarioId) {
            assert.equal(scenarioById(boss.scenarioId).slot, 'finale');
            assert.equal(boss.mapKeyLocked, true);
        }
        finales.add(boss.scenarioId || 'classic');
    }
    assert.ok(finales.has('classic') && finales.has('hydra_finale'), [...finales].join(','));
    assert.equal(planFor('short', 2).sequence.some((entry) => entry.scenarioId), false, 'short runs stay plain');
});

test('a scenario sector flies with hunt weapons and its own bot count', () => {
    const worm = scenarioById('worm_hunt');
    const profile = resolveArcadeSectorRuntimeProfile(
        { sectorNumber: 3, templateId: 'sector_pressure', scenarioId: 'worm_hunt', squadId: worm.squadId, combatProfile: worm.combatProfile, botCount: worm.botCount, pressure: 0.5 },
        { mapKey: worm.mapKey, fallbackBotCount: 7 },
    );
    assert.equal(profile.combatProfile, 'hunt');
    assert.equal(profile.scenarioId, 'worm_hunt');
    assert.equal(profile.botCount, worm.botCount ?? 2);

    const plain = resolveArcadeSectorRuntimeProfile({ sectorNumber: 2, squadId: 'scout_duo' }, { mapKey: 'standard' });
    assert.equal(plain.combatProfile, '', 'normal sectors keep the arcade weapons');
    assert.equal(plain.botCount, 2);

    assert.equal(resolveArcadeRunCombatProfile('gauntlet', 'hunt'), 'hunt');
    assert.equal(resolveArcadeRunCombatProfile('gauntlet', ''), '');
    assert.equal(resolveArcadeRunCombatProfile('gauntlet', 'rockets'), '');
});

test('parcours turrets activate only for the Spießrutenlauf scenario', () => {
    const strategy = {
        modeType: 'ARCADE',
        getPickupModeType: () => 'HUNT',
        isSectorParcours: () => true,
        allowsParcoursScenarioTurrets: () => false,
    };
    assert.equal(isTurretCombatActive(strategy, ['ARCADE']), false, 'ordinary time trials remain combat-free');
    strategy.allowsParcoursScenarioTurrets = () => true;
    assert.equal(isTurretCombatActive(strategy, ['ARCADE']), true, 'the selected scenario can activate its map turrets');
    assert.equal(isTurretCombatActive({ ...strategy, modeType: 'CLASSIC' }, ['ARCADE']), false, 'the exception does not bypass allowed modes');
});

test('the turret exception clears when an Arcade strategy is reused', () => {
    const strategy = new ArcadeModeStrategy();
    strategy.setScenarioId('spiessrutenlauf');
    assert.equal(strategy.allowsParcoursScenarioTurrets(), true);
    strategy.cleanup();
    assert.equal(strategy.allowsParcoursScenarioTurrets(), false);
});

test('Bomberalarm carries one bomber through the sector profile into map-unit startup', () => {
    const scenario = scenarioById('bomber_alarm');
    const profile = resolveArcadeSectorRuntimeProfile({
        sectorNumber: 3,
        scenarioId: scenario.id,
        mapUnits: scenario.mapUnits,
        mapUnitsMode: scenario.mapUnitsMode,
        combatProfile: scenario.combatProfile,
        objectiveId: scenario.objective.id,
        objective: scenario.objective,
    }, { mapKey: scenario.mapKey, fallbackBotCount: 2 });
    assert.equal(profile.scenarioId, 'bomber_alarm');
    assert.equal(profile.mapUnits.length, 1);
    assert.equal(profile.mapUnits[0].kind, 'bomber');

    const runtimeConfig = createRuntimeConfigSnapshot({ mapKey: 'standard', numBots: 2, winsNeeded: 1 });
    const bundle = createGameRuntimeBundle({ state: { runtimeConfig, entityManager: {} } });
    const facadeContext = {
        getRuntimeState: () => bundle.state,
        getRuntimeBundle: () => bundle,
    };
    GameRuntimeFacade.prototype._applyArcadeSectorRuntimeProfile.call(facadeContext, profile);
    assert.equal(bundle.state.runtimeConfig.arcade.scenarioId, 'bomber_alarm');
    assert.equal(bundle.state.runtimeConfig.arcade.scenarioMapUnitsMode, 'replace');

    const manager = {
        runtimeConfig: { arcade: { scenarioMapUnits: profile.mapUnits, scenarioMapUnitsMode: profile.mapUnitsMode } },
        gameModeStrategy: { modeType: 'ARCADE', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: MAP_PRESET_CATALOG.standard },
        players: [],
    };
    const system = new MapUnitSystem(manager);
    try {
    assert.equal(system.startRound(), 1);
        assert.equal(system.units[0].kind, 'bomber');
        assert.equal(system.units[0].id, 'arcade_bomber_alarm');
    } finally {
        system.dispose();
    }
});

test('scenario units take precedence and an overlay remains within the map-unit cap', () => {
    const mapUnits = Array.from({ length: MAP_UNIT_LIMITS.maxUnits }, (_, index) => ({
        id: `authored_${index}`, kind: 'tank', path: [[index * 3, 20, 0], [index * 3 + 1, 20, 0]],
    }));
    const scenarioUnit = { id: 'scenario_unit', kind: 'bomber', path: [[0, 24, 0], [20, 24, 0]] };
    const manager = {
        runtimeConfig: { arcade: { scenarioMapUnits: [scenarioUnit], scenarioMapUnitsMode: 'overlay' } },
        gameModeStrategy: { modeType: 'ARCADE', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits } },
        players: [],
    };
    const system = new MapUnitSystem(manager);
    try {
        assert.equal(system.startRound(), MAP_UNIT_LIMITS.maxUnits);
        assert.equal(system.units[0].id, 'scenario_unit', 'scenario targets retain priority at the shared cap');
    } finally {
        system.dispose();
    }
});

test('an empty replace scenario does not reactivate authored map units', () => {
    const manager = {
        runtimeConfig: { arcade: { scenarioMapUnits: [{}], scenarioMapUnitsMode: 'replace' } },
        gameModeStrategy: { modeType: 'ARCADE', getPickupModeType: () => 'HUNT' },
        arena: { bounds: { min: { y: 0 } }, currentMapDefinition: { mapUnits: [{
            id: 'authored_enemy', kind: 'tank', path: [[0, 20, 0], [10, 20, 0]],
        }] } },
        players: [],
    };
    const system = new MapUnitSystem(manager);
    try {
        assert.equal(system.startRound(), 0);
    } finally {
        system.dispose();
    }
});

test('destroy_units counts only the named kind, holds the round and ends it on success', () => {
    const entry = { objectiveId: 'destroy_units', objective: { unitKind: 'creature', count: 2, durationSec: 60, scoreWeight: 1.4 } };
    const definition = resolveArcadeSectorObjectiveDefinition(null, entry);
    const initial = createArcadeObjectiveState(definition, { sectorIndex: 3 });
    assert.equal(initial.progressText, 'Kreatur 0/2 · 60 s');
    assert.equal(doesArcadeObjectiveHoldRound(initial), true);

    const tank = updateArcadeObjectiveState(initial, { type: 'unit_destroyed', unitKind: 'tank', count: 1 });
    assert.equal(tank.unitsDestroyed, 0, 'a tank is not the creature we hunt');
    const one = updateArcadeObjectiveState(tank, { type: 'unit_destroyed', unitKind: 'creature', count: 1 });
    assert.equal(one.completed, false);
    const done = updateArcadeObjectiveState(one, { type: 'unit_destroyed', unitKind: 'creature', count: 1 });
    assert.equal(done.completed, true);
    assert.equal(done.shouldEnd, true);
    assert.equal(done.scoreWeight, 1.4);
    const bomberHit = updateArcadeObjectiveState({ ...initial, elapsedSec: 59.9 }, { type: 'unit_disabled', unitKind: 'creature', count: 2 });
    assert.equal(bomberHit.completed, true, 'a lethal bomber hit satisfies the target before its crash animation finishes');
    assert.equal(doesArcadeObjectiveHoldRound(done), false);
});

test('destroy_units ends the sector without its bonus when time runs out, unless it has no limit', () => {
    const timed = createArcadeObjectiveState(resolveArcadeSectorObjectiveDefinition(null, {
        objectiveId: 'destroy_units', objective: { unitKind: 'creature', count: 1, durationSec: 30 },
    }));
    const expired = updateArcadeObjectiveState(timed, { type: 'tick', elapsed: 30 });
    assert.equal(expired.failed, true);
    assert.equal(expired.shouldEnd, true, 'a sector without bots would otherwise never end');
    assert.equal(doesArcadeObjectiveHoldRound(expired), false);

    const endless = createArcadeObjectiveState(resolveArcadeSectorObjectiveDefinition(null, {
        objectiveId: 'destroy_units', objective: { unitKind: 'creature', count: 1, durationSec: 0 },
    }));
    const late = updateArcadeObjectiveState(endless, { type: 'tick', elapsed: 900 });
    assert.equal(late.failed, false);
    assert.equal(late.progressText, 'Kreatur 0/1');
    assert.equal(doesArcadeObjectiveHoldRound(createArcadeObjectiveState({ id: 'survive_window', durationSec: 55 })), true);
});

test('scenario parameters override the shared objective definition', () => {
    const base = { id: 'survive_window', label: 'Survive Window', durationSec: 55, scoreWeight: 1 };
    const merged = resolveArcadeSectorObjectiveDefinition(base, {
        objectiveId: 'survive_window', objective: { durationSec: 90, scoreWeight: 1.3 },
    });
    assert.deepEqual({ ...merged }, { id: 'survive_window', label: 'Survive Window', durationSec: 90, scoreWeight: 1.3 });
    assert.equal(resolveArcadeSectorObjectiveDefinition(base, { objectiveId: 'survive_window' }), base);
    assert.equal(resolveArcadeSectorObjectiveDefinition(null, { objectiveId: 'bounty_hunt' }), null);
});

test('the intermission offers no alternative route into a scenario sector', () => {
    const scenarioEntry = { sectorNumber: 3, templateId: 'sector_pressure', scenarioId: 'worm_hunt', objectiveId: 'destroy_units', modifierId: null, mapKey: 'standard', mapKeyLocked: true };
    const runtime = {
        _state: { mapSequence: ['crossfire', 'maze', 'standard'] },
        _activeModifierId: 'heat_stress',
        _getEncounterSectorEntry: () => scenarioEntry,
    };
    const choices = buildArcadeIntermissionChoices(runtime, 3);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].mapKey, 'standard');
    assert.equal(choices[0].modifierId, null, 'the last sector modifier does not leak into the scenario');
});

test('the intermission briefs the next scenario instead of listing a modifier', () => {
    const scenarioEntry = { sectorNumber: 3, templateId: 'sector_pressure', scenarioId: 'worm_hunt', scenarioLabel: 'Wurmjagd', briefing: 'Der Riesenwurm ist erwacht.', objectiveId: 'destroy_units', modifierId: null };
    const runtime = {
        _state: { completedSectors: 2, mapSequence: ['crossfire', 'maze', 'standard'] },
        _ensureEncounterSectorEntry: () => scenarioEntry,
        _getEncounterSectorEntry: () => scenarioEntry,
    };
    const preview = prepareArcadeIntermissionState(runtime, 1000).nextSectorPreview;
    assert.equal(preview.scenarioLabel, 'Wurmjagd');
    assert.equal(preview.briefing, 'Der Riesenwurm ist erwacht.');

    const texts = JSON.stringify(createArcadeNextSectorBlock(preview));
    assert.match(texts, /Einsatz: Wurmjagd/);
    assert.match(texts, /Der Riesenwurm ist erwacht\./);
    assert.doesNotMatch(texts, /Modifier/);
    assert.match(JSON.stringify(createArcadeNextSectorBlock({ mapKey: 'maze' })), /Modifier/, 'regular sectors keep their rows');
});

test('a destroyed map unit reaches the arcade run for every run type', () => {
    const events = [];
    const entityManager = {
        runtimeConfig: { arcade: { enabled: true, runType: 'gauntlet' } },
        gameModeStrategy: { runtimeRng: { next: () => 0.5 } },
        powerupManager: { spawnAtAnchor: () => ({}) },
        _huntScoring: { registerUnitDestroyed: () => {} },
        _notifyPlayerFeedback: () => {},
        onArcadeGameplayEvent: (event) => events.push(event),
    };
    const unit = {
        id: 'standard_giant_worm', deaths: 1, definition: { kind: 'creature', loot: {} },
        position: { x: 0, y: 0, z: 0 }, groundPosition: { x: 0, y: 0, z: 0 },
    };
    rewardMapUnitDestruction({ entityManager }, unit, { index: 0, isBot: false });
    rewardMapUnitDestruction({ entityManager }, unit, { index: 2, isBot: true });
    assert.deepEqual(events, [{ type: 'unit_destroyed', playerIndex: 0, count: 1, unitKind: 'creature' }]);
});

test('the storm flood scenario opens the dam on its clock although the wall stays intact', () => {
    const flood = scenarioById('storm_flood');
    assert.equal(flood.waterZoneTriggerSec, 20);
    const profile = resolveArcadeSectorRuntimeProfile({ sectorNumber: 3, waterZoneTriggerSec: flood.waterZoneTriggerSec }, { mapKey: flood.mapKey });
    assert.equal(profile.waterZoneTriggerSec, 20);

    const owner = {
        arena: { currentMapDefinition: MAP_PRESET_CATALOG[flood.mapKey] },
        renderer: { addToScene: () => {}, removeFromScene: () => {} },
        runtimeConfig: { arcade: { waterZoneTriggerSec: profile.waterZoneTriggerSec } },
    };
    const system = new WaterZoneSystem(owner);
    assert.equal(system.startRound(), true);
    system.update(19.5);
    assert.equal(system.getState().phase, WATER_PHASES.DRY, 'no flood before the clock');
    system.update(1);
    system.update(0);
    assert.equal(system.getState().phase, WATER_PHASES.WAVE);

    owner.runtimeConfig.arcade.waterZoneTriggerSec = 0;
    system.startRound();
    system.update(120);
    assert.equal(system.getState().phase, WATER_PHASES.DRY, 'without a scenario only a break floods the basin');
    system.clear();
});

test('survive_window holds round elimination until success, but human elimination still ends the round', () => {
    const human = { index: 0, isBot: false, alive: true };
    const bot = { index: 1, isBot: true, alive: false };
    const roundOutcome = new RoundOutcomeSystem({ getPlayers: () => [human, bot] });
    const entityManager = {
        humanPlayers: [human],
        _roundOutcomeSystem: roundOutcome,
        requestRoundEnd: (request) => roundOutcome.requestRoundEnd(request),
    };
    const runtime = {
        _state: {
            objectiveState: createArcadeObjectiveState({ id: 'survive_window', durationSec: 90 }),
        },
        _requestRoundEnd: (request) => requestObjectiveRoundEnd(entityManager, request),
    };

    syncArcadeObjectiveIntoEntities(entityManager, runtime._state.objectiveState);
    assert.equal(doesArcadeObjectiveHoldRound(runtime._state.objectiveState), true);
    assert.equal(roundOutcome.resolve().shouldEnd, false, 'an empty enemy roster cannot end an active 90s window');

    updateArcadeObjectiveRuntimeState(runtime, { type: 'tick', elapsed: 89 });
    syncArcadeObjectiveIntoEntities(entityManager, runtime._state.objectiveState);
    assert.equal(runtime._state.objectiveState.status, 'active');
    assert.equal(roundOutcome.resolve().shouldEnd, false, 'the objective is still running before its deadline');

    updateArcadeObjectiveRuntimeState(runtime, { type: 'tick', elapsed: 90 });
    syncArcadeObjectiveIntoEntities(entityManager, runtime._state.objectiveState);
    const success = roundOutcome.resolve();
    assert.equal(runtime._state.objectiveState.completed, true);
    assert.equal(doesArcadeObjectiveHoldRound(runtime._state.objectiveState), false);
    assert.equal(success.shouldEnd, true);
    assert.equal(success.winner, human);
    assert.equal(success.reason, 'ARCADE_OBJECTIVE');

    roundOutcome.reset();
    assert.equal(roundOutcome.resolve().shouldEnd, true, 'a round reset clears the previous objective hold');

    human.alive = false;
    const bots = [
        { index: 1, isBot: true, alive: true },
        { index: 2, isBot: true, alive: true },
    ];
    const strategy = new ArcadeModeStrategy();
    const arcadeRun = new ArcadeRunRuntime({ strategy, now: () => 100000 });
    arcadeRun.configure({ arcade: { enabled: true, seed: 5, sectorCount: 3 } });
    const encounterPlan = buildArcadeSectorPlan({ seed: 5, sectorCount: 3 });
    encounterPlan.sequence[0] = {
        ...encounterPlan.sequence[0],
        objectiveId: 'survive_window',
        objective: { id: 'survive_window', label: 'Sturmflut', durationSec: 90, scoreWeight: 1.3 },
    };
    arcadeRun.startRun({ strategy, encounterPlan });
    assert.equal(arcadeRun.getStateSnapshot().objectiveState.objectiveId, 'survive_window');
    assert.equal(arcadeRun.getStateSnapshot().objectiveState.status, 'active');

    const lossRoundOutcome = new RoundOutcomeSystem({ getPlayers: () => [human, ...bots] });
    const lossEntityManager = { _roundOutcomeSystem: lossRoundOutcome };
    syncArcadeObjectiveIntoEntities(lossEntityManager, arcadeRun.getStateSnapshot().objectiveState);
    const loss = lossRoundOutcome.resolve();
    assert.equal(loss.shouldEnd, true, 'all human pilots out still ends with two bots alive');
    assert.equal(loss.reason, 'ELIMINATION');
    const defeatPlan = arcadeRun.deriveRoundEndPlan({
        players: [human, ...bots],
        inputs: { reason: loss.reason },
        baseController: {},
    });
    assert.equal(defeatPlan.outcome.state, 'MATCH_END');
    assert.equal(defeatPlan.outcome.reason, 'ELIMINATION');
    assert.equal(arcadeRun.getPhase(), 'finished');
    assert.equal(defeatPlan.outcome.arcade.phase, 'finished');
    assert.equal(arcadeRun.getStateSnapshot().objectiveState.completed, false);
});
