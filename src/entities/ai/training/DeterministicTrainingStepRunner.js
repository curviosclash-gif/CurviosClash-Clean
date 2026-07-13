// ============================================
// DeterministicTrainingStepRunner.js - additive deterministic reset/step training runner
// ============================================

import { createNeutralBotAction, sanitizeBotAction } from '../actions/BotActionContract.js';
import { resolveHybridDecision } from '../hybrid/HybridDecisionArchitecture.js';
import { RuntimeNearObservationTracker } from '../observation/RuntimeNearObservationAdapter.js';
import { EpisodeController } from '../../../state/training/EpisodeController.js';
import { RewardCalculator } from '../../../state/training/RewardCalculator.js';
import {
    buildTrainingResetContract,
    buildTrainingStepContract,
} from './TrainingContractV1.js';

function resolveInventoryLength(input = {}, fallback = 0) {
    const candidates = [
        input.inventoryLength,
        input.player?.inventoryLength,
        Array.isArray(input.player?.inventory) ? input.player.inventory.length : null,
        fallback,
    ];
    for (let i = 0; i < candidates.length; i++) {
        const value = Number(candidates[i]);
        if (Number.isFinite(value)) {
            return Math.max(0, Math.trunc(value));
        }
    }
    return 0;
}

export class DeterministicTrainingStepRunner {
    constructor(options = {}) {
        this.episodeController = options.episodeController instanceof EpisodeController
            ? options.episodeController
            : new EpisodeController(options.episode || {});
        this.rewardCalculator = options.rewardCalculator instanceof RewardCalculator
            ? options.rewardCalculator
            : new RewardCalculator(options.reward || {});
        this._actionScratch = createNeutralBotAction({});
        this._lastTransition = null;
        this._observationTracker = new RuntimeNearObservationTracker();
    }

    getEpisodeSnapshot() {
        return this.episodeController.getSnapshot();
    }

    getLastTransition() {
        return this._lastTransition ? { ...this._lastTransition } : null;
    }

    reset(input = {}) {
        this._observationTracker.reset();
        const episode = this.episodeController.reset(input);
        const liftedObservation = this._observationTracker.lift(input.observation, {
            environmentProfile: input?.metadata?.environmentProfile,
            metadata: input?.metadata,
            stepIndex: 0,
            player: input?.player || null,
        });
        const transition = buildTrainingResetContract({
            ...input,
            episode,
            observation: liftedObservation.observation,
            observationSchemaVersion: liftedObservation.details.schemaVersion,
            observationLength: liftedObservation.observation.length,
            metadata: {
                ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
                observationContext: liftedObservation.details,
            },
        });
        this._lastTransition = transition;
        return transition;
    }

    step(input = {}) {
        const currentEpisode = this.episodeController.getSnapshot();
        if (!currentEpisode) {
            this.reset(input);
        }

        const inventoryLength = resolveInventoryLength(
            input,
            resolveInventoryLength(this._lastTransition?.info?.player, 0)
        );
        const sanitizedAction = sanitizeBotAction(
            input.action,
            {
                inventoryLength,
                onInvalid: typeof input.onInvalidAction === 'function' ? input.onInvalidAction : null,
            },
            this._actionScratch
        );
        const liftedObservation = this._observationTracker.lift(input.observation, {
            environmentProfile: input?.metadata?.environmentProfile,
            metadata: input?.metadata,
            stepIndex: currentEpisode?.stepIndex ?? input.stepIndex ?? 0,
            player: input?.player || null,
        });
        const hybridDecision = resolveHybridDecision(sanitizedAction, {
            observation: liftedObservation.observation,
            observationDetails: liftedObservation.details,
            intent: input?.metadata?.intent || null,
            planarMode: input?.planarMode === true,
            player: input?.player || null,
        });
        const episode = this.episodeController.step(input);
        const rewardResult = this.rewardCalculator.compute(input.rewardSignals || {}, episode);
        const transition = buildTrainingStepContract({
            ...input,
            episode,
            observation: liftedObservation.observation,
            observationSchemaVersion: liftedObservation.details.schemaVersion,
            observationLength: liftedObservation.observation.length,
            action: { ...hybridDecision.action },
            reward: rewardResult.total,
            rewardBreakdown: rewardResult.components,
            metadata: {
                ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
                observationContext: liftedObservation.details,
                hybridDecision: {
                    contractVersion: 'v80-hybrid-decision-trace-v1',
                    intent: hybridDecision.intent,
                    safety: hybridDecision.safety,
                    control: hybridDecision.control,
                },
            },
        });
        this._lastTransition = transition;
        return transition;
    }
}
