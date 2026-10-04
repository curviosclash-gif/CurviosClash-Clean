import { trackArcadeColorEvent } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { XP_REWARD_TABLE } from '../../state/arcade/ArcadeVehicleProfile.js';
import { settleArcadeRunRanking } from '../../state/arcade/ArcadeRunRanking.js';
import {
    awardBoundArcadeVehicleXpInStore,
    bindArcadeVehicleRewards,
} from '../../state/arcade/ArcadeVehicleRewardBinding.js';

function safeMs(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function loadRecords(store, chain) {
    const raw = store?.loadJsonRecord?.(chain.recordKey, null);
    if (raw?.version !== chain.recordVersion) return { version: chain.recordVersion, lastTotalMs: 0, bestTotalMs: 0, lastMapsMs: [] };
    return {
        version: chain.recordVersion,
        lastTotalMs: safeMs(raw.lastTotalMs),
        bestTotalMs: safeMs(raw.bestTotalMs),
        lastMapsMs: Array.isArray(raw.lastMapsMs) ? raw.lastMapsMs.slice(0, chain.maps.length).map(safeMs) : [],
    };
}

/** One solo parcours run. The match session may be rebuilt between maps; this object survives it. */
export class FivePortalsRuntime {
    /**
     * @param {{ getRecordStore?: () => *, requestMapTransition?: (transition: { mapKey: string, botCount: number, fivePortals: boolean }) => void, requestAdvance?: () => void }} [options]
     */
    constructor({ getRecordStore = () => null, requestMapTransition = () => {}, requestAdvance = () => {} } = {}) {
        this._getRecordStore = getRecordStore;
        this._requestMapTransition = requestMapTransition;
        this._requestAdvance = requestAdvance;
        this.reset();
    }

    /** @param {string} [chainId] which portal chain (Fünf Portale, Himmelsleiter, ...) this run plays; defaults to Fünf Portale. */
    reset(chainId) {
        this.chain = resolvePortalChain(chainId);
        this.entityManager = null;
        this.phase = 'idle';
        this.mapIndex = 0;
        this.mapTimesMs = [];
        this.currentTimeMs = 0;
        this._transitionRequested = false;
        this.rewardBinding = null;
        this.xpEarned = 0;
        this.records = loadRecords(this._getRecordStore(), this.chain);
    }

    start(entityManager, { vehicleId = 'ship1', chainId } = {}) {
        if (this.phase === 'idle' || this.phase === 'finished') {
            this.reset(chainId);
            this.rewardBinding = bindArcadeVehicleRewards({ runType: 'five_portals', vehicleId });
            this.phase = 'racing';
        } else if (this.phase === 'transition') {
            this.phase = 'racing';
            this.currentTimeMs = 0;
            this._transitionRequested = false;
        }
        this.entityManager = entityManager || null;
        this.entityManager?.arena?._portalGateSystem?.portalRuntime?.deactivateExitPortals?.();
        return this.getHudState();
    }

    handleXpEvent(eventType, playerIndex = 0) {
        if (this.phase !== 'racing' || !this.rewardBinding || Number(playerIndex) !== 0) return null;
        const amount = {
            checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
            finish: XP_REWARD_TABLE.parcoursFinish,
            new_best_time: XP_REWARD_TABLE.parcoursNewBestTime,
        }[String(eventType)] || 0;
        const result = awardBoundArcadeVehicleXpInStore(
            this._getRecordStore(),
            this.rewardBinding,
            amount
        );
        if (result) this.xpEarned += result.earned;
        return result;
    }

    handleParcoursEvent(event) {
        if (this.phase !== 'racing' || event?.type !== 'finish' || Number(event.playerIndex) !== 0) return null;
        this.currentTimeMs = safeMs(event.totalTimeMs);
        this.phase = 'portal';
        this.entityManager?.arena?._portalGateSystem?.portalRuntime?.activateExitPortals?.();
        return this.getHudState();
    }

    handleGameplayEvent(event) {
        if (event?.type !== 'exit_portal' || Number(event.playerIndex) !== 0 || this.phase !== 'portal') return null;
        this.mapTimesMs[this.mapIndex] = this.currentTimeMs;
        this.entityManager?.arena?._portalGateSystem?.portalRuntime?.deactivateExitPortals?.();
        if (this.mapIndex === this.chain.maps.length - 1) {
            this.phase = 'finished';
            const total = this.mapTimesMs.reduce((sum, time) => sum + safeMs(time), 0);
            trackArcadeColorEvent(this._colorProgress, { type: 'best_time', playerIndex: 0, previousBestTimeMs: this.records.bestTotalMs, totalTimeMs: total });
            this.records = {
                version: this.chain.recordVersion,
                lastTotalMs: total,
                bestTotalMs: this.records.bestTotalMs > 0 ? Math.min(this.records.bestTotalMs, total) : total,
                lastMapsMs: [...this.mapTimesMs],
            };
            this._getRecordStore()?.saveJsonRecord?.(this.chain.recordKey, this.records);
            this.ranking = settleArcadeRunRanking(this, { succeeded: true, totalMs: total });
            return this.getHudState();
        }
        this.mapIndex += 1;
        this.currentTimeMs = 0;
        this.phase = 'transition';
        if (!this._transitionRequested) {
            this._transitionRequested = true;
            this._requestMapTransition({ mapKey: this.chain.maps[this.mapIndex], botCount: 0, fivePortals: true });
            this._requestAdvance();
        }
        return this.getHudState();
    }

    handleAttemptReset() {
        if (this.phase !== 'racing') return;
        this.currentTimeMs = 0;
        this.entityManager?._projectileSystem?.clear?.();
        this.entityManager?._staticTurretSystem?.startRound?.();
        this.entityManager?.powerupManager?.clear?.();
    }

    dispose() {
        this.entityManager?.arena?._portalGateSystem?.portalRuntime?.deactivateExitPortals?.();
        this.reset();
    }

    getHudState() {
        const progress = this.entityManager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(0) || null;
        const nowMs = Math.max(0, Number(this.entityManager?._simulationClockMs) || 0);
        const elapsedMs = this.phase === 'racing' && progress?.startedAtMs > 0
            ? safeMs(nowMs - progress.startedAtMs + (Number(progress.penaltyTimeMs) || 0))
            : this.currentTimeMs;
        const completedTotalMs = this.mapTimesMs.reduce((sum, time) => sum + safeMs(time), 0);
        return {
            runType: 'five_portals',
            chainId: this.chain.id,
            chainLabel: this.chain.label,
            vehicleId: this.rewardBinding?.vehicleId || '',
            xpEarned: this.xpEarned,
            phase: this.phase,
            mapIndex: this.mapIndex,
            mapCount: this.chain.maps.length,
            currentMapKey: this.chain.maps[this.mapIndex],
            checkpoint: Math.max(0, Number(progress?.nextCheckpointIndex) || 0),
            checkpointCount: Math.max(0, Number(progress?.totalCheckpoints) || 0),
            respawnsRemaining: Math.max(0, 3 - (Number(progress?.checkpointRespawnsUsed) || 0)),
            currentTimeMs: this.phase === 'portal' || this.phase === 'finished' ? this.currentTimeMs : elapsedMs,
            completedTotalMs,
            mapTimesMs: [...this.mapTimesMs],
            records: { ...this.records },
            postRunSummary: this.phase === 'finished'
                ? { ranking: this.ranking, maps: this.chain.maps.map((mapKey, index) => ({ mapKey, timeMs: this.mapTimesMs[index] })), totalMs: completedTotalMs, bestTotalMs: this.records.bestTotalMs }
                : null,
        };
    }
}
