// Every Arcade gameplay event passed through the run with its simulation time and was thrown away
// afterwards. The run now keeps the notable ones, so the result can name the moments of the run.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ARCADE_MOMENT_LOG_LIMIT, readArcadeMoments } from '../src/state/arcade/ArcadeRunMomentLog.js';

function startRun(seed = 11) {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000 });
    run.configure({ arcade: { enabled: true, seed, sectorCount: 3 } });
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed, sectorCount: 3 }) });
    return run;
}

const kill = (victimIndex) => ({ type: 'kill', playerIndex: 0, victimIndex, count: 1 });

test('kills, a close call and factor steps are kept with their simulation time', () => {
    const run = startRun();
    run.tickGameplay(2);
    run.applyGameplayEvent(kill(3));
    run.applyGameplayEvent(kill(4));
    run.tickGameplay(1.5);
    run.applyGameplayEvent({ type: 'damage', playerIndex: 0, hp: 12, maxHp: 100 });
    run.applyGameplayEvent({ type: 'damage', playerIndex: 0, hp: 8, maxHp: 100 });
    run.applyGameplayEvent({ type: 'trail_extend', playerIndex: 0, delta: 3 });

    const moments = readArcadeMoments(run);
    assert.deepEqual(moments.map((entry) => entry.type), ['kill', 'kill', 'combo_tier_up', 'low_hp']);
    assert.equal(moments[0].tMs, 2000, 'times come from the simulation clock');
    assert.equal(moments[0].sector, 1);
    assert.deepEqual([moments[2].a, moments[2].b], [2, 2], 'the second kill lifts the factor to ×2');
    assert.deepEqual([moments[3].tMs, moments[3].b], [3500, 12], 'only the first drop below 20 % counts');
});

test('a companion kill is marked, an uncredited bot death is not a kill', () => {
    const run = startRun();
    run.applyGameplayEvent({ ...kill(5), companion: true, scoreFactor: 0.5 });
    run.applyGameplayEvent({ type: 'kill', victimIndex: 6, count: 0 });
    const kills = readArcadeMoments(run).filter((entry) => entry.type === 'kill');
    assert.equal(kills.length, 1);
    assert.equal(kills[0].b, 1);
});

test('a healed pilot can register a new low-health moment in the next sector', () => {
    const run = startRun(15);
    const player = { index: 0, isBot: false, alive: true, hp: 10, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
    run.applyGameplayEvent({ type: 'damage', playerIndex: 0, hp: 10, maxHp: 100 });
    run.deriveRoundEndPlan({ players: [player], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 10, kills: 0 });

    run.beginNextSector();
    run.applyPendingIntermissionEffects({ players: [player] });
    assert.ok(player.hp > 20, 'the public intermission effect heals the pilot above the low-health threshold');
    run.applyGameplayEvent({ type: 'damage', playerIndex: 0, hp: 15, maxHp: 100 });

    assert.deepEqual(readArcadeMoments(run).filter((entry) => entry.type === 'low_hp').map((entry) => entry.sector), [1, 2]);
});

test('the log stays bounded and starts empty for the next run', () => {
    const run = startRun();
    for (let i = 0; i < ARCADE_MOMENT_LOG_LIMIT + 40; i += 1) run.applyGameplayEvent(kill(i % 7));
    assert.equal(readArcadeMoments(run).length, ARCADE_MOMENT_LOG_LIMIT);

    run.resetRunState();
    run.startRun({ strategy: new ArcadeModeStrategy(), encounterPlan: buildArcadeSectorPlan({ seed: 12, sectorCount: 3 }) });
    assert.equal(readArcadeMoments(run).length, 0);
});
