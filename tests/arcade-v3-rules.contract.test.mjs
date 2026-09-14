import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/core/Config.js';
import { computeDailySeed } from '../src/shared/utils/ArcadeUtils.js';
import { buildArcadeSectorPlan, resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { assignSectorMissions, createSectorMissionState, updateSectorMissionState } from '../src/state/arcade/ArcadeMissionState.js';
import { reanchorArcadeCombo, applyArcadeComboDecay, applyComboAction, computeArcadeSectorScoreBreakdown } from '../src/state/arcade/ArcadeScoreOps.js';
import { resolveArcadeDailySettings } from '../src/shared/contracts/ArcadeDailyRulesContract.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { eligibleArcadeMission } from '../src/state/arcade/ArcadeMissionEligibility.js';

test('authored low-HP missions retain their default target and are skipped without recovery', () => {
    const context = { hasHealing: false };
    assert.equal(eligibleArcadeMission({ type: 'CLOSE_CALL' }, context, true), null);
    assert.equal(eligibleArcadeMission({ type: 'CLOSE_CALL', params: { target: 3 } }, context, true), null);
    assert.equal(eligibleArcadeMission({ type: 'CLOSE_CALL', params: { target: 1 } }, context, true).params.target, 1);
    assert.equal(eligibleArcadeMission({ type: 'CLOSE_CALL' }, context).params.target, 1);
});

function validateMissions(missions, context) {
    assert.equal(new Set(missions.map(m => m.type)).size, missions.length);
    for (const mission of missions) {
        if (['KILL_COUNT', 'MULTI_KILL'].includes(mission.type)) assert.ok(mission.params.target <= context.botCount && context.botCount > 0);
        if (mission.type === 'MULTI_KILL') assert.ok(mission.params.target >= 2);
        if (mission.type === 'REACH_PORTAL') assert.ok(context.hasExitPortal);
        if (['COLLECT_ITEMS', 'ITEM_CHAIN'].includes(mission.type)) assert.ok(context.hasItems);
        if (mission.type === 'NO_DAMAGE') assert.ok(!context.unavoidableDamage);
        if (mission.type === 'CLOSE_CALL' && !context.hasHealing) assert.ok(mission.params.target <= 1);
    }
    const survival = missions.find(m => m.type === 'SURVIVE_DURATION');
    const speed = missions.find(m => m.type === 'TIME_TRIAL');
    if (survival && speed) assert.ok(survival.params.target <= speed.params.target);
}

test('mission feasibility across 200 seeds, three run lengths and all standard difficulties', () => {
    for (let seed = 1; seed <= 200; seed++) for (const sectorCount of [1, 5, 20]) for (const difficulty of ['easy', 'normal', 'hard']) {
        const plan = buildArcadeSectorPlan({ seed, sectorCount, difficulty });
        for (const entry of plan.sequence) {
            const context = { ...resolveArcadeSectorRuntimeProfile(entry), hasItems: true,
                hasExitPortal: false, unavoidableDamage: entry.modifierId === 'heat_stress' };
            const missions = assignSectorMissions(entry.templateId, null, seed, entry.sectorNumber, context);
            validateMissions(missions, context);
            assert.deepEqual(missions, assignSectorMissions(entry.templateId, null, seed, entry.sectorNumber, context));
        }
    }
});

test('authored pools and bonus missions respect actual map capabilities without mutation', () => {
    for (const map of Object.values(CONFIG.MAPS)) {
        const before = JSON.stringify(map);
        const context = { botCount: map.parcours?.enabled ? 0 : 2, parcoursEnabled: !!map.parcours?.enabled,
            hasItems: !!map.items?.length, hasExitPortal: !!map.exitPortal, unavoidableDamage: true, hasHealing: false };
        for (let seed = 1; seed <= 40; seed++) {
            validateMissions(assignSectorMissions(context.parcoursEnabled ? 'sector_parcours' : 'sector_hazard', map.missions, seed, 4, context), context);
        }
        assert.equal(JSON.stringify(map), before);
    }
});

test('empty missions give no completion bonus and empty parcours receives a finish task', () => {
    assert.equal(updateSectorMissionState(createSectorMissionState([]), { type: 'sector_complete' }).allCompleted, false);
    const missions = assignSectorMissions('sector_parcours', [{ type: 'KILL_COUNT', params: { target: 8 } }], 1, 1,
        { botCount: 0, parcoursEnabled: true, unavoidableDamage: true });
    assert.ok(missions.some(m => m.type === 'PARCOURS_COMPLETE'));
    assert.ok(!missions.some(m => ['KILL_COUNT', 'MULTI_KILL'].includes(m.type)));
});

test('combo decay is independent of tick frequency and accepts timestamp zero', () => {
    const config = { comboWindowMs: 5000, comboDecayPerSecond: 1, maxMultiplier: 8 };
    const initial = { combo: 8, lastComboAtMs: 0 };
    const once = applyArcadeComboDecay(initial, config, 9000);
    for (const step of [1000, 1000 / 60]) {
        let score = initial;
        for (let elapsed = step; elapsed < 9000; elapsed += step) score = applyArcadeComboDecay(score, config, elapsed);
        score = applyArcadeComboDecay(score, config, 9000);
        assert.equal(score.combo, once.combo);
    }
    assert.equal(once.combo, 3);
    assert.equal(applyArcadeComboDecay(initial, config, 5000).combo, 8);
    let score = applyComboAction(once, { type: 'collect', nowMs: 9000 }, config);
    score = applyComboAction(score, { type: 'collect', nowMs: 9000 }, config);
    assert.equal(score.combo, 4);
    assert.equal(score.comboDecayApplied, 0);
    assert.equal(applyComboAction(score, { type: 'kill', nowMs: 10000 }, config).combo, 5);
});

test('parcours rewards completion, logical checkpoints, speed and precision without double penalties', () => {
    const score = (time, extra = {}) => computeArcadeSectorScoreBreakdown({ duration: time / 1000 }, {
        sectorTemplateId: 'sector_parcours', parcours: { completionTimeMs: time, referenceTimeMs: 60000, checkpointCount: 10, ...extra },
    });
    assert.deepEqual([30000, 60000, 90000].map(t => score(t).total), [1700, 1450, 1200]);
    assert.equal(score(60000).survival, 0);
    assert.equal(score(60000).risk, 0);
    assert.equal(score(62000, { penaltyTimeMs: 2000 }).time, 483);
    for (const key of ['wrongOrderCount', 'resetCount', 'checkpointRespawnsUsed']) assert.equal(score(60000, { [key]: 1 }).precision, 0);
    assert.equal(score(NaN).time, 0);
    assert.equal(score(0).time, 0);
    assert.equal(score(300000).time, 0);
    assert.equal(computeArcadeSectorScoreBreakdown({ duration: 60 }, { sectorTemplateId: 'sector_intro' }).survival, 1320);
});

test('Daily runtime fixes gameplay settings while preserving the personal source and controls', () => {
    const settings = { localSettings: { modePath: 'arcade', sessionType: 'splitscreen' },
        arcade: { dailyChallenge: true, seed: 123, sectorCount: 20, maxMultiplier: 25 },
        vehicles: { PLAYER_1: 'ship1' }, gameplay: { speed: 99, trailLength: 999, planarMode: true }, botDifficulty: 'HARD' };
    const before = JSON.stringify(settings);
    const runtime = createRuntimeConfigSnapshot(settings);
    const other = createRuntimeConfigSnapshot({ ...settings, gameplay: { speed: 10 }, vehicles: { PLAYER_1: 'ship9' } });
    assert.equal(runtime.session.numHumans, 1);
    assert.equal(runtime.player.vehicles.PLAYER_1, 'ship5');
    assert.equal(runtime.arcade.sectorCount, 5);
    assert.equal(runtime.arcade.maxMultiplier, 8);
    assert.equal(runtime.bot.activeDifficulty, 'NORMAL');
    assert.deepEqual(runtime.player, other.player);
    assert.deepEqual(runtime.trail, other.trail);
    assert.equal(JSON.stringify(settings), before);
    // The daily turns over at midnight German time: 22:00 UTC in summer, 23:00 UTC in winter.
    const day1 = resolveArcadeDailySettings(settings, new Date('2026-09-08T21:59:59Z'));
    const day2 = resolveArcadeDailySettings(settings, new Date('2026-09-08T22:00:00Z'));
    assert.equal(day1.arcade.seed, 20260908);
    assert.equal(day2.arcade.seed, 20260909);
    assert.equal(computeDailySeed(new Date('2026-12-31T22:59:59Z')), 20261231);
    assert.equal(computeDailySeed(new Date('2026-12-31T23:00:00Z')), 20270101);
});

test('the arcade menu offers the same daily seed the run starts with', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    // A private copy of the date rule drifted once already (UTC in the menu, local rules in the run).
    assert.equal(source.includes('function computeDailySeed'), false, 'the menu keeps no private copy of the date rule');
    assert.equal(
        /import \{[^}]*\bcomputeDailySeed\b[^}]*\} from '..\/..\/shared\/utils\/ArcadeUtils\.js'/.test(source),
        true,
        'the menu takes the daily seed from the shared rule',
    );
});


test('changed combo rules apply from activation without recalculating past decay', () => {
    const state = { score: { combo: 12, lastComboAtMs: 0 },
        config: { comboWindowMs: 5000, comboDecayPerSecond: 1, maxMultiplier: 8 }, gameplayTimeMs: 9000 };
    reanchorArcadeCombo(state);
    assert.equal(state.score.combo, 7);
    state.config.comboWindowMs = 6000;
    const atActivation = applyArcadeComboDecay(state.score, state.config, 9000);
    assert.equal(atActivation.combo, 7);
    assert.equal(applyArcadeComboDecay(atActivation, state.config, 15000).combo, 7);
    assert.equal(applyArcadeComboDecay(atActivation, state.config, 17000).combo, 6);
});

test('mission time windows accept a first pickup at active time zero', () => {
    const missions = assignSectorMissions('sector_intro', [{ type: 'ITEM_CHAIN', params: { target: 2 } }], 1, 1,
        { hasItems: true, botCount: 0 });
    let state = createSectorMissionState(missions);
    state = updateSectorMissionState(state, { type: 'collect', nowMs: 0 });
    state = updateSectorMissionState(state, { type: 'collect', nowMs: 1000 });
    assert.equal(state.allCompleted, true);
});
