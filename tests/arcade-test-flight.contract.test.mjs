import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeTestFlightRequest, readArcadeTestFlightRequest, isArcadeTestFlightBuildActive } from '../src/shared/contracts/ArcadeTestFlightContract.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { configureArcadeRunRuntime, buildArcadeEncounterPlan } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { finalizeArcadeRun } from '../src/core/arcade/ArcadeRunCompletionOps.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import { createPlayingStateRuntimeAccess, PlayingStateSystem } from '../src/core/PlayingStateSystem.js';

test('test flight refuses unactivated drafts, stale requests and another player profile', () => {
    const active = { vehicleId: 'ship5', slots: { core: 'standard' }, stoneSlots: { nose: 'damage' } };
    assert.equal(isArcadeTestFlightBuildActive({ ...active, name: 'Saved draft' }, active), true);
    assert.equal(isArcadeTestFlightBuildActive({ ...active, stoneSlots: { nose: 'range' } }, active), false);
    assert.equal(isArcadeTestFlightBuildActive({ ...active, vehicleId: 'arrow' }, active), false);
    assert.equal(createArcadeTestFlightRequest({ vehicleId: 'ship5', dirty: true }).ok, false);
    const { request } = createArcadeTestFlightRequest({ vehicleId: 'ship5', profileId: 'pilot', nowMs: 100 });
    assert.equal(readArcadeTestFlightRequest(request, 'pilot', 101).vehicleId, 'ship5');
    assert.equal(readArcadeTestFlightRequest(request, 'other', 101), null);
    assert.equal(readArcadeTestFlightRequest(request, 'pilot', 30101), null);
});

test('actual test-flight runtime grants no XP, records, ghosts, replay or difficulty unlocks and uses a combat sector', () => {
    let writes = 0;
    const store = { readJsonRecordResult: () => ({ status: 'missing' }), loadJsonRecord: (_key, fallback) => fallback, saveJsonRecord: () => { writes++; return true; } };
    const runtime = new ArcadeRunRuntime({ settingsManager: { getPlayerRecordStorePort: () => store }, now: () => 1000,
        replayRecorder: { startRecording: () => assert.fail('replay started') } });
    const config = { arcade: { enabled: true, runType: 'hangar_test', seed: 2, sectorCount: 1, replayHooksEnabled: true }, session: { mapKey: 'parcours_assault' } };
    configureArcadeRunRuntime(runtime, config);
    runtime.setActiveVehicle('ship5');
    const strategy = new ArcadeModeStrategy({ runType: 'hangar_test' });
    assert.equal(strategy.hasMachineGun(), true, 'the active-build combat flight can fire its selected MG');
    assert.equal(strategy.isNormalArcadeRun(), true, 'normal stats and base regeneration');
    const plan = buildArcadeEncounterPlan(config, store);
    assert.equal(plan.sequence[0].squadId, 'hunter_pack');
    assert.equal(plan.sequence[0].parcoursEnabled, false);
    runtime.startRun({ encounterPlan: plan, strategy });
    const before = writes;
    assert.equal(runtime.applyParcoursXpEvent('checkpoint', 0), null);
    assert.equal(runtime.applyParcoursLeaderboardEvent({ type: 'finish', routeId: 'x', totalTimeMs: 20 }), null);
    runtime.applyGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 1, nowMs: 1500 });
    finalizeArcadeRun(runtime, 2000);
    runtime.flushPersistenceSaves();
    assert.equal(writes, before);
    assert.equal(runtime.getVehicleProfile()?.xpBank || 0, 0);
    assert.equal(runtime.getRecordsSnapshot().runsPlayed, 0);
    const controller = new ArcadeRoundStateController({ arcadeRuntime: runtime, baseController: { deriveMatchEndTick: () => assert.fail('normal end') } });
    assert.equal(controller.deriveMatchEndTick().action, 'RETURN_TO_MENU');
});

test('Escape in a test flight takes the existing return-to-menu lifecycle, ordinary runs still pause', () => {
    let returned = 0; let paused = 0;
    const game = { settings: { localSettings: { modePath: 'arcade' }, arcade: { runType: 'hangar_test' } },
        runtimePorts: { lifecyclePort: { returnToMenu: () => returned++ } }, matchFlowUiController: { pause: () => paused++ } };
    const access = createPlayingStateRuntimeAccess(game);
    access.actionPauseMatch();
    assert.equal(returned, 1); assert.equal(paused, 0);
    game.settings.arcade.runType = 'gauntlet'; access.actionPauseMatch();
    assert.equal(returned, 1); assert.equal(paused, 1);
});

test('test flight ends once at thirty active seconds and returns through the playing lifecycle without rewards', () => {
    let nowMs = 1000; let writes = 0; let returned = 0;
    const store = { readJsonRecordResult: () => ({ status: 'missing' }), loadJsonRecord: (_key, fallback) => fallback,
        saveJsonRecord: () => { writes++; return true; } };
    const runtime = new ArcadeRunRuntime({ settingsManager: { getPlayerRecordStorePort: () => store }, now: () => nowMs });
    const config = { arcade: { enabled: true, runType: 'hangar_test', seed: 2, sectorCount: 1 }, session: { mapKey: 'parcours_assault' } };
    configureArcadeRunRuntime(runtime, config); runtime.setActiveVehicle('ship5');
    const start = () => runtime.startRun({ encounterPlan: buildArcadeEncounterPlan(config, store), strategy: new ArcadeModeStrategy({ runType: 'hangar_test' }) });
    start(); const before = writes;
    runtime.tickGameplay(29.9);
    assert.equal(runtime.getPhase(), 'sector_active');
    nowMs += 120000; // Wall-clock time without simulation ticks is not flight time.
    runtime.tickGameplay(0);
    assert.equal(runtime.getPhase(), 'sector_active');
    const game = { state: 'PLAYING', entityManager: { update() {} }, runtimePorts: {
        arcadePort: { tickSuddenDeath: dt => runtime.tickGameplay(dt), getMenuSurfaceState: () => runtime.getMenuSurfaceState() },
        lifecyclePort: { returnToMenu: options => { assert.equal(options.reason, 'hangar_test_complete'); returned++; game.state = 'MENU'; } },
    } };
    new PlayingStateSystem(createPlayingStateRuntimeAccess(game)).update(0.1);
    assert.equal(runtime.getPhase(), 'finished'); assert.equal(returned, 1);
    const finishedAt = runtime.getStateSnapshot().finishedAtIso;
    runtime.tickGameplay(10); runtime.flushPersistenceSaves();
    assert.equal(runtime.getStateSnapshot().finishedAtIso, finishedAt);
    assert.equal(writes, before); assert.equal(runtime.getRecordsSnapshot().runsPlayed, 0);
    start(); runtime.tickGameplay(0.1); assert.equal(runtime.getPhase(), 'sector_active');
    config.arcade.runType = 'gauntlet'; configureArcadeRunRuntime(runtime, config); start();
    runtime.tickGameplay(31); assert.equal(runtime.getPhase(), 'sector_active', 'ordinary runs have no flight deadline');
});
