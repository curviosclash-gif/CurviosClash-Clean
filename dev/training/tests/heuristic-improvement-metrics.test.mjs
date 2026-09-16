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
