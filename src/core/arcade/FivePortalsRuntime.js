import { FIVE_PORTALS_MAPS, FIVE_PORTALS_RECORD_KEY, FIVE_PORTALS_RECORD_VERSION } from '../../shared/contracts/FivePortalsContract.js';

function safeMs(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function loadRecords(store) {
    const raw = store?.loadJsonRecord?.(FIVE_PORTALS_RECORD_KEY, null);
    if (raw?.version !== FIVE_PORTALS_RECORD_VERSION) return { version: FIVE_PORTALS_RECORD_VERSION, lastTotalMs: 0, bestTotalMs: 0, lastMapsMs: [] };
    return {
        version: FIVE_PORTALS_RECORD_VERSION,
        lastTotalMs: safeMs(raw.lastTotalMs),
        bestTotalMs: safeMs(raw.bestTotalMs),
        lastMapsMs: Array.isArray(raw.lastMapsMs) ? raw.lastMapsMs.slice(0, FIVE_PORTALS_MAPS.length).map(safeMs) : [],
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

    reset() {
        this.entityManager = null;
        this.phase = 'idle';
        this.mapIndex = 0;
        this.mapTimesMs = [];
        this.currentTimeMs = 0;
        this._transitionRequested = false;
        this.records = loadRecords(this._getRecordStore());
    }

    start(entityManager) {
        if (this.phase === 'idle' || this.phase === 'finished') {
            this.reset();
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
        if (this.mapIndex === FIVE_PORTALS_MAPS.length - 1) {
            this.phase = 'finished';
            const total = this.mapTimesMs.reduce((sum, time) => sum + safeMs(time), 0);
            this.records = {
                version: FIVE_PORTALS_RECORD_VERSION,
                lastTotalMs: total,
                bestTotalMs: this.records.bestTotalMs > 0 ? Math.min(this.records.bestTotalMs, total) : total,
                lastMapsMs: [...this.mapTimesMs],
            };
            this._getRecordStore()?.saveJsonRecord?.(FIVE_PORTALS_RECORD_KEY, this.records);
            return this.getHudState();
        }
        this.mapIndex += 1;
        this.currentTimeMs = 0;
        this.phase = 'transition';
        if (!this._transitionRequested) {
            this._transitionRequested = true;
            this._requestMapTransition({ mapKey: FIVE_PORTALS_MAPS[this.mapIndex], botCount: 0, fivePortals: true });
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
            phase: this.phase,
            mapIndex: this.mapIndex,
            mapCount: FIVE_PORTALS_MAPS.length,
            currentMapKey: FIVE_PORTALS_MAPS[this.mapIndex],
            checkpoint: Math.max(0, Number(progress?.nextCheckpointIndex) || 0),
            checkpointCount: Math.max(0, Number(progress?.totalCheckpoints) || 0),
            respawnsRemaining: Math.max(0, 3 - (Number(progress?.checkpointRespawnsUsed) || 0)),
            currentTimeMs: this.phase === 'portal' || this.phase === 'finished' ? this.currentTimeMs : elapsedMs,
            completedTotalMs,
            mapTimesMs: [...this.mapTimesMs],
            records: { ...this.records },
            postRunSummary: this.phase === 'finished'
                ? { maps: FIVE_PORTALS_MAPS.map((mapKey, index) => ({ mapKey, timeMs: this.mapTimesMs[index] })), totalMs: completedTotalMs, bestTotalMs: this.records.bestTotalMs }
                : null,
        };
    }
}
