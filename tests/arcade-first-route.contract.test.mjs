import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArcadeEncounterPlan, resolveArcadeSectorTransition } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { createArcadeRunConfig } from '../src/state/arcade/ArcadeRunState.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { evaluateArcadeJourneyMedal } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';
import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

registerMapCatalogConfigSource({ MAPS: { standard: {}, ...PARCOURS_MAPS } });

const arcade = (overrides = {}) => ({ enabled: true, runType: 'gauntlet', journeyStageId: 'first_run', seed: 8, sectorCount: 20, ...overrides });
const plan = overrides => buildArcadeEncounterPlan({ arcade: arcade(overrides), session: { mapKey: 'empty' } });
const human = { index: 0, isBot: false, alive: true, hp: 100 };

test('the first route has exactly three locked Rift sectors with only the middle sector weaponless', () => {
    for (const seed of [1, 8, 99, 18492]) {
        const value = plan({ seed });
        assert.equal(value.sectorCount, 3);
        assert.equal(value.sequence.length, 3);
        value.sequence.forEach((entry, index) => {
            assert.equal(entry.mapKey, 'parcours_rift'); assert.equal(entry.mapKeyLocked, true);
            assert.equal(entry.sectorNumber, index + 1); assert.equal(entry.parcoursEnabled, true);
            assert.equal(entry.objectiveId, 'parcours_run'); assert.equal(entry.isBoss, false);
            assert.equal(entry.scenarioId, undefined); assert.equal(entry.weaponsDisabled, index === 1);
            assert.equal(entry.combatProfile, index === 1 ? '' : 'hunt');
        });
        assert.deepEqual(value.sequence, plan({ seed: 8 }).sequence);
    }
});

test('the authored count applies at both settings boundaries and does not leak into free or Daily runs', () => {
    for (const normalize of [normalizeArcadeRunSettings, createArcadeRunConfig]) {
        assert.equal(normalize(arcade()).sectorCount, 3);
        for (const other of [{ dailyChallenge: true }, { journeyStageId: '' }, { runType: 'arena_waves' }]) {
            assert.equal(normalize(arcade(other)).sectorCount, 20);
        }
    }
    for (const other of [{ dailyChallenge: true }, { runType: 'arena_waves' }]) {
        assert.deepEqual(plan(other), plan({ ...other, journeyStageId: '' }));
    }
});

test('weaponless runtime profiles force a session rebuild in both directions even on the same map', () => {
    const profiles = plan().sequence.map(entry => resolveArcadeSectorRuntimeProfile(entry));
    assert.deepEqual(profiles.map(p => p.weaponsDisabled), [false, true, false]);
    assert.deepEqual(profiles.map(p => p.botCount), [1, 1, 1]);
    const config = { arcade: { combatProfile: '', weaponsDisabled: false }, session: { numBots: 1 } };
    assert.equal(resolveArcadeSectorTransition(profiles[1], config, 'parcours_rift').requiresSessionRebuild, true);
    assert.equal(resolveArcadeSectorTransition({ ...profiles[1], weaponsDisabled: false }, { ...config, arcade: { combatProfile: '', weaponsDisabled: true } }, 'parcours_rift').requiresSessionRebuild, true);
});

test('weaponless actions block rockets, MG, special guns and offensive item use without consuming inventory', () => {
    const calls = [];
    const manager = {
        _shootItemProjectile: () => calls.push('rocket'), _shootHuntGun: () => calls.push('MG'),
        _flamethrowerSystem: { fire: () => calls.push('flame') }, _railgunSystem: { fire: () => calls.push('rail') },
    };
    const phase = new PlayerActionPhase(manager);
    const player = { index: 0, inventory: ['ROCKET_TURRET'], rocketInventory: ['ROCKET_HEAVY'], useItem: () => calls.push('item') };
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet', combatProfile: 'hunt', weaponsDisabled: true });
    phase.run(player, { shootMG: true, shootRocket: true, shootItem: true, useItem: 0 }, strategy, 1 / 60);
    assert.deepEqual(calls, []);
    assert.deepEqual(player.inventory, ['ROCKET_TURRET']); assert.deepEqual(player.rocketInventory, ['ROCKET_HEAVY']);
    assert.equal(strategy.hasMachineGun(), false);
    assert.deepEqual(strategy.filterSpawnableTypes(['ROCKET_TURRET', 'ROCKET_HEAVY', 'SHIELD', 'SPEED_UP', 'EMP'], {}), ['SHIELD', 'SPEED_UP']);
    assert.equal(new ArcadeModeStrategy({ runType: 'gauntlet', combatProfile: 'hunt' }).hasMachineGun(), true);
});

test('the actual Rift rocket anchor obeys the weaponless filter while armed sectors retain its rocket', async () => {
    const anchor = PARCOURS_MAPS.parcours_rift.items.find(item => item.pickupType === 'ROCKET_WEAK');
    assert.ok(anchor);
    for (const weaponsDisabled of [false, true]) {
        const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
        const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {
            currentMapDefinition: PARCOURS_MAPS.parcours_rift, getAuthoredItemAnchors: () => [anchor],
            checkCollision: () => false, portals: [], specialGates: [],
        }, entityRuntimeConfig);
        manager._authoredModelCache.createModel = async () => null;
        manager.getStrategy = () => new ArcadeModeStrategy({ runType: 'gauntlet', combatProfile: 'hunt',
            weaponsDisabled, entityRuntimeConfig, random: () => 0 });
        try {
            manager._spawnRandom();
            assert.equal(manager.items.length, 1);
            if (weaponsDisabled) assert.ok(['SHIELD', 'SPEED_UP'].includes(manager.items[0].type), manager.items[0].type);
            else assert.equal(manager.items[0].type, 'ROCKET_WEAK');
            await Promise.resolve();
        } finally { manager.dispose(); }
    }
});

function startRun(overrides = {}) {
    let nowMs = 100000;
    const run = new ArcadeRunRuntime({ now: () => nowMs });
    run.configure({ arcade: arcade(overrides) });
    run.startRun({ encounterPlan: plan(overrides) });
    return { run, advance(ms) { nowMs += ms; run.tickGameplay(ms / 1000); } };
}
function finishSector(run, seconds = 64) {
    const result = run.deriveRoundEndPlan({ players: [human], inputs: { reason: 'PARCOURS_COMPLETE', parcours: {
        completionTimeMs: seconds * 1000, checkpointCount: 9, wrongOrderCount: 0, resetCount: 0, checkpointRespawnsUsed: 0,
    } }, baseController: new RoundStateController() });
    run.handleRoundEndTelemetry({ state: result.outcome.state, duration: seconds, kills: 0 });
    return result;
}

test('all three route goals lead directly to a scored mission result without a fourth sector or endless choice', () => {
    const { run, advance } = startRun();
    for (let sector = 1; sector <= 3; sector++) {
        advance(64000);
        const result = finishSector(run);
        assert.equal(result.outcome.state, sector === 3 ? 'MATCH_END' : 'ROUND_END');
        if (sector < 3) {
            assert.equal(run.getIntermissionState().choices.length, 1);
            assert.equal(run.getIntermissionState().choices[0].mapKey, 'parcours_rift');
            run.beginNextSector();
        }
    }
    const state = run.getStateSnapshot();
    assert.equal(state.phase, 'finished'); assert.equal(state.completedSectors, 3);
    assert.equal(state.encounterSequence.length, 3); assert.equal(state.intermission, null);
    assert.equal(state.postRunSummary.succeeded, true); assert.equal(state.postRunSummary.sectorHistory.length, 3);
    assert.equal(run.resolveVictoryChoice('continue'), null);
    assert.ok(state.postRunSummary.xpEarned > 0);
    assert.equal(evaluateArcadeJourneyMedal('first_run', { succeeded: true, value: state.postRunSummary.score }), 2);
});

test('a clean fast three-sector route can reach gold with the unchanged score formula', () => {
    const { run, advance } = startRun();
    for (let sector = 1; sector <= 3; sector++) {
        advance(32000); finishSector(run, 32);
        if (sector < 3) run.beginNextSector();
    }
    const summary = run.getStateSnapshot().postRunSummary;
    assert.equal(evaluateArcadeJourneyMedal('first_run', { succeeded: true, value: summary.score }), 3);
});

test('generic arena outcomes cannot clear the route; abort and defeat do not award a completion medal', () => {
    const { run } = startRun();
    assert.equal(run.deriveRoundEndPlan({ players: [human], inputs: { reason: 'ARCADE_OBJECTIVE' }, baseController: new RoundStateController() }), null);
    assert.equal(run.getStateSnapshot().completedSectors, 0);
    for (const [reason, players] of [['ABORT', [human]], ['ELIMINATION', [{ ...human, alive: false, hp: 0 }]]]) {
        const { run: candidate } = startRun();
        const outcome = candidate.deriveRoundEndPlan({ players, inputs: { reason }, baseController: new RoundStateController() });
        assert.equal(outcome.outcome.state, 'MATCH_END');
        candidate.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 1 });
        assert.equal(candidate.getStateSnapshot().postRunSummary.succeeded, false);
    }
});

test('free parcours runs retain their voluntary continuation after the last sector', () => {
    const { run } = startRun({ journeyStageId: '', sectorCount: 1 });
    run._state.encounterSequence[0] = { ...plan().sequence[0] };
    run._state.mapSequence = ['parcours_rift']; run._state.currentMapKey = 'parcours_rift'; run._applySectorType(1);
    const result = finishSector(run);
    assert.equal(result.outcome.state, 'ROUND_END'); assert.equal(run.getPhase(), 'victory');
    assert.equal(run.resolveVictoryChoice('continue').nextState, 'ROUND_END');
});
