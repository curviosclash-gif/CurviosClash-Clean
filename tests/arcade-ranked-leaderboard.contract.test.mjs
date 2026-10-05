import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRankContext, ARCADE_DIFFICULTY_STORAGE_KEY } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { insertArcadeRankedResult, resolveArcadeParcoursRankKey, ARCADE_RANKED_STORAGE_KEY } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { settleArcadeRunRanking } from '../src/state/arcade/ArcadeRunRanking.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { prepareArcadeRunRanking } from '../src/core/arcade/ArcadeRunRankingOps.js';
import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';

const context = (id, level = 1, tierId = 'normal', runType = 'gauntlet') => createArcadeRankContext({ runId: id, vehicleId: 'ship5', profile: { level }, tierId, runType });

function rankedRunFixture() {
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        readJsonRecordResult: key => records.has(key) ? { status: 'found', value: records.get(key) } : { status: 'missing' },
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const strategy = new ArcadeModeStrategy();
    const runtime = new ArcadeRunRuntime({ settingsManager: { getPlayerRecordStorePort: () => store },
        now: () => 100000, strategy, arcadePersistenceSaveThrottleMs: 0, ghostLibrarySaveThrottleMs: 0 });
    runtime.configure({ arcade: { enabled: true, seed: 5, sectorCount: 2 } });
    runtime.setActiveVehicle('ship5');
    runtime.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 5, sectorCount: 2 }) });
    runtime.rankContext = context(runtime.getStateSnapshot().runId);
    runtime._rankingStore = store;
    const players = [{ index: 0, isBot: false, alive: true, hp: 60, maxHp: 100 }];
    const finish = (reason = '') => {
        const plan = runtime.deriveRoundEndPlan({ players, inputs: { reason }, baseController: {} });
        if (plan) runtime.handleRoundEndTelemetry({ state: plan.outcome.state, reason, duration: 20, kills: 1 });
        return plan;
    };
    return { runtime, records, players, finish };
}

test('menu aborts never rank, preserve earned progress and leave existing results intact', () => {
    for (const earned of [false, true]) {
        const f = rankedRunFixture();
        settleArcadeRunRanking({ rankContext: context('existing'), _rankingStore: f.runtime._rankingStore }, { score: 123 });
        const board = structuredClone(f.records.get(ARCADE_RANKED_STORAGE_KEY));
        if (earned) {
            f.finish();
            f.runtime.beginNextSector();
        }
        const xp = f.runtime.getStateSnapshot().xpEarned;
        const readProgress = () => {
            const { xp, level, xpBank, totalXpEarned, upgrades } = f.runtime.getVehicleProfile();
            return structuredClone({ xp, level, xpBank, totalXpEarned, upgrades });
        };
        const profile = readProgress();
        f.runtime.resetRunState({ preserveRecords: true });
        assert.deepEqual(readProgress(), profile, 'earned vehicle progress survives an unranked abort');
        assert.deepEqual(f.records.get(ARCADE_RANKED_STORAGE_KEY), board);
        assert.equal(f.records.has(ARCADE_DIFFICULTY_STORAGE_KEY), false);
        assert.equal(f.runtime.getRecordsSnapshot().runsPlayed, 1);
        if (earned) assert.ok(xp > 0);
    }
});

test('explicit abort telemetry is excluded, while natural zero-point defeat remains eligible', () => {
    const aborted = rankedRunFixture();
    aborted.finish('ABORT');
    assert.equal(aborted.runtime.getPostRunSummary()?.aborted, true);
    assert.equal(aborted.records.has(ARCADE_RANKED_STORAGE_KEY), false);
    const defeated = rankedRunFixture();
    defeated.players[0].alive = false;
    defeated.players[0].hp = 0;
    defeated.finish('ELIMINATION');
    assert.equal(defeated.runtime.getPostRunSummary().aborted, false);
    assert.equal(defeated.records.get(ARCADE_RANKED_STORAGE_KEY).boards['gauntlet:normal:1-5'].length, 1);
    const zero = { rankContext: context('zero'), _rankingStore: defeated.runtime._rankingStore };
    assert.ok(settleArcadeRunRanking(zero, { score: 0, aborted: false }));
});

test('sector rebuilds keep one run and a victory cannot be reclassified by later menu reset', () => {
    const f = rankedRunFixture();
    f.finish();
    assert.equal(f.records.has(ARCADE_RANKED_STORAGE_KEY), false);
    f.runtime.beginNextSector();
    f.finish();
    f.runtime.resolveVictoryChoice('finish');
    assert.equal(f.runtime.getPostRunSummary().aborted, false);
    const board = structuredClone(f.records.get(ARCADE_RANKED_STORAGE_KEY));
    assert.equal(board.boards['gauntlet:normal:1-5'].length, 1);
    f.runtime.handleMatchEndTelemetry({ state: 'MATCH_END' });
    f.runtime.resetRunState({ preserveRecords: true });
    assert.deepEqual(f.records.get(ARCADE_RANKED_STORAGE_KEY), board);
});

test('a ranked run keeps the original actual build after profile purchases and a session rebuild', () => {
    const store = { readJsonRecordResult: () => ({ status: 'missing' }) };
    const runtime = { _playerStoresByIndex: { 0: store }, _playerProfilesByIndex: { 0: { ship5: { level: 6 } } } };
    const support = { arcadeRunRuntime: runtime, game: {} };
    const config = { arcade: { enabled: true, runType: 'gauntlet' }, player: { vehicles: { PLAYER_1: 'ship5' } } };
    const original = { byPlayerIndex: { 0: { build: { vehicleId: 'ship5', level: 6, mgLevel: 1 } } } };
    let strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    prepareArcadeRunRanking(support, { entityManager: { gameModeStrategy: strategy } }, config, false, original);
    original.byPlayerIndex[0].build.mgLevel = 10;
    strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    prepareArcadeRunRanking(support, { entityManager: { gameModeStrategy: strategy } }, config, true, original);
    strategy.applyVehicleUpgrades(original);
    assert.equal(strategy._slotBonusesByPlayerIndex[0].build.mgLevel, 1);
    assert.equal(runtime.rankContext.vehicleLevel, 6);
});
test('ranked boards isolate tiers and five-level ranges, freeze level and retain best ten once per run', () => {
    let lb;
    for (let i = 1; i <= 12; i++) lb = insertArcadeRankedResult(lb, context(`r${i}`), { score: i }, i).leaderboard;
    assert.equal(lb.boards['gauntlet:normal:1-5'].length, 10);
    assert.equal(lb.boards['gauntlet:normal:1-5'][0].score, 12);
    lb = insertArcadeRankedResult(lb, context('r12'), { score: 12 }, 12).leaderboard;
    assert.equal(lb.boards['gauntlet:normal:1-5'].length, 10);
    lb = insertArcadeRankedResult(lb, context('hard', 6, 'hard'), { score: 90 }).leaderboard;
    assert.equal(lb.boards['gauntlet:hard:6-10'][0].vehicleLevel, 6);
    assert.equal(lb.boards['gauntlet:normal:1-5'][0].score, 12);
    assert.equal(resolveArcadeParcoursRankKey('route', context('a', 5)), 'route:level:1-5');
    assert.equal(resolveArcadeParcoursRankKey('route', context('a', 6)), 'route:level:6-10');
    assert.equal(resolveArcadeParcoursRankKey('route', context('a', 6, 'normal', 'weapon_race')), 'route');
    const portal = context('p', 1, 'normal', 'five_portals');
    lb = insertArcadeRankedResult(lb, portal, { succeeded: true, totalMs: 2000 }).leaderboard;
    lb = insertArcadeRankedResult(lb, { ...portal, runId: 'p2' }, { succeeded: true, totalMs: 1000 }).leaderboard;
    assert.equal(lb.boards['five_portals:any:1-5'][0].score, 1000);
});

test('ranked persistence cannot replace inaccessible data or discard already settled legacy rewards', () => {
    const records = new Map();
    const store = { readJsonRecordResult: (key) => records.has(key) ? { status: 'found', value: records.get(key) } : { status: 'missing' },
        saveJsonRecord: (key, value) => { records.set(key, value); return { success: true }; } };
    const runtime = { rankContext: context('win'), _rankingStore: store };
    assert.equal(settleArcadeRunRanking(runtime, { succeeded: true, score: 123, completedSectors: 5 }).rank, 1);
    assert.deepEqual(records.get(ARCADE_DIFFICULTY_STORAGE_KEY).unlockedTierIds, ['normal', 'hard']);
    assert.ok(records.has(ARCADE_RANKED_STORAGE_KEY));
    let writes = 0;
    runtime._rankingStore = { readJsonRecordResult: () => ({ status: 'read_failed' }), saveJsonRecord: () => writes++ };
    assert.equal(settleArcadeRunRanking(runtime, { succeeded: true, score: 3, completedSectors: 5 }), null);
    assert.equal(writes, 0);
});

test('spawn bot factors apply to actual HP and damage, stay independent of shared vehicle human upgrades and never compound', () => {
    for (const combatProfile of ['', 'hunt']) {
        const strategy = new ArcadeModeStrategy({ runType: 'gauntlet', combatProfile });
        strategy._botRankBonuses = Object.freeze({ maxHpBonus: 0, speedBonusPct: 0, turningBonusPct: 0, botStrength: { hpFactor: 1.7, damageFactor: 1.4 } });
        const bot = { isBot: true, vehicleId: 'ship5', hp: 100, maxHp: 100 };
        const human = { isBot: false, vehicleId: 'ship5', hp: 100, maxHp: 100 };
        strategy.resetPlayerHealth(bot); strategy.applySpawnStatBonuses(bot);
        assert.equal(bot.maxHp, 170);
        assert.equal(bot.arcadeDamageMultiplier, 1.4);
        strategy.resetPlayerHealth(bot);
        assert.equal(bot.maxHp, 170);
        strategy.resetPlayerHealth(human);
        assert.equal(human.maxHp, 100);
        assert.equal(human.arcadeDamageMultiplier, 1);
    }
});
