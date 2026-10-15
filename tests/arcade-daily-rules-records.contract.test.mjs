import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRunConfig, createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import { buildArcadeRunSummary } from '../src/state/arcade/ArcadeScoreOps.js';
import { createArcadeDailyProjection, mergeArcadeDailyRunRecords } from '../src/state/arcade/ArcadeDailyState.js';
import { normalizeArcadeDailyRecord, findArcadeDailyRecord } from '../src/state/arcade/ArcadeDailyRecordOps.js';
import { ARCADE_DAILY_RULES_VERSION } from '../src/shared/contracts/ArcadeDailyRulesContract.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';

const seed = 20261015;
const legacy = { seed, runsPlayed: 3, bestScore: 99999, bestRunAt: '2026-10-15T10:00:00Z',
    lastScore: 90000, lastRunAt: '2026-10-15T11:00:00Z', lastRecordedRunId: 'old-run', note: 'preserve metadata' };
const initial = () => ({ ...createArcadeRunRecords(), daily: structuredClone(legacy) });
const summary = (score = 100, runId = 'new-run', extra = {}) => ({ seed, score, runId,
    isDailyChallenge: true, dailyRulesVersion: ARCADE_DAILY_RULES_VERSION, finishedAtIso: '2026-10-15T12:00:00Z', ...extra });

test('legacy same-day values are preserved but cannot appear as the current equipment best', () => {
    const records = initial();
    const before = structuredClone(records);
    assert.equal(createArcadeDailyProjection(records, '2026-10-15').playedToday, false);
    assert.equal(createArcadeDailyProjection(records, '2026-10-15').bestScore, 0);
    assert.deepEqual(records, before);
    const next = mergeArcadeDailyRunRecords(records, summary());
    assert.equal(next.records.daily.bestScore, 100);
    assert.equal(next.dailyResult.previousBestScore, 0);
    assert.equal(next.dailyResult.isNewBest, true);
    assert.equal(next.dailyResult.attempt, 1);
    assert.equal(next.records.daily.history.length, 1);
    assert.deepEqual(findArcadeDailyRecord(next.records.daily, seed, ''), { ...legacy,
        rulesVersion: '', lastSucceeded: false, lastCompletedSectors: 0 });
});

test('unlimited comparable attempts retain the best, identify ties and archive the old rules only once', () => {
    let records = initial();
    for (const [index, score] of [100, 50, 100, 200].entries()) {
        const next = mergeArcadeDailyRunRecords(records, summary(score, `attempt-${index}`));
        assert.equal(next.dailyResult.attempt, index + 1);
        assert.equal(next.dailyResult.bestScore, index === 3 ? 200 : 100);
        assert.equal(next.dailyResult.isNewBest, index === 0 || index === 3);
        assert.equal(next.dailyResult.tiedBest, index === 2);
        assert.equal(next.records.daily.history.length, 1);
        records = createArcadeRunRecords(JSON.parse(JSON.stringify(next.records)));
    }
    assert.equal(createArcadeDailyProjection(records, '2026-10-15').bestScore, 200);
    assert.equal(records.daily.history[0].bestScore, 99999);
    assert.equal(records.daily.history[0].note, legacy.note);
});

test('a repeated receipt cannot count another Daily attempt or create another historical snapshot', () => {
    const first = mergeArcadeDailyRunRecords(initial(), summary());
    const second = mergeArcadeDailyRunRecords(first.records, summary());
    assert.deepEqual(second.records.daily, first.records.daily);
});

test('a best without an attempt counter is preserved and cannot announce a lower score as a new best', () => {
    const records = { ...createArcadeRunRecords(), daily: { seed, bestScore: 99999, note: 'missing counter' } };
    const migrated = mergeArcadeDailyRunRecords(records, summary());
    assert.equal(migrated.records.daily.history[0].bestScore, 99999);
    assert.equal(migrated.records.daily.history[0].note, 'missing counter');
    records.daily.rulesVersion = ARCADE_DAILY_RULES_VERSION;
    const projection = createArcadeDailyProjection(records, '2026-10-15');
    assert.equal(projection.playedToday, true);
    assert.equal(projection.bestScore, 99999);
    assert.equal(projection.runsPlayed, 0);
    const comparable = mergeArcadeDailyRunRecords(records, summary());
    assert.equal(comparable.dailyResult.previousBestScore, 99999);
    assert.equal(comparable.dailyResult.bestScore, 99999);
    assert.equal(comparable.dailyResult.isNewBest, false);
});

test('switching rules and returning to a previous partition preserves both bests and the current projection', () => {
    const first = mergeArcadeDailyRunRecords(initial(), summary());
    const future = mergeArcadeDailyRunRecords(first.records, summary(50, 'v2-run', { dailyRulesVersion: 'arcade-daily.v2' }));
    assert.equal(future.records.daily.bestScore, 50);
    assert.equal(createArcadeDailyProjection(future.records, '2026-10-15').bestScore, 100);
    const repeatedOld = mergeArcadeDailyRunRecords(future.records, summary());
    assert.deepEqual(repeatedOld.records.daily, future.records.daily);
    const resumed = mergeArcadeDailyRunRecords(future.records, summary(80, 'v1-again'));
    assert.equal(resumed.records.daily.runsPlayed, 2);
    assert.equal(resumed.records.daily.bestScore, 100);
    assert.equal(findArcadeDailyRecord(resumed.records.daily, seed, 'arcade-daily.v2').bestScore, 50);
    assert.equal(findArcadeDailyRecord(resumed.records.daily, seed, '').bestScore, 99999);
});

test('normal day rollover resets the current best while preserving archived rule values', () => {
    const today = mergeArcadeDailyRunRecords(initial(), summary()).records;
    const tomorrow = mergeArcadeDailyRunRecords(today, summary(75, 'tomorrow', { seed: 20261016 })).records;
    assert.equal(tomorrow.daily.runsPlayed, 1);
    assert.equal(tomorrow.daily.bestScore, 75);
    assert.equal(tomorrow.daily.history[0].bestScore, 99999);
    assert.equal(createArcadeDailyProjection(tomorrow, '2026-10-15').bestScore, 0);
    assert.equal(createArcadeDailyProjection(tomorrow, '2026-10-16').bestScore, 75);
});

test('invalid history shapes are harmless and normalization does not mutate valid historical metadata', () => {
    for (const history of [null, 'bad', { find: 2 }]) {
        assert.equal(findArcadeDailyRecord({ history }, seed, ARCADE_DAILY_RULES_VERSION), null);
        assert.deepEqual(normalizeArcadeDailyRecord({ history }).history, []);
    }
    const record = { ...legacy, history: [{ ...legacy, rulesVersion: 'older' }] };
    const before = structuredClone(record);
    assert.equal(normalizeArcadeDailyRecord(record).history[0].note, legacy.note);
    assert.deepEqual(record, before);
});

test('run configuration and summaries carry the actual Daily rules while ordinary runs stay unversioned', () => {
    const config = createArcadeRunConfig({ enabled: true, dailyChallenge: true });
    assert.equal(config.dailyRulesVersion, ARCADE_DAILY_RULES_VERSION);
    assert.equal(createArcadeRunConfig({ dailyChallenge: false, dailyRulesVersion: 'forged' }).dailyRulesVersion, '');
    assert.equal(buildArcadeRunSummary({ config, score: { total: 1 } }).dailyRulesVersion, ARCADE_DAILY_RULES_VERSION);
});

test('a real runtime Daily settlement retries storage and reloads without losing legacy values or duplicating attempts', () => {
    let allowSave = false;
    const values = new Map([[ARCADE_RUN_PROFILE_STORAGE_KEY, initial()]]);
    const store = {
        loadJsonRecord: (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback,
        saveJsonRecord: (key, value) => { if (!allowSave) return false; values.set(key, structuredClone(value)); return true; },
    };
    const runtime = new ArcadeRunRuntime({ now: () => Date.parse('2026-10-15T12:00:00Z'),
        settingsManager: { getPlayerRecordStorePort: () => store }, arcadePersistenceSaveThrottleMs: 0 });
    runtime.configure({ arcade: { enabled: true, sectorCount: 1 } });
    runtime.startDailyChallenge({ date: '2026-10-15' });
    assert.equal(runtime.getStateSnapshot().config.dailyRulesVersion, ARCADE_DAILY_RULES_VERSION);
    const plan = runtime.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: true, hp: 100 }],
        inputs: { reason: 'ARCADE_OBJECTIVE' }, baseController: {} });
    runtime.handleRoundEndTelemetry({ state: plan.outcome.state, duration: 20, kills: 1 });
    runtime.resolveVictoryChoice('finish');
    const settled = runtime.getRecordsSnapshot().daily;
    assert.equal(settled.runsPlayed, 1);
    assert.ok(settled.bestScore > 0 && settled.bestScore < 99999);
    assert.equal(settled.history[0].bestScore, 99999);
    assert.equal(values.get(ARCADE_RUN_PROFILE_STORAGE_KEY).daily.bestScore, 99999);
    allowSave = true;
    runtime.flushPersistenceSaves();
    runtime.handleMatchEndTelemetry({ state: 'MATCH_END' });
    assert.deepEqual(values.get(ARCADE_RUN_PROFILE_STORAGE_KEY).daily, settled);
    runtime.configure({ arcade: { enabled: true, dailyChallenge: true, seed } });
    assert.deepEqual(runtime.getRecordsSnapshot().daily, settled);
});
