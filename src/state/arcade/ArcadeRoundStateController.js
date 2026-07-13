export class ArcadeRoundStateController {
    constructor(options = {}) {
        this.baseController = options.baseController || null;
        this.arcadeRuntime = options.arcadeRuntime || null;
        this.defaultRoundPause = Number(this.baseController?.defaultRoundPause) || 3;
        this.isArcadeRoundStateController = true;
    }

    deriveOnRoundEndPlan(players, inputs = {}) {
        if (!this.baseController || typeof this.baseController.deriveOnRoundEndPlan !== 'function') {
            throw new Error('ArcadeRoundStateController requires a base controller');
        }
        if (!this.arcadeRuntime?.isEnabled?.()) {
            return this.baseController.deriveOnRoundEndPlan(players, inputs);
        }
        return this.arcadeRuntime.deriveRoundEndPlan({
            players,
            inputs,
            baseController: this.baseController,
        });
    }

    deriveRoundEndTick(inputs = {}) {
        if (!this.baseController || typeof this.baseController.deriveRoundEndTick !== 'function') {
            throw new Error('ArcadeRoundStateController requires deriveRoundEndTick on base controller');
        }
        const tick = this.baseController.deriveRoundEndTick(inputs);
        if (this.arcadeRuntime?.isEnabled?.() && tick?.action === 'START_ROUND') {
            this.arcadeRuntime.beginNextSector();
        }
        return tick;
    }

    deriveMatchEndTick(inputs = {}) {
        if (!this.baseController || typeof this.baseController.deriveMatchEndTick !== 'function') {
            throw new Error('ArcadeRoundStateController requires deriveMatchEndTick on base controller');
        }
        return this.baseController.deriveMatchEndTick(inputs);
    }
}

export function createArcadeRoundStateController(options = {}) {
    return new ArcadeRoundStateController(options);
}
