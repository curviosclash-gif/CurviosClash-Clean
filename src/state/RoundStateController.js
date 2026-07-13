// ============================================
// RoundStateController.js - thin controller wrapper around pure tick/transition ops
// ============================================

import {
    deriveMatchEndTickStep,
    deriveRoundEndControllerTransition,
    deriveRoundEndTickStep,
} from './RoundStateControllerOps.js';
import { deriveRoundEndOutcome } from './RoundStateOps.js';

function normalizePause(value, fallback = 3) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class RoundStateController {
    constructor(options = {}) {
        this.defaultRoundPause = normalizePause(options.defaultRoundPause, 3);
    }

    deriveRoundEndTransition(roundEndOutcome) {
        return deriveRoundEndControllerTransition(roundEndOutcome, {
            defaultRoundPause: this.defaultRoundPause,
        });
    }

    deriveOnRoundEndPlan(players, inputs = {}) {
        const outcome = deriveRoundEndOutcome(players, inputs);
        const transition = this.deriveRoundEndTransition(outcome);
        return {
            outcome,
            transition,
        };
    }

    deriveRoundEndTick(inputs = {}) {
        return deriveRoundEndTickStep(inputs);
    }

    deriveMatchEndTick(inputs = {}) {
        return deriveMatchEndTickStep(inputs);
    }
}

export function createRoundStateController(options = {}) {
    return new RoundStateController(options);
}
