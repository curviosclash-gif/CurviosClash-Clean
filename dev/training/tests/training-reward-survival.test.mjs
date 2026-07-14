import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RewardCalculator,
    calculateReward,
} from '../src/state/training/RewardCalculator.js';

test('V36 survival reward shaping adds pressure bonus and risk penalties', () => {
    const reward = calculateReward({
        survival: true,
        healthRatio: 0.35,
        pressureLevel: 0.8,
        projectileThreat: 1,
        riskProximity: {
            wall: 0.7,
            trail: 0.5,
            opponent: 0.4,
        },
    });

    assert.equal(reward.components.survival, 0.12);
    assert.equal(reward.components.survivalPressureBonus, 0.05055);
    assert.equal(reward.components.wallRisk, -0.056);
    assert.equal(reward.components.trailRisk, -0.06);
    assert.equal(reward.components.opponentRisk, -0.032);
    assert.equal(reward.components.lowHealthThreat, -0.06);
    assert.equal(reward.total, -0.03745);
});

test('V36 curriculum navigate stage amplifies survival-first weighting', () => {
    const calculator = new RewardCalculator({
        curriculum: true,
    });
    const reward = calculator.compute({
        totalEnvSteps: 0,
        survival: true,
        healthRatio: 0.28,
        pressureLevel: 0.76,
        wallRisk: 0.66,
        trailRisk: 0.55,
        opponentRisk: 0.2,
    });

    assert.equal(calculator.currentStage, 'navigate');
    assert.equal(reward.components.survival, 0.22);
    assert.equal(reward.components.survivalPressureBonus, 0.066424);
    assert.equal(reward.components.wallRisk, -0.0924);
    assert.equal(reward.components.trailRisk, -0.099);
    assert.equal(reward.components.opponentRisk, -0.012);
    assert.equal(reward.components.lowHealthThreat, -0.093632);
    assert.equal(reward.total, -0.009608);
});
