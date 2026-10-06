// A run only enters the ranked boards with the contract's standard score settings: sector count,
// combo window, combo decay and the multiplier cap feed the gauntlet score directly, so a run with
// 20 sectors and a 25x cap must not share a board with standard runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { createDefaultArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ARCADE_RANKED_STORAGE_KEY } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
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
    assert.equal(settleArcadeRunRanking(standard, { succeeded: true, score: 500, completedSectors: 5 }).rank, 1);
});
