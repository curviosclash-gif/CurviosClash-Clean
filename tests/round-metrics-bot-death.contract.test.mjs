import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundMetricsStore } from '../src/state/recorder/RoundMetricsStore.js';

function createPlayer(index, isBot) {
    return { index, isBot };
}

test('RoundMetricsStore preserves per-bot death causes without classifying survivors as deaths', () => {
    let now = 0;
    const store = new RoundMetricsStore({ timeProvider: () => now });
    const human = createPlayer(0, false);
    const bot = createPlayer(1, true);

    store.startRound([human, bot]);
    now = 4;
    store.markPlayerDeath(bot, 'trail_self');
    store.markPlayerDeath(bot, 'WALL');
    now = 10;
    const firstRound = store.finalizeRound(human, [human, bot]);

    assert.equal(firstRound.botSurvivalAverage, 4);
    assert.deepEqual(firstRound.botSurvivalSeconds, [4]);
    assert.deepEqual(firstRound.botDeathCauseCounts, { TRAIL_SELF: 1 });
    assert.deepEqual(store.getAggregateMetrics().botDeathCauseTotals, { TRAIL_SELF: 1 });
    assert.deepEqual(store.getRoundSummaries()[0].botDeathCauseCounts, { TRAIL_SELF: 1 });

    now = 20;
    store.startRound([human, bot]);
    now = 28;
    const secondRound = store.finalizeRound(bot, [human, bot]);

    assert.deepEqual(secondRound.botDeathCauseCounts, {});
    assert.deepEqual(secondRound.botSurvivalSeconds, [8]);
    assert.deepEqual(store.getAggregateMetrics().botDeathCauseTotals, { TRAIL_SELF: 1 });
});
