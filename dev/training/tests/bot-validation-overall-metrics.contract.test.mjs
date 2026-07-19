import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBotValidationRuntimeMetrics } from '../src/state/validation/BotValidationRuntimeMetrics.js';
import { buildBotValidationSurvivalMetrics } from '../src/state/validation/BotValidationSurvivalMetrics.js';

function sample(scenarioId, checkpoint, snapshot) {
    return {
        scenarioId,
        round: 1,
        checkpoint,
        botDecisions: [{ playerIndex: 1, snapshot }],
    };
}

test('overall metrics aggregate colliding round and player indexes across scenarios', () => {
    const runtime = buildBotValidationRuntimeMetrics([
        sample('A', 'start', {
            intent: 'approach', safetyState: 'normal', steeringChanges: 1, intentChanges: 1,
        }),
        sample('B', 'start', {
            intent: 'evade', safetyState: 'evade', steeringChanges: 10, intentChanges: 4,
        }),
        sample('A', 'end', {
            intent: 'attack', safetyState: 'normal', steeringChanges: 5, intentChanges: 3, safetyActiveRatio: 0.2,
        }),
        sample('B', 'end', {
            intent: 'recover', safetyState: 'recover', steeringChanges: 17, intentChanges: 9, safetyActiveRatio: 0.6,
        }),
    ], 20);
    const survival = buildBotValidationSurvivalMetrics([], [
        {
            botDeathSurvivalSeconds: [8], censoredBotSurvivalSeconds: [30],
            aliveAtObservationEnd: 1, observationCompleted: true, observationSeconds: 30,
        },
        {
            botDeathSurvivalSeconds: [12], censoredBotSurvivalSeconds: [40],
            aliveAtObservationEnd: 1, observationCompleted: true, observationSeconds: 40,
        },
    ]);

    assert.equal(runtime.decisionSampleCount, 4);
    assert.deepEqual(runtime.intentCounts, { approach: 1, evade: 1, attack: 1, recover: 1 });
    assert.deepEqual(runtime.safetyStateCounts, { normal: 2, evade: 1, recover: 1 });
    assert.equal(runtime.steeringChanges, 11);
    assert.equal(runtime.intentChanges, 7);
    assert.equal(runtime.steeringChangesPerSecond, 0.55);
    assert.equal(runtime.intentChangesPerSecond, 0.35);
    assert.equal(runtime.averageSafetyActiveRatio, 0.4);
    assert.deepEqual(survival.botSurvivalSeconds, [8, 12]);
    assert.deepEqual(survival.censoredBotSurvivalSeconds, [30, 40]);
    assert.equal(survival.censoredBotSurvivalSampleCount, 2);
    assert.equal(survival.aliveAtObservationEnd, 2);
    assert.equal(survival.observationDuration, 70);
});
