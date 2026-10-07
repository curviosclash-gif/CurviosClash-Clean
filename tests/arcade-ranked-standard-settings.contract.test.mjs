// A run only enters the ranked boards with the contract's standard score settings: sector count,
// combo window, combo decay and the multiplier cap feed the gauntlet score directly, so a run with
// 20 sectors and a 25x cap must not share a board with standard runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { createDefaultArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ARCADE_RANKED_STORAGE_KEY, ARCADE_RANKED_VERSION, resolveArcadeParcoursRankKey, resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { settleArcadeRunRanking } from '../src/state/arcade/ArcadeRunRanking.js';
import { prepareArcadeRunRanking } from '../src/core/arcade/ArcadeRunRankingOps.js';
import '../src/core/Config.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

const base = { runId: 'r', vehicleId: 'ship5', profile: { level: 1 }, tierId: 'normal' };
const CUSTOM = [['sectorCount', 20], ['maxMultiplier', 25], ['comboDecayPerSecond', 0], ['comboWindowMs', 20_000]];

test('a gauntlet run with any changed score setting is not ranked and says why', () => {
    const standard = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: createDefaultArcadeRunSettings() });
    assert.equal(standard.ranked, true);
    assert.equal(standard.customSettings, false);
    for (const [key, value] of CUSTOM) {
        const context = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: { ...createDefaultArcadeRunSettings(), [key]: value } });
        assert.equal(context.ranked, false, key);
        assert.equal(context.customSettings, true, key);
        // The squad still follows the player's vehicle; only the board entry is withheld.
        assert.equal(context.strengthScaled, true, key);
    }
});

test('settings that never reach a run type score leave that run ranked', () => {
    const custom = { ...createDefaultArcadeRunSettings(), sectorCount: 20, maxMultiplier: 25, comboDecayPerSecond: 0 };
    for (const runType of ['arena_waves', 'endless_parcours', 'five_portals']) {
        const context = createArcadeRankContext({ ...base, runType, runSettings: custom });
        assert.equal(context.ranked, true, runType);
        assert.equal(context.customSettings, false, runType);
    }
    // The intermission length only paces the pause between sectors.
    const paused = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: { ...createDefaultArcadeRunSettings(), intermissionSeconds: 3 } });
    assert.equal(paused.ranked, true);
});

test('the runtime ranks with the run settings the match started with and writes no board for custom ones', () => {
    const records = new Map();
    const store = {
        readJsonRecordResult: (key) => records.has(key) ? { status: 'found', value: records.get(key) } : { status: 'missing' },
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const prepare = (arcade) => {
        const runtime = { _playerStoresByIndex: { 0: store }, _playerProfilesByIndex: { 0: { ship5: { level: 1 } } } };
        const support = { arcadeRunRuntime: runtime, game: {} };
        const config = { arcade: { enabled: true, runType: 'gauntlet', ...arcade }, player: { vehicles: { PLAYER_1: 'ship5' } } };
        const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
        prepareArcadeRunRanking(support, { entityManager: { gameModeStrategy: strategy, humanPlayers: [] } }, config, false,
            { byPlayerIndex: { 0: { build: { vehicleId: 'ship5', level: 1 } } } });
        return runtime;
    };
    const custom = prepare({ ...createDefaultArcadeRunSettings(), maxMultiplier: 25, sectorCount: 20 });
    assert.equal(custom.rankContext.ranked, false);
    assert.equal(settleArcadeRunRanking(custom, { succeeded: true, score: 99_999, completedSectors: 20 }), null);
    assert.equal(records.has(ARCADE_RANKED_STORAGE_KEY), false);

    const standard = prepare(createDefaultArcadeRunSettings());
    assert.equal(standard.rankContext.ranked, true);
    assert.equal(standard.rankContext.scoreModel, 'arcade-score.v4', 'the runtime passes the exact model from its frozen run settings');
    assert.equal(settleArcadeRunRanking(standard, { succeeded: true, score: 500, completedSectors: 5 }).rank, 1);
    assert.ok(records.get(ARCADE_RANKED_STORAGE_KEY).boards['gauntlet:arcade-score.v4:normal:1-5']);
});

test('custom score settings keep parcours times on the level board; companions and Daily do not', () => {
    // Sector count, combo and multiplier change points, not the flight time on a course (user decision 2026-10-12).
    const settings = (patch) => ({ ...createDefaultArcadeRunSettings(), ...patch });
    const custom = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: settings({ sectorCount: 20, maxMultiplier: 25 }) });
    assert.equal(custom.ranked, false, 'the run itself stays off the score board');
    assert.equal(resolveArcadeParcoursRankKey('route_a', custom), 'route_a:level:1-5');
    const helped = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: settings({}), companionCount: 1 });
    assert.equal(resolveArcadeParcoursRankKey('route_a', helped), 'route_a', 'companions fly the course with help');
    const daily = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: settings({}), dailyChallenge: true });
    assert.equal(resolveArcadeParcoursRankKey('route_a', daily), 'route_a', 'the Daily keeps its shared route board');
    const standard = createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: settings({}) });
    assert.equal(resolveArcadeParcoursRankKey('route_a', standard), 'route_a:level:1-5');
});

test('entries saved before the standard-settings rule stay on their board untouched', () => {
    // Before this rule a 20-sector run with a 25x cap was written to the standard board. Those rows
    // carry no settings, so they cannot be told apart and are deliberately kept, not filtered.
    const legacy = { runId: 'legacy', vehicleId: 'ship5', vehicleLevel: 1, tierId: 'normal', score: 99_999,
        completedWaves: 0, completedSectors: 20, date: '2026-10-01T10:00:00.000Z' };
    const key = resolveArcadeRankKey(createArcadeRankContext({ ...base, runType: 'gauntlet', runSettings: createDefaultArcadeRunSettings() }));
    assert.equal(key, 'gauntlet:normal:1-5');
    const records = new Map([[ARCADE_RANKED_STORAGE_KEY, { schemaVersion: ARCADE_RANKED_VERSION, boards: { [key]: [legacy] } }]]);
    const store = {
        readJsonRecordResult: (k) => records.has(k) ? { status: 'found', value: structuredClone(records.get(k)) } : { status: 'missing' },
        loadJsonRecord: (k, fallback) => records.has(k) ? structuredClone(records.get(k)) : fallback,
        saveJsonRecord: (k, value) => { records.set(k, structuredClone(value)); return true; },
    };
    const runFor = (runSettings, runId) => ({ _rankingStore: store,
        rankContext: createArcadeRankContext({ ...base, runId, runType: 'gauntlet', runSettings }) });

    assert.equal(settleArcadeRunRanking(runFor({ ...createDefaultArcadeRunSettings(), sectorCount: 20 }, 'custom'),
        { succeeded: true, score: 123_456, completedSectors: 20 }), null);
    assert.deepEqual(records.get(ARCADE_RANKED_STORAGE_KEY).boards[key], [legacy]);

    assert.equal(settleArcadeRunRanking(runFor(createDefaultArcadeRunSettings(), 'standard'),
        { succeeded: true, score: 500, completedSectors: 5 }).rank, 2);
    const rows = records.get(ARCADE_RANKED_STORAGE_KEY).boards[key];
    assert.deepEqual(rows.map((row) => row.runId), ['legacy', 'standard']);
    assert.deepEqual(rows[0], legacy);
});
