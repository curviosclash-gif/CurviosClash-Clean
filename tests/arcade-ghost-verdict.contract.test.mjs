// "Did I beat my ghost?" was only answered in the arcade menu card, after leaving the result board.
// The run result now carries the parcours finish of this run and shows the verdict as its own card.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { applyParcoursLeaderboardEvent } from '../src/core/arcade/ArcadeParcoursLeaderboardOps.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { selectArcadeRunHighlights } from '../src/state/arcade/ArcadeRunHighlights.js';
import { createArcadeRunBlocks } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';

const verdictOf = (parcoursResult) => createArcadeRunBlocks({ score: 100, parcoursResult })
    .find((block) => block.id === 'arcade-ghost-verdict') || null;
const rowValue = (block, key) => block?.rows?.find((row) => row.key === key)?.value;

test('a new best time reads as a beaten ghost with the margin', () => {
    const block = verdictOf({ status: 'new_best', totalTimeMs: 41_230, previousBestTimeMs: 42_600, improvementMs: 1370, rank: 1, previousGhostAvailable: true });
    assert.equal(block?.title, 'Ghost geschlagen');
    assert.equal(rowValue(block, 'time'), 41.23);
    assert.equal(rowValue(block, 'margin'), 1.37);
});

test('a slower run names the gap to the ghost and the place', () => {
    const block = verdictOf({ status: 'ranked', totalTimeMs: 43_020, bestTimeMs: 42_600, deltaToBestMs: 420, rank: 3, previousGhostAvailable: true });
    assert.equal(block?.title, 'Hinter deinem Ghost');
    assert.equal(rowValue(block, 'gap'), 0.42);
    assert.equal(rowValue(block, 'rank'), '3');
    const withoutGhost = verdictOf({ status: 'ranked', deltaToBestMs: 420, previousGhostAvailable: false });
    assert.equal(withoutGhost.title, 'Hinter deiner Bestzeit');
    assert.equal(rowValue(withoutGhost, 'gap'), 0.42);
});

test('the first finish says a ghost now exists, and no finish shows no card', () => {
    assert.equal(verdictOf({ status: 'first_time', totalTimeMs: 50_000, ghostAvailable: true })?.title, 'Erste Bestzeit');
    assert.match(rowValue(verdictOf({ status: 'first_time', ghostAvailable: true }), 'ghost'), /fliegt diese Zeit als Ghost/);
    assert.match(rowValue(verdictOf({ status: 'first_time', ghostAvailable: false }), 'ghost'), /kein Ghost-Clip gespeichert/);
    assert.equal(verdictOf(null), null);
});

function ghostClip() {
    return {
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0 }] },
            { time: 10, players: [{ idx: 0, x: 10, y: 0, z: 10 }] },
        ],
        players: [{ idx: 0, color: 0xffffff }],
        sourceDuration: 10,
        displayDuration: 10,
    };
}

test('first-time verdict only promises a ghost when a best-time clip was stored', () => {
    const finish = (clip) => {
        const run = new ArcadeRunRuntime({ now: () => 100000, ghostLibrarySaveThrottleMs: 0 });
        run.configure({ arcade: { enabled: true, seed: 13, sectorCount: 2 } });
        run.startRun({ encounterPlan: buildArcadeSectorPlan({ seed: 13, sectorCount: 2 }) });
        const result = applyParcoursLeaderboardEvent(run, {
            type: 'finish', routeId: 'route_ghost_availability', totalTimeMs: 50_000, segmentSplitsMs: [10_000], ghostClip: clip,
        });
        return result;
    };

    const withoutClip = finish(null);
    assert.equal(withoutClip.status, 'first_time');
    assert.equal(withoutClip.ghostAvailable, false);
    assert.match(rowValue(verdictOf(withoutClip), 'ghost'), /kein Ghost-Clip gespeichert/);

    const withClip = finish(ghostClip());
    assert.equal(withClip.status, 'first_time');
    assert.equal(withClip.ghostAvailable, true);
    assert.match(rowValue(verdictOf(withClip), 'ghost'), /fliegt diese Zeit als Ghost/);
});

test('a faster time without a previous ghost is an improved best, not a beaten ghost', () => {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000, ghostLibrarySaveThrottleMs: 0 });
    run.configure({ arcade: { enabled: true, seed: 14, sectorCount: 2 } });
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 14, sectorCount: 2 }) });
    const first = applyParcoursLeaderboardEvent(run, {
        type: 'finish', routeId: 'route_no_prior_ghost', totalTimeMs: 50_000, segmentSplitsMs: [10_000], ghostClip: null,
    });
    assert.equal(first.ghostAvailable, false);

    const faster = applyParcoursLeaderboardEvent(run, {
        type: 'finish', routeId: 'route_no_prior_ghost', totalTimeMs: 45_000, segmentSplitsMs: [9_000], ghostClip: ghostClip(),
    });
    assert.equal(faster.status, 'new_best');
    assert.equal(faster.previousGhostAvailable, false);
    assert.equal(faster.ghostAvailable, true, 'the faster time stores a new clip for future runs');
    const block = verdictOf(faster);
    assert.equal(block?.title, 'Bestzeit verbessert');
    assert.equal(selectArcadeRunHighlights({ parcoursResult: faster }).some((entry) => entry.kind === 'ghost_beaten'), false);

    run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: false, hp: 0 }], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 5, kills: 0 });
    const summary = run.getStateSnapshot().postRunSummary;
    assert.equal(summary.parcoursResult.previousGhostAvailable, false);
    assert.equal(summary.highlights.some((entry) => entry.kind === 'ghost_beaten'), false);
});

test('the finished run carries its own parcours finish into the result', () => {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000, ghostLibrarySaveThrottleMs: 0 });
    run.configure({ arcade: { enabled: true, seed: 3, sectorCount: 2 } });
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 3, sectorCount: 2 }) });
    applyParcoursLeaderboardEvent(run, { type: 'finish', routeId: 'route_alpha', totalTimeMs: 41_230, segmentSplitsMs: [9000] });
    run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: false, hp: 0 }], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 5, kills: 0 });
    const summary = run.getStateSnapshot().postRunSummary;
    assert.equal(summary?.parcoursResult?.status, 'first_time');
    assert.equal(summary?.parcoursResult?.totalTimeMs, 41_230);

    run.resetRunState();
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 3, sectorCount: 2 }) });
    run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: false, hp: 0 }], inputs: { reason: '' }, baseController: {} });
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 5, kills: 0 });
    assert.equal(run.getStateSnapshot().postRunSummary?.parcoursResult ?? null, null, 'a later run without a finish shows no old verdict');
});
