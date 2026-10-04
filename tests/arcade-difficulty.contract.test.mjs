import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeRankContext, evaluateArcadeDifficultyUnlock, loadArcadeDifficultyProgress, normalizeArcadeDifficultyProgress, resolveArcadeBotStrength, resolveArcadeCombatValue, resolveArcadeRunTier } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { resolveArcadeVehicleActiveStats } from '../src/shared/contracts/ArcadeVehicleActiveStatsContract.js';

test('Arcade difficulty unlocks sequentially, requires completed milestones and exempts fixed/test runs', () => {
    const empty = normalizeArcadeDifficultyProgress(null);
    assert.equal(resolveArcadeRunTier('nightmare', empty), 'normal');
    const context = createArcadeRankContext({ runId: 'a', runType: 'gauntlet', vehicleId: 'ship5', profile: { level: 1 } });
    assert.deepEqual(evaluateArcadeDifficultyUnlock(empty, context, { succeeded: false, completedSectors: 5 }), empty);
    const hard = evaluateArcadeDifficultyUnlock(empty, context, { succeeded: true, completedSectors: 5 }, 0);
    assert.deepEqual(hard.unlockedTierIds, ['normal', 'hard']);
    assert.equal(resolveArcadeRunTier('hard', hard), 'hard');
    assert.equal(resolveArcadeRunTier('hard', hard, { dailyChallenge: true }), 'normal');
    assert.equal(resolveArcadeRunTier('hard', hard, { runType: 'hangar_test' }), 'normal');
    assert.equal(resolveArcadeRunTier('hard', hard, { runType: 'five_portals' }), 'any');
    assert.equal(resolveArcadeRunTier('hard', hard, { runType: 'weapon_race' }), 'normal');
    const arena = { ...context, runType: 'arena_waves', tierId: 'hard' };
    assert.deepEqual(evaluateArcadeDifficultyUnlock(hard, arena, { completedWaves: 7 }), hard);
    assert.deepEqual(evaluateArcadeDifficultyUnlock(hard, arena, { completedWaves: 8 }, 1).unlockedTierIds, ['normal', 'hard', 'nightmare']);
    assert.deepEqual(evaluateArcadeDifficultyUnlock(hard, { ...arena, ranked: false }, { completedWaves: 99 }), hard);
});

test('Arcade combat value sees actual build values rather than vehicle level', () => {
    const factory = resolveArcadeVehicleActiveStats('ship5', null);
    assert.equal(resolveArcadeCombatValue(factory), 1);
    assert.equal(resolveArcadeBotStrength(factory).hpFactor, 1);
    assert.equal(resolveArcadeBotStrength(factory, 'nightmare').hpFactor, 1.2);
    const a = createArcadeRankContext({ runType: 'gauntlet', vehicleId: 'ship5', profile: { level: 1 } });
    const b = createArcadeRankContext({ runType: 'gauntlet', vehicleId: 'ship5', profile: { level: 50 } });
    assert.deepEqual(a.botStrength, b.botStrength);
    assert.deepEqual(b.levelRange, { min: 46, max: 50, label: '46–50' });
    assert.ok(resolveArcadeBotStrength({ ...factory, damagePct: 1000, mgDamagePct: 1000, rocketDamagePct: 1000 }).hpFactor > 1);
    assert.equal(createArcadeRankContext({ runType: 'hangar_test', vehicleId: 'ship5' }).ranked, false);
});

test('Arcade difficulty reads never write or replace inaccessible progression', () => {
    for (const status of ['invalid', 'read_failed']) {
        assert.equal(loadArcadeDifficultyProgress({ readJsonRecordResult: () => ({ status }), saveJsonRecord: () => assert.fail('write') }).status, 'unavailable');
    }
    assert.equal(loadArcadeDifficultyProgress({ readJsonRecordResult: () => ({ status: 'missing' }) }).status, 'created');
    const brokenSequence = normalizeArcadeDifficultyProgress({ schemaVersion: 'arcade-difficulty-progress.v1', unlockedTierIds: ['nightmare'] });
    assert.deepEqual(brokenSequence.unlockedTierIds, ['normal']);
});
