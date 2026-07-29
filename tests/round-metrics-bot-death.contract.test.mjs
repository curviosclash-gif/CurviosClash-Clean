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
    assert.deepEqual(firstRound.botDeathSurvivalSeconds, [4]);
    assert.deepEqual(firstRound.botDeathCauseCounts, { TRAIL_SELF: 1 });
    assert.deepEqual(store.getAggregateMetrics().botDeathCauseTotals, { TRAIL_SELF: 1 });
    assert.deepEqual(store.getRoundSummaries()[0].botDeathCauseCounts, { TRAIL_SELF: 1 });

    now = 20;
    store.startRound([human, bot]);
    now = 28;
    const secondRound = store.finalizeRound(bot, [human, bot]);

    assert.deepEqual(secondRound.botDeathCauseCounts, {});
    assert.deepEqual(secondRound.botSurvivalSeconds, [8]);
    assert.deepEqual(secondRound.botDeathSurvivalSeconds, []);
    assert.deepEqual(store.getAggregateMetrics().botDeathCauseTotals, { TRAIL_SELF: 1 });
});

test('RoundMetricsStore separates real deaths from bots alive at observation end', () => {
    let now = 0;
    const store = new RoundMetricsStore({ timeProvider: () => now });
    const human = createPlayer(0, false);
    const deadBot = { ...createPlayer(1, true), alive: true };
    const livingBot = { ...createPlayer(2, true), alive: true };
    store.startRound([human, deadBot, livingBot]);

    now = 4;
    deadBot.alive = false;
    store.markPlayerDeath(deadBot, 'WALL');
    now = 10;
    const observation = store.getActiveSurvivalObservation([human, deadBot, livingBot]);

    assert.deepEqual(observation.botDeathSurvivalSeconds, [4]);
    assert.deepEqual(observation.censoredBotSurvivalSeconds, [10]);
    assert.equal(observation.aliveAtObservationEnd, 1);
    assert.deepEqual(observation.botDeathCauseCounts, { WALL: 1 });
});

test('RoundMetricsStore exposes dedicated turret event totals', () => {
    const store = new RoundMetricsStore({ timeProvider: () => 10 });
    store.startRound([]);
    store.registerEventType('TURRET_DEPLOY');
    store.registerEventType('TURRET_PLAYER_HIT');
    store.registerEventType('TURRET_PLAYER_HIT');
    const summary = store.finalizeRound(null, []);

    assert.deepEqual(summary.turretEventCounts, {
        TURRET_DEPLOY: 1,
        TURRET_PLAYER_HIT: 2,
    });
    assert.deepEqual(store.getAggregateMetrics().turretEventTotals, summary.turretEventCounts);
});
