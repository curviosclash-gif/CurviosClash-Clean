import assert from 'node:assert/strict';
import test from 'node:test';

import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { WeaponRaceRuntime } from '../src/core/arcade/WeaponRaceRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { RoundStateTickSystem } from '../src/state/RoundStateTickSystem.js';
import { WEAPON_RACE_FINISH_XP } from '../src/shared/contracts/WeaponRaceContract.js';
import { loadVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';

function createRuntime() {
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const strategy = new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' });
    const runtime = new ArcadeRunRuntime({
        settingsManager: { getPlayerRecordStorePort: () => store },
        now: () => 1000,
        strategy,
        arcadePersistenceSaveThrottleMs: 0,
        ghostLibrarySaveThrottleMs: 0,
    });
    runtime.configure({ arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4 } });
    runtime.setActiveVehicle('ship1');
    runtime.startRun({
        strategy,
        encounterPlan: {
            sequence: Array.from({ length: 4 }, () => ({ templateId: 'sector_parcours', parcoursEnabled: true })),
        },
    });
    return { runtime, store };
}

function resolveThroughRoundEndCoordinator(arcadeRuntime, players, winnerIndex) {
    const raceRecords = new Map();
    const raceStore = {
        loadJsonRecord: (key, fallback) => raceRecords.has(key) ? structuredClone(raceRecords.get(key)) : fallback,
        saveJsonRecord: (key, value) => { raceRecords.set(key, structuredClone(value)); return true; },
    };
    const race = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => raceStore });
    race.start({ entityManager: { players, humanPlayers: [players[0]], _projectileSystem: { clearForOwner() {} } } });
    race.handleFinish({ playerIndex: winnerIndex, finishedAtMs: 5000 });
    race.handleFinish({ playerIndex: winnerIndex === 0 ? 1 : 0, finishedAtMs: 6000 });
    const raceOutcome = race.getRoundOutcome(20_000);
    const recording = {};
    const plan = coordinateRoundEnd({
        recorder: {
            finalizeRound: (_winner, _players, data) => { recording.reason = data.reason; recording.parcours = data.parcours; },
            dump() {},
        },
        winner: raceOutcome.winner,
        players,
        roundStateController: new ArcadeRoundStateController({
            arcadeRuntime,
            baseController: new RoundStateController(),
        }),
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 1,
        outcomeReason: raceOutcome.reason,
        parcours: raceOutcome.parcours,
        logger: { log() {} },
    });
    return { plan, race, recording };
}

test('bot-first weapon race ends the Arcade run without sector completion or sector XP', () => {
    const { runtime } = createRuntime();
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const { plan, race } = resolveThroughRoundEndCoordinator(runtime, [human, bot], 1);

    assert.equal(race.xpEarned, 0);
    assert.equal(plan.outcome.state, 'MATCH_END');
    assert.equal(plan.outcome.reason, 'WEAPON_RACE_LOST');
    assert.equal(plan.outcome.arcade.phase, 'finished');
    assert.equal(plan.outcome.arcade.completedSectors, 0);
    assert.equal(runtime.getStateSnapshot().completedSectors, 0);

    const xpBeforeTelemetry = runtime.getStateSnapshot().xpEarned;
    runtime.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 20, kills: 3, selfCollisions: 0 });

    const state = runtime.getStateSnapshot();
    assert.equal(state.phase, 'finished');
    assert.equal(state.completedSectors, 0);
    assert.equal(state.xpEarned, xpBeforeTelemetry);
    assert.equal(state.score.lastScoredSector, 0);
    assert.equal(state.score.total, 0);
    assert.deepEqual(state.sectorHistory, []);
    assert.ok(state.finishedAtIso, 'the terminal loss should finalize the run');
});

test('human-first dead winner keeps the race reason and time through round-end coordination', () => {
    const { runtime } = createRuntime();
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    human.alive = false;
    human.hp = 0;
    const { plan, race, recording } = resolveThroughRoundEndCoordinator(runtime, [human, bot], 0);

    assert.equal(plan.outcome.state, 'ROUND_END');
    assert.equal(plan.outcome.reason, 'WEAPON_RACE_COMPLETE');
    assert.match(plan.outcome.messageText, /4\.00s/);
    assert.doesNotMatch(plan.outcome.messageText, /\?s/);
    assert.equal(recording.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(recording.parcours.completedAtMs, 5000);
    assert.equal(race.xpEarned, 80);
    assert.equal(runtime.getStateSnapshot().completedSectors, 1);
    runtime.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 20, kills: 3, selfCollisions: 0 });
    assert.ok(runtime.getStateSnapshot().xpEarned > 0);
});

test('support starts both runtimes and carries a bot-first race through terminal Arcade loss', () => {
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const records = new Map();
    let vehicleSaveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (key.includes('arcade-vehicle-profile')) {
                vehicleSaveCalls += 1;
                if (vehicleSaveCalls === 1) return { ok: false, status: 'write_failed' };
            }
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const game = { settingsManager: { getPlayerRecordStorePort: () => store }, settings: {} };
    let xpEventCallback = null;
    let leaderboardCallback = null;
    const parcoursProgressSystem = {
        setXpEventCallback(callback) { xpEventCallback = callback; },
        setLeaderboardCallback(callback) { leaderboardCallback = callback; },
        setAttemptResetCallback() {},
        setDeathCallback() {},
        setSpawnCallback() {},
        setGhostRecorder() {},
        getRouteSnapshot: () => ({ checkpoints: [], finish: null }),
    };
    const runtimeState = {
        numHumans: 1,
        roundStateController: new RoundStateController(),
        entityManager: {
            players: [human, bot],
            humanPlayers: [human],
            gameModeStrategy: new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' }),
            _parcoursProgressSystem: parcoursProgressSystem,
            _projectileSystem: { clearForOwner() {} },
        },
        runtimeConfig: {
            arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4, seed: 77 },
            session: { sessionType: 'single', mapKey: 'parcours_assault', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getGame: () => game,
        getRuntimeState: () => runtimeState,
        nowMs: () => 1000,
        logger: { log() {}, warn() {} },
    });
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();

    assert.equal(support.arcadeRunRuntime.getStateSnapshot().phase, 'sector_active',
        'the real weapon-race support start must initialize ArcadeRunRuntime');
    assert.equal(support.arcadeRunRuntime.getStateSnapshot().completedSectors, 0);
    assert.equal(typeof xpEventCallback, 'function');
    assert.equal(typeof leaderboardCallback, 'function');

    const failedCheckpoint = xpEventCallback('checkpoint', human.index, { checkpointId: 'CP02_MG' });
    assert.equal(failedCheckpoint.rewardPending, true);
    const raceAtPendingReward = support.weaponRaceRuntime.state;
    support.startRunIfEnabled();
    assert.strictEqual(support.weaponRaceRuntime.state, raceAtPendingReward,
        'repeated support starts must preserve active race standings and pending rewards');
    assert.equal(support.weaponRaceRuntime.pendingCheckpointRewards.length, 1);
    support.tickSuddenDeath(0);
    assert.equal(support.weaponRaceRuntime.pendingCheckpointRewards.length, 0,
        'the normal support tick settles a checkpoint after storage recovers');
    assert.equal(support.weaponRaceRuntime.xpEarned, 10);

    xpEventCallback('finish', bot.index, { finishedAtMs: 5000 });
    xpEventCallback('finish', human.index, { finishedAtMs: 6000 });
    const raceOutcome = leaderboardCallback({ type: 'round_outcome', now: 20_000 });
    assert.equal(raceOutcome.winner.index, bot.index);
    assert.equal(support.weaponRaceRuntime.xpEarned, 10, 'earned checkpoint XP remains while bot victory prize stays withheld');

    const plan = coordinateRoundEnd({
        recorder: { finalizeRound() {}, dump() {} },
        winner: raceOutcome.winner,
        players: [human, bot],
        roundStateController: runtimeState.roundStateController,
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 1,
        outcomeReason: raceOutcome.reason,
        parcours: raceOutcome.parcours,
        logger: { log() {} },
    });
    assert.equal(plan.outcome.state, 'MATCH_END');
    assert.equal(plan.outcome.reason, 'WEAPON_RACE_LOST');
    assert.equal(plan.outcome.arcade.completedSectors, 0);

    support.arcadeRunRuntime.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 20, kills: 3, selfCollisions: 0 });
    const final = support.arcadeRunRuntime.getStateSnapshot();
    assert.equal(final.phase, 'finished');
    assert.equal(final.completedSectors, 0);
    assert.equal(final.xpEarned, 0);
    assert.equal(final.score.total, 0);
    assert.deepEqual(final.sectorHistory, []);
    assert.ok(final.finishedAtIso);

    support.resetRunState({ force: true });
    assert.equal(support.arcadeRunRuntime.getStateSnapshot(), null,
        'the weapon-race support reset must clear the Arcade run state');
    assert.equal(support.weaponRaceRuntime.getHudState().phase, 'idle');
});

test('human-first support flow retries finish and best XP before completion and keeps sector XP in the shared store', () => {
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const records = new Map();
    let vehicleSaveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (key.includes('arcade-vehicle-profile')) {
                vehicleSaveCalls += 1;
                if (vehicleSaveCalls === 1 || vehicleSaveCalls === 3) return { ok: false, status: 'write_failed' };
            }
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const game = { settingsManager: { getPlayerRecordStorePort: () => store }, settings: {} };
    let xpEventCallback = null;
    let leaderboardCallback = null;
    const parcoursProgressSystem = {
        setXpEventCallback(callback) { xpEventCallback = callback; },
        setLeaderboardCallback(callback) { leaderboardCallback = callback; },
        setAttemptResetCallback() {},
        setDeathCallback() {},
        setSpawnCallback() {},
        setGhostRecorder() {},
        getRouteSnapshot: () => ({ checkpoints: [], finish: null }),
    };
    const runtimeState = {
        numHumans: 1,
        roundStateController: new RoundStateController(),
        entityManager: {
            players: [human, bot],
            humanPlayers: [human],
            gameModeStrategy: new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' }),
            _parcoursProgressSystem: parcoursProgressSystem,
            _projectileSystem: { clearForOwner() {} },
        },
        runtimeConfig: {
            arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4, seed: 78 },
            session: { sessionType: 'single', mapKey: 'parcours_assault', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getGame: () => game,
        getRuntimeState: () => runtimeState,
        nowMs: () => 1000,
        logger: { log() {}, warn() {} },
    });
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();

    xpEventCallback('finish', human.index, { finishedAtMs: 5000 });
    xpEventCallback('finish', bot.index, { finishedAtMs: 6000 });
    const best = leaderboardCallback({
        type: 'finish', playerIndex: human.index, routeId: 'weapon_race_ghost_v1',
        totalTimeMs: 4000, penaltyTimeMs: 0, segmentSplitsMs: [], ghostDurationMs: 4000,
    });
    assert.equal(best.isBestTime, true);
    assert.equal(support.weaponRaceRuntime.bestXpPending, true);

    human.alive = false;
    human.hp = 0;
    const outcomePoller = new RoundOutcomeSystem({
        getPlayers: () => [human, bot],
        getHumanPlayers: () => [human],
        getBots: () => [bot],
        getObjectiveOutcome: () => leaderboardCallback({ type: 'round_outcome', now: 20_000 }),
    });
    const failedFinishSave = outcomePoller.resolve();
    assert.equal(failedFinishSave.shouldEnd, false);
    assert.equal(support.weaponRaceRuntime.state.racers['0'].finishXpAwarded, false);
    const failedBestSave = outcomePoller.resolve();
    assert.equal(failedBestSave.shouldEnd, false);
    assert.equal(support.weaponRaceRuntime.state.racers['0'].finishXpAwarded, true);
    assert.equal(support.weaponRaceRuntime.bestXpAwarded, false);
    const outcome = outcomePoller.resolve();
    assert.equal(outcome.shouldEnd, true);
    assert.equal(outcome.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(support.weaponRaceRuntime.xpEarned, 120);
    assert.equal(support.weaponRaceRuntime.roundOutcome.awardedXp, 120,
        'the race outcome includes prizes acknowledged during earlier settlement polls');

    const recording = {};
    const plan = coordinateRoundEnd({
        recorder: {
            finalizeRound: (_winner, _players, data) => { recording.reason = data.reason; recording.parcours = data.parcours; },
            dump() {},
        },
        winner: outcome.winner,
        players: [human, bot],
        roundStateController: runtimeState.roundStateController,
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 1,
        outcomeReason: outcome.reason,
        parcours: outcome.parcours,
        logger: { log() {} },
    });
    assert.equal(plan.outcome.reason, 'WEAPON_RACE_COMPLETE');
    assert.match(plan.outcome.messageText, /4\.00s/);
    assert.equal(recording.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(recording.parcours.completedAtMs, 5000);
    assert.equal(plan.outcome.arcade.completedSectors, 1);

    support.recordRoundEndTelemetry({ state: 'ROUND_END', duration: 20, kills: 3, selfCollisions: 0 });
    assert.equal(support.arcadeRunRuntime.flushPersistenceSaves(), true,
        'structured { ok: true } store acknowledgements must clear the Arcade persistence queue');
    const arcadeState = support.arcadeRunRuntime.getStateSnapshot();
    const durableProfile = loadVehicleProfiles(store).ship1;
    assert.ok(arcadeState.lastSectorXp.earned > 0);
    assert.equal(durableProfile.xp, 120 + arcadeState.lastSectorXp.earned,
        'sector profile persistence must merge with previously acknowledged race prizes');
    assert.equal(arcadeState.sectorHistory.length, 1);
});

test('real ParcoursProgressSystem preserves pending settlement and terminalizes the actual winner after bounded retries', () => {
    const makeOutcome = (winnerIndex, withCheckpointReward = false) => {
        const human = { index: 0, isBot: false, alive: true };
        const bot = { index: 1, isBot: true, alive: true };
        const players = [human, bot];
        const race = new WeaponRaceRuntime({
            now: () => 1000,
            getRecordStore: () => ({
                loadJsonRecord: (_key, fallback) => fallback,
                saveJsonRecord: () => ({ ok: false, status: 'write_failed' }),
            }),
        });
        race.start({ entityManager: { players, humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });
        if (withCheckpointReward) race.handleCheckpoint({ playerIndex: human.index, checkpointId: 'CP02_MG' });
        race.handleFinish({ playerIndex: winnerIndex, finishedAtMs: 5000 });
        race.handleFinish({ playerIndex: winnerIndex === 0 ? 1 : 0, finishedAtMs: 6000 });

        const parcours = new ParcoursProgressSystem({ players }, { nowProvider: () => 20_000 });
        parcours._route = { routeId: 'contract', totalCheckpoints: 0, rules: { winnerByParcoursComplete: true, finishGraceMs: 0 } };
        parcours._completionOrder.push({ playerIndex: 0, completionTimeMs: 1234, penaltyTimeMs: 0, completedAtMs: 5000 });
        parcours.setLeaderboardCallback(({ now }) => race.getRoundOutcome(now));
        return { parcours, race, human, bot };
    };

    const botFirst = makeOutcome(1, true);
    const pendingBot = botFirst.parcours.getRoundOutcome();
    assert.equal(pendingBot.shouldEnd, false);
    assert.equal(pendingBot.settling, true);
    assert.equal(pendingBot.reason, 'WEAPON_RACE_SETTLING',
        'a mode-specific pending result must suppress generic PARCOURS_COMPLETE fallback');
    assert.equal(botFirst.race.xpEarned, 0);
    assert.equal(botFirst.parcours.getRoundOutcome().settling, true);
    const botTerminal = botFirst.parcours.getRoundOutcome();
    assert.equal(botTerminal.shouldEnd, true);
    assert.equal(botTerminal.winner, botFirst.bot);
    assert.equal(botTerminal.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(botTerminal.rewardsPersisted, false);
    assert.equal(botFirst.race.xpEarned, 0);
    assert.equal(botFirst.race.pendingCheckpointRewards.length, 1,
        'a permanent save failure stays visibly pending instead of being acknowledged');
    const botArcade = createRuntime().runtime;
    const botPlan = coordinateRoundEnd({
        recorder: { finalizeRound() {}, dump() {} }, winner: botTerminal.winner,
        players: [botFirst.human, botFirst.bot],
        roundStateController: new ArcadeRoundStateController({ arcadeRuntime: botArcade, baseController: new RoundStateController() }),
        humanPlayerCount: 1, totalBots: 1, winsNeeded: 1,
        outcomeReason: botTerminal.reason, parcours: botTerminal.parcours, logger: { log() {} },
    });
    assert.equal(botPlan.outcome.state, 'MATCH_END');
    assert.equal(botPlan.outcome.reason, 'WEAPON_RACE_LOST');
    botArcade.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 20, kills: 0, selfCollisions: 0 });
    assert.equal(botArcade.getStateSnapshot().phase, 'finished');
    assert.equal(botArcade.getStateSnapshot().completedSectors, 0);
    assert.deepEqual(botArcade.getStateSnapshot().sectorHistory, []);

    const humanFirst = makeOutcome(0);
    assert.equal(humanFirst.parcours.getRoundOutcome().settling, true);
    assert.equal(humanFirst.parcours.getRoundOutcome().settling, true);
    const humanTerminal = humanFirst.parcours.getRoundOutcome();
    assert.equal(humanTerminal.shouldEnd, true);
    assert.equal(humanTerminal.winner, humanFirst.human);
    assert.equal(humanTerminal.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(humanTerminal.parcours.completedAtMs, 5000);
    assert.equal(humanTerminal.rewardsPersisted, false);
    assert.equal(humanFirst.race.xpEarned, 0);
    assert.equal(humanFirst.race.state.racers['0'].finishXpAwarded, false);
    humanFirst.human.alive = false;
    humanFirst.human.hp = 0;
    const humanArcade = createRuntime().runtime;
    const humanPlan = coordinateRoundEnd({
        recorder: { finalizeRound() {}, dump() {} }, winner: humanTerminal.winner,
        players: [humanFirst.human, humanFirst.bot],
        roundStateController: new ArcadeRoundStateController({ arcadeRuntime: humanArcade, baseController: new RoundStateController() }),
        humanPlayerCount: 1, totalBots: 1, winsNeeded: 1,
        outcomeReason: humanTerminal.reason, parcours: humanTerminal.parcours, logger: { log() {} },
    });
    assert.equal(humanPlan.outcome.state, 'ROUND_END');
    assert.equal(humanPlan.outcome.reason, 'WEAPON_RACE_COMPLETE');
    assert.match(humanPlan.outcome.messageText, /4\.00s/);
    humanArcade.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 20, kills: 0, selfCollisions: 0 });
    assert.equal(humanArcade.getStateSnapshot().completedSectors, 1);
});

test('support start, Parcours finish and outcome polling share simulation time despite an epoch Arcade clock', () => {
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const entityManager = {
        players: [human, bot], humanPlayers: [human], _simulationClockMs: 0,
        gameModeStrategy: new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' }),
        _projectileSystem: { clearForOwner() {} },
    };
    const parcours = new ParcoursProgressSystem(entityManager, {
        nowProvider: () => entityManager._simulationClockMs,
    });
    parcours._route = {
        routeId: 'weapon_race_clock_contract', totalCheckpoints: 0, sequence: [], checkpoints: [],
        rules: { winnerByParcoursComplete: true, finishGraceMs: 0 },
    };
    entityManager._parcoursProgressSystem = parcours;
    const runtimeState = {
        numHumans: 1,
        roundStateController: new RoundStateController(),
        entityManager,
        runtimeConfig: {
            arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4, seed: 79 },
            session: { sessionType: 'single', mapKey: 'parcours_assault', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
        },
    };
    const epochNow = 1_800_000_000_000;
    const support = new GameRuntimeArcadeSupport({
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store }, settings: {} }),
        getRuntimeState: () => runtimeState,
        nowMs: () => epochNow,
        logger: { log() {}, warn() {} },
    });
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();
    assert.equal(support.weaponRaceRuntime.state.startedAtMs, 0,
        'the race starts on the entity simulation clock, not the epoch persistence clock');

    entityManager._simulationClockMs = 5000;
    parcours._xpEventCallback('finish', human.index, { finishedAtMs: entityManager._simulationClockMs });
    assert.equal(support.getRunState().graceRemainingMs, 15_000,
        'HUD countdown uses simulation time even though update and profile persistence use epoch time');
    entityManager._simulationClockMs = 6000;
    parcours._xpEventCallback('finish', bot.index, { finishedAtMs: entityManager._simulationClockMs });
    assert.equal(support.weaponRaceRuntime.state.graceEndsAtMs, 20_000);
    entityManager._simulationClockMs = 10_000;
    support.tickSuddenDeath(0);
    assert.equal(support.getRunState().graceRemainingMs, 10_000,
        'the ordinary update path also returns the simulation-clock countdown');
    entityManager._simulationClockMs = 19_999;
    assert.equal(parcours.getRoundOutcome(), null, 'finish grace is measured in simulation time');
    entityManager._simulationClockMs = 20_000;
    const outcome = parcours.getRoundOutcome();
    assert.equal(outcome.shouldEnd, true);
    assert.equal(outcome.winner, human);
    assert.equal(outcome.parcours.completionTimeMs, 5000);
    assert.equal(outcome.parcours.completedAtMs, 5000);
    assert.equal(outcome.awardedXp, WEAPON_RACE_FINISH_XP);
    assert.equal(support.weaponRaceRuntime.state.racers['0'].finishXpAwarded, true);
});

test('RoundStateTickSystem retries bot-first pending rewards during MATCH_END and refreshes outcome status', () => {
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const records = new Map();
    let recoverStore = false;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (!recoverStore) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const entityManager = {
        players: [human, bot], humanPlayers: [human], _simulationClockMs: 0,
        gameModeStrategy: new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' }),
        _projectileSystem: { clearForOwner() {} },
    };
    const parcours = new ParcoursProgressSystem(entityManager, { nowProvider: () => entityManager._simulationClockMs });
    parcours._route = {
        routeId: 'weapon_race_terminal_retry', totalCheckpoints: 0, sequence: [], checkpoints: [],
        rules: { winnerByParcoursComplete: true, finishGraceMs: 0 },
    };
    entityManager._parcoursProgressSystem = parcours;
    const runtimeState = {
        numHumans: 1, roundStateController: new RoundStateController(), entityManager,
        runtimeConfig: {
            arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4, seed: 80 },
            session: { sessionType: 'single', mapKey: 'parcours_assault', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store }, settings: {} }),
        getRuntimeState: () => runtimeState,
        nowMs: () => 1_800_000_000_000,
        logger: { log() {}, warn() {} },
    });
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();
    const checkpoint = support.weaponRaceRuntime.handleCheckpoint({ playerIndex: human.index, checkpointId: 'CP02_MG' });
    assert.equal(checkpoint.rewardPending, true);
    support.weaponRaceRuntime.handleFinish({ playerIndex: bot.index, finishedAtMs: 5000 });
    support.weaponRaceRuntime.handleFinish({ playerIndex: human.index, finishedAtMs: 6000 });
    entityManager._simulationClockMs = 20_000;
    assert.equal(parcours.getRoundOutcome().settling, true);
    assert.equal(parcours.getRoundOutcome().settling, true);
    const terminal = parcours.getRoundOutcome();
    assert.equal(terminal.shouldEnd, true);
    assert.equal(terminal.winner, bot);
    assert.equal(terminal.rewardsPersisted, false);

    recoverStore = true;
    const game = {
        roundPause: 0,
        runtimeCoordinator: {
            getArcadeMenuSurfaceState: () => support.getMenuSurfaceState(),
            getRuntimeFacade: () => ({ tickPendingArcadeRewards: () => support.tickPendingArcadeRewards() }),
        },
        roundStateController: {
            isArcadeRoundStateController: true,
            deriveMatchEndTick: () => ({ action: 'WAIT', shouldUpdateCameras: false }),
        },
        input: { wasPressed: () => false, wasKeyboardEscapePressed: () => false, clearContinueIntent() {} },
        matchFlowUiController: { applyMatchUiState() {} },
    };
    new RoundStateTickSystem({ game }).updateMatchEnd(0);
    assert.equal(support.weaponRaceRuntime.pendingCheckpointRewards.length, 0);
    assert.equal(support.weaponRaceRuntime.xpEarned, 10);
    assert.equal(terminal.pendingRewardCount, 0);
    assert.equal(terminal.rewardsPersisted, true,
        'the actual match-end tick retries the captured store and updates the bot-winner outcome');
});

test('unconfirmed rewards survive dispose and a new start with their original store and vehicle binding', () => {
    const recordsA = new Map();
    const recordsB = new Map();
    let storeARecovered = false;
    const storeA = {
        loadJsonRecord: (key, fallback) => recordsA.has(key) ? structuredClone(recordsA.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (!storeARecovered) return { ok: false, status: 'write_failed' };
            recordsA.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const storeB = {
        loadJsonRecord: (key, fallback) => recordsB.has(key) ? structuredClone(recordsB.get(key)) : fallback,
        saveJsonRecord: (key, value) => { recordsB.set(key, structuredClone(value)); return true; },
    };
    let activeStore = storeA;
    const runtime = new WeaponRaceRuntime({ now: () => 1_800_000_000_000, getRecordStore: () => activeStore });
    const oldHuman = { index: 0, isBot: false, alive: true };
    const oldBot = { index: 1, isBot: true, alive: true };
    runtime.start({ entityManager: { players: [oldHuman, oldBot], humanPlayers: [oldHuman], _simulationClockMs: 0 } });
    runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP02_MG' });
    runtime.handleFinish({ playerIndex: 1, finishedAtMs: 5000 });
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: 6000 });
    runtime.getRoundOutcome(20_000);
    runtime.getRoundOutcome(20_001);
    const oldOutcome = runtime.getRoundOutcome(20_002);
    assert.equal(oldOutcome.rewardsPersisted, false);

    runtime.dispose();
    activeStore = storeB;
    const newHuman = { index: 0, isBot: false, alive: true };
    runtime.start({ entityManager: { players: [newHuman], humanPlayers: [newHuman], _simulationClockMs: 0 }, vehicleId: 'ship2' });
    storeARecovered = true;
    runtime.update(1_800_000_000_001);

    assert.equal(oldOutcome.rewardsPersisted, true);
    assert.equal(oldOutcome.pendingRewardCount, 0);
    assert.equal(oldOutcome.winner, oldBot);
    assert.ok(loadVehicleProfiles(storeA).ship1.xp > 0, 'the archived retry writes to the original race store and ship');
    assert.equal(loadVehicleProfiles(storeB).ship2, undefined, 'an old reward cannot leak into the new run profile');
    assert.equal(runtime.xpEarned, 0, 'acknowledging an archived reward does not inflate the new run HUD');
});

test('support retries an archived weapon-race reward after switching to another Arcade mode', () => {
    const records = new Map();
    let recovered = false;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            if (!recovered) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const human = { index: 0, isBot: false, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const bot = { index: 1, isBot: true, alive: true, hp: 60, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    const entityManager = {
        players: [human, bot], humanPlayers: [human], _simulationClockMs: 0,
        gameModeStrategy: new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' }),
        _projectileSystem: { clearForOwner() {} },
    };
    const runtimeState = {
        numHumans: 1, roundStateController: new RoundStateController(), entityManager,
        runtimeConfig: {
            arcade: { enabled: true, runType: 'weapon_race', sectorCount: 4, seed: 81 },
            session: { sessionType: 'single', mapKey: 'parcours_assault', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship1' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store }, settings: {} }),
        getRuntimeState: () => runtimeState,
        nowMs: () => 1_800_000_000_000,
        logger: { log() {}, warn() {} },
    });
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();
    support.weaponRaceRuntime.handleCheckpoint({ playerIndex: human.index, checkpointId: 'CP02_MG' });
    support.weaponRaceRuntime.handleFinish({ playerIndex: bot.index, finishedAtMs: 5000 });
    support.weaponRaceRuntime.handleFinish({ playerIndex: human.index, finishedAtMs: 6000 });
    entityManager._simulationClockMs = 20_000;
    support.weaponRaceRuntime.settlementWaitAttempts = 2;
    const outcome = support.weaponRaceRuntime.getRoundOutcome();
    assert.equal(outcome.winner, bot);
    assert.equal(outcome.rewardsPersisted, false);

    support.resetRunState({ force: true });
    runtimeState.runtimeConfig.arcade.runType = 'gauntlet';
    entityManager.gameModeStrategy = new ArcadeModeStrategy({ runType: 'gauntlet', combatProfile: 'hunt' });
    recovered = true;
    support.tickSuddenDeath(0);

    assert.equal(outcome.rewardsPersisted, true);
    assert.equal(outcome.pendingRewardCount, 0);
    assert.ok(loadVehicleProfiles(store).ship1.xp > 0, 'the original W7 binding receives the acknowledged XP');
    assert.equal(support.weaponRaceRuntime.xpEarned, 0, 'the archived reward does not enter a later run HUD');
});

test('archived retries use a time backoff and merge compatible runs without dropping outcomes', () => {
    const records = new Map();
    let recovered = false;
    let retryNow = 0;
    let saveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            saveCalls += 1;
            if (!recovered) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const runtime = new WeaponRaceRuntime({
        now: () => 1_800_000_000_000,
        retryNow: () => retryNow,
        getRecordStore: () => store,
    });
    const makePlayer = () => ({ index: 0, isBot: false, alive: true });
    const outcomes = [];
    for (let run = 0; run < 2; run += 1) {
        const human = makePlayer();
        const bot = { index: 1, isBot: true, alive: true };
        runtime.start({ entityManager: { players: [human, bot], humanPlayers: [human], _simulationClockMs: 0 }, vehicleId: 'ship1' });
        runtime.handleCheckpoint({ playerIndex: human.index, checkpointId: 'CP02_MG' });
        runtime.handleFinish({ playerIndex: bot.index, finishedAtMs: 5000 });
        runtime.handleFinish({ playerIndex: human.index, finishedAtMs: 6000 });
        runtime.settlementWaitAttempts = 2;
        outcomes.push(runtime.getRoundOutcome(20_000));
        assert.equal(outcomes[run].rewardsPersisted, false);
        runtime.dispose();
    }
    assert.equal(runtime.pendingSettlementBatches.length, 1, 'same store and vehicle binding share one batch');
    assert.equal(runtime.pendingSettlementBatches[0].items.length, 2);

    const afterInitialFailures = saveCalls;
    for (let frame = 0; frame < 100; frame += 1) runtime.update(frame);
    assert.equal(saveCalls, afterInitialFailures + 1, 'many frames trigger only one retry in the backoff window');
    retryNow = 250;
    runtime.update(250);
    assert.equal(saveCalls, afterInitialFailures + 2);
    recovered = true;
    retryNow = 500;
    runtime.update(500);
    assert.equal(outcomes[0].rewardsPersisted, true);
    assert.equal(outcomes[1].rewardsPersisted, false);
    retryNow = 750;
    runtime.update(750);

    assert.equal(runtime.hasPendingSettlement(), false);
    assert.equal(outcomes[1].rewardsPersisted, true);
    assert.equal(outcomes[1].pendingRewardCount, 0);
    assert.ok(loadVehicleProfiles(store).ship1.xp > 0, 'both archived checkpoints are eventually persisted');
});
