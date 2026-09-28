import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeuristicLifeTracker } from '../scripts/heuristic-improvement-metrics.mjs';

test('life tracker averages completed respawn lives and the active final life', () => {
    const player = { index: 2, alive: false, fightSpawnedAtSeconds: 0 };
    const tracker = createHeuristicLifeTracker();
    tracker.recordDeath(player, 2);
    player.fightSpawnedAtSeconds = 5;
    tracker.recordDeath(player, 8);
    player.fightSpawnedAtSeconds = 10;
    player.alive = true;
    assert.deepEqual(tracker.lifeTotals(player, 14), { seconds: 9, lives: 3 });
    assert.equal(tracker.averageLifeSeconds(player, 14), 3);
});

test('life tracker does not count time waiting to respawn or invent a final life', () => {
    const player = { index: 3, alive: false, fightSpawnedAtSeconds: 4 };
    const tracker = createHeuristicLifeTracker();
    tracker.recordDeath(player, 6);
    assert.equal(tracker.averageLifeSeconds(player, 20), 2);
    assert.equal(tracker.averageLifeSeconds({ index: 4, alive: false }, 20), 0);
});

test('life totals can be pooled without overweighting a long single life', () => {
    const tracker = createHeuristicLifeTracker();
    const longLife = { index: 1, alive: true, fightSpawnedAtSeconds: 0 };
    const shortLives = { index: 2, alive: false, fightSpawnedAtSeconds: 0 };
    for (let life = 0; life < 10; life += 1) {
        shortLives.fightSpawnedAtSeconds = life * 9;
        tracker.recordDeath(shortLives, (life + 1) * 9);
    }
    const a = tracker.lifeTotals(longLife, 90);
    const b = tracker.lifeTotals(shortLives, 90);
    assert.equal((a.seconds + b.seconds) / (a.lives + b.lives), 180 / 11);
});

test('engagement tracker reports how long a bot lets safety override its tactics', async () => {
    const { createHeuristicEngagementTracker } = await import('../scripts/heuristic-improvement-metrics.mjs');
    const tracker = createHeuristicEngagementTracker();
    tracker.record(1, { shootMG: false }, 'evade');
    tracker.record(1, { shootMG: false }, 'recover');
    tracker.record(1, { shootMG: true }, 'normal');
    tracker.record(1, { shootRocket: true }, 'cooldown');
    tracker.record(2, { shootItem: true }, 'normal');
    assert.deepEqual(tracker.totals(1), { updates: 4, safetyUpdates: 2, shots: 2 });
    assert.deepEqual(tracker.totals(3), { updates: 0, safetyUpdates: 0, shots: 0 });
});

test('engagement guard rejects a candidate that hides behind safety more than its reference', async () => {
    const { retainsHeuristicEngagement } = await import('../scripts/heuristic-improvement-metrics.mjs');
    const reference = { candidateSafetyShare: 0.5 };
    assert.equal(retainsHeuristicEngagement({ candidateSafetyShare: 0.5 }, reference), true);
    assert.equal(retainsHeuristicEngagement({ candidateSafetyShare: 0.52 }, reference), true);
    assert.equal(retainsHeuristicEngagement({ candidateSafetyShare: 0.6 }, reference), false);
    assert.equal(retainsHeuristicEngagement({ candidateSafetyShare: 0.3 }, reference), true);
});
