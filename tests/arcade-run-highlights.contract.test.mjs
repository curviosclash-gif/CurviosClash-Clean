// After a run the result now names one to three moments of it ("Moment des Runs"), picked from the
// run's moment log. The pick is deterministic: the same log always gives the same moments.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { selectArcadeRunHighlights } from '../src/state/arcade/ArcadeRunHighlights.js';
import { createArcadeRunBlocks } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';

const m = (tMs, sector, type, a = 0, b = 0) => ({ tMs, sector, type, a, b });

test('a close call that the sector survived, a kill burst and a factor peak are the moments', () => {
    const moments = [
        m(1000, 1, 'kill', 3), m(4000, 1, 'kill', 4), m(4100, 1, 'combo_tier_up', 2, 2),
        m(20_000, 2, 'low_hp', 0, 7),
        m(22_000, 2, 'kill', 5), m(24_000, 2, 'kill', 6), m(25_500, 2, 'kill', 7), m(25_600, 2, 'combo_tier_up', 4, 6),
    ];
    const picked = selectArcadeRunHighlights({ moments, completedSectors: 2 });
    assert.deepEqual(picked.map((entry) => entry.kind), ['close_escape', 'multi_kill', 'combo_peak']);
    assert.deepEqual(picked[0].metrics, { hpPct: 7, killsAfter: 3 });
    assert.deepEqual(picked[1].metrics, { kills: 3, seconds: 3.5 });
    assert.equal(picked[2].metrics.multiplier, 4);
    assert.deepEqual(selectArcadeRunHighlights({ moments, completedSectors: 2 }), picked, 'same log, same moments');
});

test('a close call in the sector that ended the run is no escape', () => {
    const picked = selectArcadeRunHighlights({ moments: [m(20_000, 3, 'low_hp', 0, 9)], completedSectors: 2 });
    assert.equal(picked.some((entry) => entry.kind === 'close_escape'), false);
});

test('close-escape follow-up kills stay in the low-health moment sector', () => {
    const moments = [m(20_000, 1, 'low_hp', 0, 7), m(20_100, 2, 'kill'), m(20_200, 2, 'kill')];
    const close = selectArcadeRunHighlights({ moments, completedSectors: 2 }).find((entry) => entry.kind === 'close_escape');
    assert.equal(close?.metrics.killsAfter, 0);
});

test('a new record and a beaten ghost outrank smaller moments, and at most three remain', () => {
    const moments = [m(1000, 1, 'missions_all_complete'), m(2000, 1, 'combo_tier_up', 3, 4)];
    const picked = selectArcadeRunHighlights({
        moments, completedSectors: 1, score: 9000, previousBestScore: 8000,
        parcoursResult: { status: 'new_best', improvementMs: 1370, previousGhostAvailable: true },
    });
    assert.deepEqual(picked.map((entry) => entry.kind), ['new_record', 'ghost_beaten', 'combo_peak']);
    assert.equal(picked[0].metrics.margin, 1000);
    assert.equal(selectArcadeRunHighlights({ moments: [], completedSectors: 0 }).length, 0);
});

test('a kill burst does not cross a sector boundary when the simulation clock barely moves', () => {
    const moments = [m(10_000, 1, 'kill'), m(11_000, 1, 'kill'), m(11_100, 2, 'kill')];
    assert.equal(selectArcadeRunHighlights({ moments }).some((entry) => entry.kind === 'multi_kill'), false);
});

test('the result board lists the moments of a finished run', () => {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000 });
    run.configure({ arcade: { enabled: true, seed: 4, sectorCount: 3 } });
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 4, sectorCount: 3 }) });
    run.applyGameplayEvent({ type: 'damage', playerIndex: 0, hp: 6, maxHp: 100 });
    for (let i = 0; i < 4; i += 1) run.applyGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: i + 1, count: 1 });
    run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: true, hp: 6, maxHp: 100 }], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 20, kills: 4 });
    run.beginNextSector();
    run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: false, hp: 0 }], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 2, kills: 0 });

    const summary = run.getStateSnapshot().postRunSummary;
    assert.equal(summary.highlights[0]?.kind, 'close_escape');
    const block = createArcadeRunBlocks(summary).find((entry) => entry.id === 'arcade-highlights');
    assert.ok(block, 'the result shows a moments card');
    assert.match(block.rows[0].label, /Knapp entkommen/);
    assert.match(String(block.rows[0].value), /6 % Leben/);
});
