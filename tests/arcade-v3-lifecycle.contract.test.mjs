import { createSectorMissionState, createMissionInstance } from '../src/state/arcade/ArcadeMissionState.js';
import { createArcadeObjectiveState } from '../src/state/arcade/ArcadeObjectiveState.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY, LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolvePlayerScopedStorageKey } from '../src/shared/contracts/PlayerProfileStorageContract.js';
import { applyParcoursLeaderboardEvent } from '../src/core/arcade/ArcadeParcoursLeaderboardOps.js';

function fixture({ dailyChallenge = false, sectorCount = 2, records = new Map() } = {}) {
    let wall = 100000;
    const store = { loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; } };
    const strategy = new ArcadeModeStrategy();
    const runtime = new ArcadeRunRuntime({ settingsManager: { getPlayerRecordStorePort: () => store },
        now: () => wall, strategy, arcadePersistenceSaveThrottleMs: 0, ghostLibrarySaveThrottleMs: 0 });
    runtime.configure({ arcade: { enabled: true, dailyChallenge, seed: 5, sectorCount } });
    runtime.setActiveVehicle('ship5');
    runtime.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 5, sectorCount }) });
    const players = [{ index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 }];
    const finishSector = (input = {}) => {
        const plan = runtime.deriveRoundEndPlan({ players, inputs: input, baseController: {} });
        if (plan) runtime.handleRoundEndTelemetry({ state: plan.outcome.state, duration: 20, kills: 1 });
        return plan;
    };
    return { runtime, strategy, records, store, players, finishSector, advanceWall: () => { wall += 1000000; } };
}

test('victory waits explicitly; continuation keeps vitals, run id and escalating sudden death', () => {
    const f = fixture();
    const id = f.runtime.getStateSnapshot().runId;
    f.finishSector();
    f.runtime.beginNextSector();
    f.finishSector();
    assert.equal(f.runtime.getPhase(), 'victory');
    const controller = new ArcadeRoundStateController({ arcadeRuntime: f.runtime, baseController: new RoundStateController() });
    assert.equal(controller.deriveRoundEndTick({ dt: 50, roundPause: 10, enterPressed: true }).action, 'WAIT');
    assert.equal(f.runtime.beginNextSector().phase, 'victory');
    const score = f.runtime.getStateSnapshot().score.total;
    assert.equal(f.runtime.resolveVictoryChoice('continue').nextState, 'ROUND_END');
    assert.equal(f.runtime.resolveVictoryChoice('continue'), null);
    f.runtime.beginNextSector();
    f.players[0].hp = 100;
    const healing = f.runtime.applyPendingIntermissionEffects({ players: f.players });
    assert.equal(healing.playersRestored, 1);
    assert.ok(f.players[0].hp < 100);
    assert.equal(f.runtime.applyPendingIntermissionEffects({ players: f.players }), null);
    assert.equal(f.runtime.getStateSnapshot().runId, id);
    assert.equal(f.runtime.getStateSnapshot().score.total, score);
    assert.equal(f.runtime.getPhase(), 'sudden_death');
    f.runtime.tickGameplay(65); f.strategy.tickSuddenDeath(65);
    f.finishSector(); f.runtime.beginNextSector();
    const replacement = new ArcadeModeStrategy(); f.runtime.setStrategy(replacement);
    assert.equal(replacement.getSuddenDeathState().stackedModifiers.length, 2);
    f.runtime.resetRunState();
});

test('escape on the victory panel goes back to the menu like on every other board', () => {
    const f = fixture();
    f.finishSector(); f.runtime.beginNextSector(); f.finishSector();
    assert.equal(f.runtime.getPhase(), 'victory');
    const controller = new ArcadeRoundStateController({ arcadeRuntime: f.runtime, baseController: new RoundStateController() });
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 10 }).action, 'WAIT');
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 10, escapePressed: true }).action, 'RETURN_TO_MENU');
    f.runtime.resetRunState();
});

test('held countdown retains rest time and confirmation starts exactly once', () => {
    const f = fixture(); f.finishSector(); f.runtime.setIntermissionPaused(true);
    const controller = new ArcadeRoundStateController({ arcadeRuntime: f.runtime, baseController: new RoundStateController() });
    const held = controller.deriveRoundEndTick({ dt: 2, roundPause: 7 });
    assert.equal(held.nextRoundPause, 7); assert.equal(held.action, 'WAIT');
    f.runtime.setIntermissionPaused(false);
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 7, enterPressed: true }).action, 'WAIT');
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 0 }).action, 'START_ROUND');
    assert.equal(f.runtime.getStateSnapshot().sectorIndex, 2);
    f.runtime.resetRunState();
});

test('active time pauses with intermission; repeated telemetry never duplicates XP', () => {
    const f = fixture(); f.runtime.applyGameplayEvent({ type: 'kill' });
    f.runtime.tickGameplay(1); f.finishSector();
    const before = f.runtime.getStateSnapshot();
    f.advanceWall(); f.runtime.tickGameplay(100);
    f.runtime.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 20, kills: 1 });
    const after = f.runtime.getStateSnapshot();
    assert.equal(after.gameplayTimeMs, before.gameplayTimeMs);
    assert.equal(after.score.total, before.score.total);
    assert.equal(after.xpEarned, before.xpEarned);
    f.runtime.resetRunState();
});

test('Daily freezes the boss result once and excludes later bonus points; no mastery bonus', () => {
    const f = fixture({ dailyChallenge: true, sectorCount: 1 });
    f.runtime._vehicleProfiles.ship5 = { ...f.runtime.getVehicleProfile(), level: 30, xp: 999999, hangarBonuses: { maxHpBonus: 50 } };
    f.runtime.setStrategy(f.strategy);
    f.strategy.resetPlayerHealth(f.players[0]);
    assert.equal(f.players[0].maxHp, 100);
    assert.equal(f.runtime.applyParcoursXpEvent('checkpoint').earned, 10);
    f.finishSector();
    const result = structuredClone(f.runtime.getMenuSurfaceState().dailyResult);
    assert.equal(result.attempt, 1);
    assert.equal(f.records.get(ARCADE_RUN_PROFILE_STORAGE_KEY).daily.runsPlayed, 1);
    f.runtime.resolveVictoryChoice('continue'); f.runtime.beginNextSector(); f.finishSector();
    f.players[0].alive = false; f.players[0].hp = 0; f.runtime.beginNextSector(); f.finishSector();
    assert.deepEqual(f.runtime.getPostRunSummary().dailyResult, result);
    assert.ok(f.runtime.getPostRunSummary().bonusScore > 0);
    assert.equal(f.runtime.getRecordsSnapshot().daily.runsPlayed, 1);
    assert.equal(f.runtime.getRecordsSnapshot().runsPlayed, 1);
    f.runtime.handleMatchEndTelemetry({ state: 'MATCH_END' });
    assert.equal(f.runtime.getRecordsSnapshot().runsPlayed, 1);
});

test('legacy records remain untouched and profile-scoped v3 records cannot overwrite them', () => {
    const legacy = { schemaVersion: 'arcade-run-profile.v2', scoreModel: 'arcade-score.v2', bestScore: 99999, runsPlayed: 12 };
    const records = new Map([[LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, legacy]]);
    const f = fixture({ sectorCount: 1, records }); f.finishSector(); f.runtime.resolveVictoryChoice('finish');
    assert.deepEqual(records.get(LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY), legacy);
    assert.equal(f.runtime.getMenuSurfaceState().legacyRecords.bestScore, 99999);
    assert.ok(f.runtime.getRecordsSnapshot().bestScore < 99999);
    assert.notEqual(resolvePlayerScopedStorageKey('pilot', ARCADE_RUN_PROFILE_STORAGE_KEY), resolvePlayerScopedStorageKey('pilot', LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY));
});

test('a one-sector parcours wins and scores its own results only once', () => {
    const f = fixture({ sectorCount: 1 });
    f.runtime._state.encounterSequence[0] = { templateId: 'sector_parcours', parcoursEnabled: true };
    f.runtime._applySectorType(1);
    const input = { reason: 'PARCOURS_COMPLETE', parcours: { checkpointCount: 10, completionTimeMs: 30000 } };
    f.finishSector(input);
    assert.equal(f.runtime.getPhase(), 'victory');
    assert.equal(f.runtime.getStateSnapshot().lastSectorSummary.breakdown.survival, 0);
    assert.equal(f.runtime.completeParcoursSector(input), null);
    f.runtime.resolveVictoryChoice('finish');
});

function clip(seconds) { return { frames: [
    { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0 }] },
    { time: seconds, players: [{ idx: 0, x: 10, y: 0, z: 10 }] },
], players: [{ idx: 0, color: 0xffffff }], sourceDuration: seconds, displayDuration: seconds }; }

test('best-time ghost does not fall back to a slower clip and equal times can supply a missing clip', () => {
    const f = fixture(); f.runtime._config.ghostDuelMode = 'self_best_time_ghost';
    f.runtime._leaderboard = { route: [{ totalTimeMs: 10000, ghostClip: null }, { totalTimeMs: 20000, ghostClip: clip(20) }] };
    let played = null; f.runtime.setGhostPlaybackHandler(value => { played = value; });
    const start = () => applyParcoursLeaderboardEvent(f.runtime, { type: 'ghost_start', routeId: 'alias', routeAliases: ['route'] });
    assert.equal(start().reason, 'best_ghost_not_found'); assert.equal(played, null);
    applyParcoursLeaderboardEvent(f.runtime, { type: 'finish', routeId: 'route', routeAliases: ['alias'], totalTimeMs: 10000, ghostClip: clip(10) });
    assert.equal(start().started, true); assert.equal(played.sourceDuration, 10);
    assert.equal(applyParcoursLeaderboardEvent(f.runtime, { type: 'ghost_start', routeId: 'alias' }).started, true);
    f.runtime._leaderboard.route[0].ghostClip = { invalid: true };
    assert.equal(start().started, false);
    f.runtime.resetRunState();
});


test('failed Daily persistence retries the same frozen result without adding an attempt', () => {
    const f = fixture({ dailyChallenge: true, sectorCount: 1 });
    const save = f.store.saveJsonRecord;
    f.store.saveJsonRecord = () => ({ success: false, reason: 'quota' });
    f.finishSector();
    const frozen = structuredClone(f.runtime.getMenuSurfaceState().dailyResult);
    assert.equal(frozen.succeeded, true);
    assert.equal(f.records.has(ARCADE_RUN_PROFILE_STORAGE_KEY), false);
    f.runtime.handleRoundEndTelemetry({ state: 'ROUND_END' });
    f.store.saveJsonRecord = save;
    f.runtime.flushPersistenceSaves();
    assert.equal(f.records.get(ARCADE_RUN_PROFILE_STORAGE_KEY).daily.runsPlayed, 1);
    assert.deepEqual(f.runtime.getMenuSurfaceState().dailyResult, frozen);
    f.runtime.resolveVictoryChoice('finish');
    assert.equal(f.records.get(ARCADE_RUN_PROFILE_STORAGE_KEY).daily.runsPlayed, 1);
});

test('death before completion records a failed Daily and cannot produce victory', () => {
    const f = fixture({ dailyChallenge: true });
    f.players[0].hp = 0; f.players[0].alive = false;
    f.finishSector({ reason: 'PARCOURS_COMPLETE', parcours: { completionTimeMs: 30000 } });
    assert.equal(f.runtime.getPhase(), 'finished');
    assert.equal(f.runtime.getStateSnapshot().victory, null);
    assert.equal(f.runtime.getMenuSurfaceState().dailyResult.succeeded, false);
    assert.equal(f.runtime.getRecordsSnapshot().daily.lastCompletedSectors, 0);
    assert.equal(f.runtime.resolveVictoryChoice('continue'), null);
});

test('profile reload isolates old and new scores while malformed new records stay empty', () => {
    const first = fixture({ sectorCount: 1 }); first.finishSector(); first.runtime.resolveVictoryChoice('finish');
    const firstScore = first.runtime.getRecordsSnapshot().bestScore;
    first.runtime.resetRunState();
    const secondRecords = new Map([[ARCADE_RUN_PROFILE_STORAGE_KEY, { broken: true }],
        [LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, { scoreModel: 'arcade-score.v2', bestScore: 1234 }]]);
    const second = fixture({ records: secondRecords });
    assert.equal(second.runtime.getRecordsSnapshot().bestScore, 0);
    assert.equal(second.runtime.getMenuSurfaceState().legacyRecords.bestScore, 1234);
    assert.equal(first.records.get(ARCADE_RUN_PROFILE_STORAGE_KEY).bestScore, firstScore);
    second.runtime.resetRunState();
});

test('a pending session rebuild dispatches only one next-round action', () => {
    const f = fixture(); f.finishSector();
    const controller = new ArcadeRoundStateController({ arcadeRuntime: f.runtime, baseController: new RoundStateController() });
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 0 }).action, 'START_ROUND');
    assert.equal(controller.deriveRoundEndTick({ dt: 0, roundPause: 0 }).action, 'WAIT');
    f.runtime.resetRunState();
});


test('synchronous objective completion includes the final mission in the frozen Daily result', () => {
    const f = fixture({ dailyChallenge: true, sectorCount: 1 });
    f.runtime._missionState = createSectorMissionState([createMissionInstance('SURVIVE_DURATION', { target: 5 })]);
    f.runtime._state.objectiveState = createArcadeObjectiveState({ id: 'survive_window', durationSec: 5 });
    let requests = 0;
    f.runtime._requestRoundEnd = () => { requests += 1; f.finishSector(); return true; };
    f.runtime.tickGameplay(5);
    assert.equal(requests, 1);
    assert.equal(f.runtime.getPhase(), 'victory');
    assert.equal(f.runtime.getMissionState().completedCount, 1);
    assert.equal(f.runtime.getStateSnapshot().lastSectorSummary.missionBonus, 500);
    assert.equal(f.runtime.getMenuSurfaceState().dailyResult.score, f.runtime.getStateSnapshot().score.total);
    f.runtime.resolveVictoryChoice('finish');
});
