import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBotValidationSurvivalMetrics } from '../src/state/validation/BotValidationSurvivalMetrics.js';

test('survival metrics retain only real deaths as uncensored samples', () => {
    const metrics = buildBotValidationSurvivalMetrics([
        { botDeathSurvivalSeconds: [4, 9] },
        { forced: true, botDeathSurvivalSeconds: [99] },
    ]);
    assert.deepEqual(metrics.botSurvivalSeconds, [4, 9]);
    assert.deepEqual(metrics.censoredBotSurvivalSeconds, []);
    assert.equal(metrics.censoredBotSurvivalSampleCount, 0);
    assert.equal(metrics.observationCompleted, null);
});

test('survival metrics keep living bots censored and out of death samples', () => {
    const metrics = buildBotValidationSurvivalMetrics([], [{
        botDeathSurvivalSeconds: [],
        censoredBotSurvivalSeconds: [40, 35],
        aliveAtObservationEnd: 2,
        observationCompleted: true,
    }]);
    assert.deepEqual(metrics.botSurvivalSeconds, []);
    assert.deepEqual(metrics.censoredBotSurvivalSeconds, [35, 40]);
    assert.equal(metrics.aliveAtObservationEnd, 2);
    assert.equal(metrics.survivedAtLeastSeconds, 35);
    assert.equal(metrics.censoredBotSurvivalSampleCount, 2);
    assert.equal(metrics.observationCompleted, true);
});

test('survival metrics preserve mixed and multi-scenario observation samples', () => {
    const scenarioA = {
        botDeathSurvivalSeconds: [8],
        censoredBotSurvivalSeconds: [32],
        aliveAtObservationEnd: 1,
        observationCompleted: true,
    };
    const scenarioB = {
        botDeathSurvivalSeconds: [12, 20],
        censoredBotSurvivalSeconds: [28, 40],
        aliveAtObservationEnd: 2,
        observationCompleted: true,
    };
    const aggregate = buildBotValidationSurvivalMetrics([], [scenarioA, scenarioB]);
    assert.deepEqual(aggregate.botSurvivalSeconds, [8, 12, 20]);
    assert.deepEqual(aggregate.censoredBotSurvivalSeconds, [28, 32, 40]);
    assert.equal(aggregate.aliveAtObservationEnd, 3);
    assert.equal(aggregate.censoredBotSurvivalSampleCount, 3);
    assert.equal(aggregate.observationSampleCount, 2);
    assert.equal(aggregate.observationCompleted, true);
});

test('survival metrics expose an incomplete observation without creating an outcome', () => {
    const metrics = buildBotValidationSurvivalMetrics([], [{
        botDeathSurvivalSeconds: [5],
        censoredBotSurvivalSeconds: [],
        aliveAtObservationEnd: 0,
        observationCompleted: false,
    }]);
    assert.deepEqual(metrics.botSurvivalSeconds, [5]);
    assert.equal(metrics.observationCompleted, false);
});
