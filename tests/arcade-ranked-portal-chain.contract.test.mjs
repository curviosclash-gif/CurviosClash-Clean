// Fünf Portale and Himmelsleiter both ride the five_portals run type but are different courses, so
// their ranked times need separate boards. The default chain keeps its old key: saved best times
// from before the split stay on the board they were written to.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { ARCADE_RANKED_STORAGE_KEY, ARCADE_RANKED_VERSION, insertArcadeRankedResult, resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { settleArcadeRunRanking } from '../src/state/arcade/ArcadeRunRanking.js';
import { prepareArcadeRunRanking } from '../src/core/arcade/ArcadeRunRankingOps.js';
import '../src/core/Config.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

const LEGACY_KEY = 'five_portals:any:1-5';
const legacyRow = { runId: 'legacy', vehicleId: 'ship5', vehicleLevel: 2, tierId: 'any', score: 90_000, completedWaves: 0, completedSectors: 0, date: '2026-09-01T10:00:00.000Z' };
const portalContext = (runId, portalChainId) => createArcadeRankContext({ runId, runType: 'five_portals', vehicleId: 'ship5', profile: { level: 1 }, portalChainId });

test('each portal chain ranks on its own board and Fünf Portale keeps its saved key', () => {
    assert.equal(resolveArcadeRankKey(portalContext('a', 'five_portals')), LEGACY_KEY);
    assert.equal(resolveArcadeRankKey(portalContext('a')), LEGACY_KEY, 'a missing chain id is the default chain');
    const skyKey = resolveArcadeRankKey(portalContext('a', 'sky_ladder'));
    assert.ok(skyKey && skyKey !== LEGACY_KEY, skyKey);
    assert.equal(portalContext('a', 'sky_ladder').portalChainId, 'sky_ladder');

    const saved = { schemaVersion: ARCADE_RANKED_VERSION, boards: { [LEGACY_KEY]: [legacyRow] } };
    const sky = insertArcadeRankedResult(saved, portalContext('sky', 'sky_ladder'), { succeeded: true, totalMs: 60_000 });
    assert.equal(sky.rank, 1);
    assert.deepEqual(sky.leaderboard.boards[LEGACY_KEY], [legacyRow], 'a Himmelsleiter time never lands on the Fünf Portale board');
    assert.equal(sky.leaderboard.boards[sky.key].length, 1);

    const five = insertArcadeRankedResult(sky.leaderboard, portalContext('five', 'five_portals'), { succeeded: true, totalMs: 80_000 });
    assert.deepEqual(five.leaderboard.boards[LEGACY_KEY].map((row) => row.runId), ['five', 'legacy'], 'the old best time is still found');
});

test('the runtime takes the chain from the run config', () => {
    const records = new Map([[ARCADE_RANKED_STORAGE_KEY, { schemaVersion: ARCADE_RANKED_VERSION, boards: { [LEGACY_KEY]: [legacyRow] } }]]);
    const store = {
        readJsonRecordResult: (key) => records.has(key) ? { status: 'found', value: structuredClone(records.get(key)) } : { status: 'missing' },
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const run = (portalChainId, runId) => {
        const fivePortalsRuntime = {};
        const support = { arcadeRunRuntime: { _playerStoresByIndex: { 0: store }, _playerProfilesByIndex: { 0: { ship5: { level: 1 } } } }, fivePortalsRuntime, game: {} };
        const config = { arcade: { enabled: true, runType: 'five_portals', portalChainId }, player: { vehicles: { PLAYER_1: 'ship5' } } };
        prepareArcadeRunRanking(support, { entityManager: { gameModeStrategy: new ArcadeModeStrategy({ runType: 'five_portals' }), humanPlayers: [] } },
            config, false, { byPlayerIndex: { 0: { build: { vehicleId: 'ship5', level: 1 } } } });
        fivePortalsRuntime.rankContext = { ...fivePortalsRuntime.rankContext, runId };
        return settleArcadeRunRanking(fivePortalsRuntime, { succeeded: true, totalMs: 50_000 });
    };
    const sky = run('sky_ladder', 'sky');
    assert.notEqual(sky.key, LEGACY_KEY);
    const five = run('five_portals', 'five');
    assert.equal(five.key, LEGACY_KEY);
    assert.deepEqual(records.get(ARCADE_RANKED_STORAGE_KEY).boards[LEGACY_KEY].map((row) => row.runId), ['five', 'legacy']);
});
