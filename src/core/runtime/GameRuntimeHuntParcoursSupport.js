import { HuntParcoursRuntime } from '../arcade/HuntParcoursRuntime.js';
import { isHuntParcoursConfig, resolveHuntParcoursVariant } from '../../shared/contracts/HuntParcoursContract.js';
import { resolveActiveArcadeVehicleId, resolveArcadeP1RecordStore } from './GameRuntimeArcadeSupportOps.js';
import { createArcadeRoundStateController } from '../../state/arcade/ArcadeRoundStateController.js';

/** Owns the dedicated run while the match session and its entity manager change maps. */
export class GameRuntimeHuntParcoursSupport {
    constructor(support, getPlayerRewardTarget) {
        this.support = support;
        this.runtime = new HuntParcoursRuntime({
            getRecordStore: () => resolveArcadeP1RecordStore(support, support.getRuntimeState()?.runtimeConfig),
            getPlayerRewardTarget,
            requestMapTransition: transition => { support._pendingSectorTransition = transition; },
        });
    }

    isActive(config = this.support.getRuntimeState()?.runtimeConfig) { return isHuntParcoursConfig(config); }
    getState() { return this.runtime.getHudState(); }
    bindRoundController(state, baseController) {
        state.roundStateController = createArcadeRoundStateController({ baseController, arcadeRuntime: this.runtime });
    }

    isCurrentSession(token) {
        return token === this._sessionToken && token?.manager === this.runtime.entityManager
            && token?.manager === this.support.getRuntimeState()?.entityManager && this.isActive();
    }

    createParcoursCallbacks(manager) {
        const token = this._sessionToken = { manager };
        return {
            xp: (eventType, index) => this.isCurrentSession(token) ? this.runtime.handleXpEvent(eventType, index) : null,
            leaderboard: data => this.isCurrentSession(token) ? data?.type === 'round_outcome'
                ? this.runtime.getRoundOutcome() : this.runtime.handleParcoursEvent(data) : null,
        };
    }

    createGameplayHandler(manager) {
        const token = this._sessionToken?.manager === manager ? this._sessionToken : (this._sessionToken = { manager });
        return event => this.isCurrentSession(token) ? this.runtime.handleGameplayEvent(event) : null;
    }

    prepare(config) {
        if (!this.isActive(config)) return null;
        const variant = resolveHuntParcoursVariant(config.arcade.huntParcoursVariantId);
        if (!['nemesis', 'thunderflight'].includes(variant?.id)) throw new Error('Hunt-Parcours variant is not implemented');
        const mapIndex = ['idle', 'finished'].includes(this.runtime.phase) ? 0 : this.runtime.mapIndex;
        return { mapKey: variant.mapKeys[mapIndex], botCount: variant.botCount, combatProfile: 'hunt',
            huntParcours: true, parcoursRacer: true };
    }

    start(state, config) {
        this.support._bindGameplayCallback(state);
        state?.entityManager?._roundOutcomeSystem?.setObjectiveHold?.(true);
        const started = this.runtime.start(state?.entityManager, {
            variantId: config.arcade.huntParcoursVariantId,
            vehicleId: resolveActiveArcadeVehicleId(config, this.support.game?.settings),
            recordStore: resolveArcadeP1RecordStore(this.support, config), seed: config.arcade.seed,
        });
        // The entity manager is new on every map; restore the run's cumulative round board.
        for (const player of state?.entityManager?.players || []) {
            player.score = player.index === this.runtime.rivalPlayerIndex ? this.runtime.rivalMapWins : this.runtime.humanMapWins;
        }
        if (this.runtime.rankContext) this.runtime.rankContext = {
            ...this.runtime.rankContext, huntParcoursVariantId: started.variantId,
            scoreModel: 'hunt-score.v1', rivalTierGroup: started.rival ? (started.rival.stage >= 4 ? '4-5' : started.rival.stage >= 2 ? '2-3' : '0-1') : '',
        };
        this.support._sectorRebuildInFlight = false;
        return started;
    }

    resetIfUsed() {
        if (!this.isActive() && this.runtime.phase === 'idle') return null;
        this._sessionToken = null;
        this.runtime.dispose();
        this.support.arcadeRunRuntime.resetRunState({ preserveRecords: true });
        return this.getState();
    }
}
