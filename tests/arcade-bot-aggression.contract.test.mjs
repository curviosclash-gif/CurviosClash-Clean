import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyArcadeBotAggressiveness,
    normalizeArcadeBotAggressiveness,
} from '../src/shared/contracts/ArcadeBotAggressionContract.js';
import { resolveClassicBridgeAction } from '../src/entities/ai/ClassicBridgePolicy.js';
import { RuleBasedBotPolicy } from '../src/entities/ai/RuleBasedBotPolicy.js';
import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { createGameRuntimeBundle } from '../src/core/runtime/GameRuntimeBundle.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';

function createAttackObservation() {
    const observation = new Float32Array(OBSERVATION_LENGTH_V1);
    observation[WALL_DISTANCE_FRONT] = 0.8;
    observation[WALL_DISTANCE_LEFT] = 0.8;
    observation[WALL_DISTANCE_RIGHT] = 0.8;
    observation[WALL_DISTANCE_UP] = 0.8;
    observation[WALL_DISTANCE_DOWN] = 0.8;
    observation[TARGET_DISTANCE_RATIO] = 0.5;
    observation[TARGET_ALIGNMENT] = 0.56;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0.4;
    observation[LOCAL_OPENNESS_RATIO] = 0.7;
    return observation;
}

test('Arcade bot aggressiveness normalizes authored squad values and tunes active profiles', () => {
    assert.equal(normalizeArcadeBotAggressiveness(0.85), 0.85);
    assert.equal(normalizeArcadeBotAggressiveness(5), 1);
    assert.equal(normalizeArcadeBotAggressiveness(-1), 0);

    const baseProfile = {
        aggression: 0.52,
        pursuitEnabled: true,
        pursuitRadius: 35,
        pursuitAimTolerance: 0.85,
        pursuitRiskCeiling: 0.3,
        pursuitSurvivalCeiling: 0.56,
    };
    const scout = applyArcadeBotAggressiveness(baseProfile, 0.45);
    const elite = applyArcadeBotAggressiveness(baseProfile, 0.85);

    assert.ok(elite.aggression > scout.aggression);
    assert.ok(elite.pursuitRadius > scout.pursuitRadius);
    assert.ok(elite.pursuitAimTolerance < scout.pursuitAimTolerance);
    assert.ok(elite.pursuitRiskCeiling > scout.pursuitRiskCeiling);
    assert.ok(elite.pursuitSurvivalCeiling > scout.pursuitSurvivalCeiling);
});

test('Classic Arcade bridge attacks more decisively for elite squads', () => {
    const runtimeContext = { observation: createAttackObservation() };

    const scoutAction = resolveClassicBridgeAction(runtimeContext, { aggressiveness: 0.45 });
    const eliteAction = resolveClassicBridgeAction(runtimeContext, { aggressiveness: 0.85 });

    assert.notEqual(scoutAction.shootMG, true);
    assert.equal(eliteAction.shootMG, true);
});

test('Rule-based fallback applies Arcade aggressiveness on creation and live updates', () => {
    const policy = new RuleBasedBotPolicy({
        difficulty: 'NORMAL',
        runtimeConfig: { bot: { arcadeAggressiveness: 0.45 } },
    });
    const scoutAggression = policy.getArcadeAggressivenessSnapshot();

    policy.setArcadeBotAggressiveness(0.85);
    const eliteAggression = policy.getArcadeAggressivenessSnapshot();

    assert.equal(scoutAggression.authored, 0.45);
    assert.equal(eliteAggression.authored, 0.85);
    assert.ok(eliteAggression.profile > scoutAggression.profile);
});

test('Arcade sector profiles reach current bots through the live runtime config', () => {
    const received = [];
    const entityManager = {
        bots: [{ ai: { setArcadeBotAggressiveness: (value) => received.push(value) } }],
        players: [],
    };

    applyLiveRuntimeConfig(entityManager, DEFAULT_ENTITY_RUNTIME_CONFIG, {
        bot: { arcadeAggressiveness: 0.72 },
    });

    assert.deepEqual(received, [0.72]);
});

test('Game runtime stores authored sector aggressiveness before live-applying it', () => {
    const appliedConfigs = [];
    const entityManager = {
        applyLiveRuntimeConfig: (_entityConfig, runtimeConfig) => appliedConfigs.push(runtimeConfig),
        setBotDifficulty() {},
    };
    const runtimeConfig = createRuntimeConfigSnapshot({
        mapKey: 'standard',
        numBots: 2,
        winsNeeded: 3,
        botDifficulty: 'EASY',
        localSettings: { modePath: 'arcade' },
    });
    const bundle = createGameRuntimeBundle({ state: { runtimeConfig, entityManager } });
    const facadeContext = {
        getRuntimeState: () => bundle.state,
        getRuntimeBundle: () => bundle,
    };

    const nextConfig = GameRuntimeFacade.prototype._applyArcadeSectorRuntimeProfile.call(
        facadeContext,
        { mapKey: 'complex', botCount: 5, botDifficulty: 'HARD', aggressiveness: 0.85 }
    );

    assert.equal(nextConfig.bot.arcadeAggressiveness, 0.85);
    assert.equal(bundle.state.runtimeConfig.bot.arcadeAggressiveness, 0.85);
    assert.equal(appliedConfigs[0].bot.arcadeAggressiveness, 0.85);
});
