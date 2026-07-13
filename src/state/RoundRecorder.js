// ============================================
// RoundRecorder.js - Lightweight debug logger + KPI recorder
// ============================================

import { createLogger } from '../shared/logging/Logger.js';
import {
    normalizeGhostClip,
    normalizeGhostPlayerMeta,
} from '../shared/contracts/GhostClipContract.js';
import { RoundEventStore } from './recorder/RoundEventStore.js';

const logger = createLogger('RoundRecorder');
import { RoundMetricsStore } from './recorder/RoundMetricsStore.js';
import { RoundSnapshotStore } from './recorder/RoundSnapshotStore.js';

const MAX_EVENTS = 800;
const MAX_SNAPSHOTS = 900;
const MAX_ROUNDS = 120;
const MAX_TRACKED_PLAYERS = 16;

function normalizeRingValue(value, max) {
    if (!Number.isFinite(value)) return 0;
    const normalized = Math.max(0, Math.trunc(value));
    return normalized % Math.max(1, max);
}

function normalizeCountValue(value, max) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(Math.trunc(value), Math.max(1, max)));
}

export class RoundRecorder {
    constructor() {
        this.roundStartTime = 0;
        this._enabled = true;
        this._frameCaptureEnabled = false;
        this._replayCaptureEnabled = true;
        this._frameCounter = 0;
        this._snapshotInterval = 10;

        this._eventStore = new RoundEventStore({
            maxEvents: MAX_EVENTS,
            timeProvider: () => this._elapsedSeconds(),
        });
        this._snapshotStore = new RoundSnapshotStore({
            maxSnapshots: MAX_SNAPSHOTS,
            timeProvider: () => this._elapsedSeconds(),
        });
        this._metricsStore = new RoundMetricsStore({
            maxRounds: MAX_ROUNDS,
            maxTrackedPlayers: MAX_TRACKED_PLAYERS,
            timeProvider: () => this._elapsedSeconds(),
        });
        this._roundFinalizedListeners = new Set();

        this._bindCompatibilityAliases();
    }

    _bindCompatibilityAliases() {
        const bindAlias = (name, getter, setter) => {
            Object.defineProperty(this, name, {
                configurable: true,
                enumerable: true,
                get: getter,
                set: setter,
            });
        };

        bindAlias(
            'events',
            () => this._eventStore.events,
            (value) => {
                if (Array.isArray(value)) this._eventStore.events = value;
            }
        );
        bindAlias(
            'eventIndex',
            () => this._eventStore.eventIndex,
            (value) => { this._eventStore.eventIndex = normalizeRingValue(value, MAX_EVENTS); }
        );
        bindAlias(
            'eventCount',
            () => this._eventStore.eventCount,
            (value) => { this._eventStore.eventCount = normalizeCountValue(value, MAX_EVENTS); }
        );

        bindAlias(
            'snapshots',
            () => this._snapshotStore.snapshots,
            (value) => {
                if (Array.isArray(value)) this._snapshotStore.snapshots = value;
            }
        );
        bindAlias(
            'snapshotIndex',
            () => this._snapshotStore.snapshotIndex,
            (value) => { this._snapshotStore.snapshotIndex = normalizeRingValue(value, MAX_SNAPSHOTS); }
        );
        bindAlias(
            'snapshotCount',
            () => this._snapshotStore.snapshotCount,
            (value) => { this._snapshotStore.snapshotCount = normalizeCountValue(value, MAX_SNAPSHOTS); }
        );

        bindAlias(
            'roundSummaries',
            () => this._metricsStore.roundSummaries,
            (value) => {
                if (Array.isArray(value)) this._metricsStore.roundSummaries = value;
            }
        );
        bindAlias(
            'roundSummaryIndex',
            () => this._metricsStore.roundSummaryIndex,
            (value) => { this._metricsStore.roundSummaryIndex = normalizeRingValue(value, MAX_ROUNDS); }
        );
        bindAlias(
            'roundSummaryCount',
            () => this._metricsStore.roundSummaryCount,
            (value) => { this._metricsStore.roundSummaryCount = normalizeCountValue(value, MAX_ROUNDS); }
        );
    }

    _elapsedSeconds() {
        return this.roundStartTime > 0 ? (performance.now() - this.roundStartTime) / 1000 : 0;
    }

    startRound(players = []) {
        this._eventStore.reset();
        this._snapshotStore.reset();
        this._frameCounter = 0;
        this.roundStartTime = performance.now();
        this._metricsStore.startRound(players);
    }

    logEvent(type, playerIndex, data = '') {
        if (!this._enabled) return;
        this._eventStore.append(type, playerIndex, data);
        this._metricsStore.registerEventType(type, data);
    }

    markPlayerSpawn(player) {
        if (!this._enabled) return;
        this._metricsStore.markPlayerSpawn(player);
    }

    markPlayerDeath(player, cause = '') {
        if (!this._enabled) return;
        this._metricsStore.markPlayerDeath(player, cause);
    }

    recordDamageEvent(event = null) {
        if (!this._enabled) return;
        this._metricsStore.registerDamageEvent(event);
    }

    finalizeRound(winner, players = [], options = {}) {
        if (!this._enabled) return null;
        const roundSummary = this._metricsStore.finalizeRound(winner, players, options);
        const duration = Math.round(roundSummary.duration * 100) / 100;
        const reason = typeof roundSummary.reason === 'string' && roundSummary.reason.trim()
            ? roundSummary.reason.trim()
            : 'ELIMINATION';
        const parcoursFlag = roundSummary.parcoursCompleted ? 1 : 0;
        const routeId = typeof roundSummary.parcoursRouteId === 'string' && roundSummary.parcoursRouteId.trim()
            ? roundSummary.parcoursRouteId.trim()
            : '-';
        this.logEvent(
            'ROUND_END',
            roundSummary.winnerIndex,
            `duration=${duration} reason=${reason} parcours=${parcoursFlag} route=${routeId}`
        );
        this._notifyRoundFinalized(roundSummary);
        return roundSummary;
    }

    onRoundFinalized(listener) {
        if (typeof listener !== 'function') return () => {};
        this._roundFinalizedListeners.add(listener);
        return () => {
            this._roundFinalizedListeners.delete(listener);
        };
    }

    _notifyRoundFinalized(roundSummary) {
        for (const listener of this._roundFinalizedListeners) {
            try {
                listener(roundSummary, this);
            } catch (error) {
                logger.warn('Round-finalized listener failed', error);
            }
        }
    }

    getLastRoundMetrics() {
        return this._metricsStore.getLastRoundMetrics();
    }

    getAggregateMetrics() {
        return this._metricsStore.getAggregateMetrics();
    }

    getAggregateTotals() {
        return this._metricsStore.getAggregateTotals();
    }

    getRoundSummaries(limit = null) {
        return this._metricsStore.getRoundSummaries(limit);
    }

    resetAggregateMetrics() {
        this._metricsStore.resetAggregateMetrics();
    }

    setFrameCaptureEnabled(enabled) {
        this._frameCaptureEnabled = !!enabled;
    }

    setReplayCaptureEnabled(enabled) {
        this._replayCaptureEnabled = !!enabled;
    }

    isFrameCaptureEnabled() {
        return this._frameCaptureEnabled || this._replayCaptureEnabled;
    }

    shouldCaptureFrames() {
        return this._enabled && this.isFrameCaptureEnabled();
    }

    recordFrame(players) {
        if (!this.shouldCaptureFrames() || !Array.isArray(players)) return;
        this._frameCounter++;
        if (this._frameCounter % this._snapshotInterval !== 0) return;
        this.captureSnapshotNow(players);
    }

    captureSnapshotNow(players = []) {
        if (!this.shouldCaptureFrames() || !Array.isArray(players)) return false;
        this._snapshotStore.capture(players);
        return true;
    }

    getLastRoundGhostClip(players = [], options = {}) {
        const includeBots = options?.includeBots === true;
        let orderedSnapshots = this._snapshotStore.getOrderedSnapshots();
        if (orderedSnapshots.length < 2 && Array.isArray(players) && players.length > 0) {
            this.captureSnapshotNow(players);
            orderedSnapshots = this._snapshotStore.getOrderedSnapshots();
            if (orderedSnapshots.length < 2) {
                // Keep a deterministic fallback clip even under severe frame throttling.
                this.captureSnapshotNow(players);
                orderedSnapshots = this._snapshotStore.getOrderedSnapshots();
            }
        }
        if (orderedSnapshots.length < 2) return null;

        const maxSourceDuration = Math.max(0.5, Number(options.maxSourceDuration) || 12);
        const fallbackSnapshotStep = Math.max(1, Number(this._snapshotInterval) || 1) / 60;
        const finalTime = Number(orderedSnapshots[orderedSnapshots.length - 1]?.time) || 0;
        const minTime = Math.max(0, finalTime - maxSourceDuration);
        let startIndex = 0;
        while (
            startIndex < orderedSnapshots.length - 2
            && Number(orderedSnapshots[startIndex + 1]?.time) < minTime
        ) {
            startIndex++;
        }

        const selectedCount = orderedSnapshots.length - startIndex;
        const startTime = Number(orderedSnapshots[startIndex]?.time) || 0;
        const normalizedFrames = new Array(selectedCount);
        for (let index = 0; index < selectedCount; index++) {
            const snapshot = orderedSnapshots[startIndex + index];
            const rawTime = Math.max(0, (Number(snapshot?.time) || 0) - startTime);
            const previousTime = index > 0 ? normalizedFrames[index - 1].time : 0;
            const normalizedTime = index > 0 && rawTime < (previousTime + fallbackSnapshotStep * 0.5)
                ? previousTime + fallbackSnapshotStep
                : rawTime;
            const srcPlayers = Array.isArray(snapshot?.players) ? snapshot.players : [];
            const framePlayers = [];
            for (let j = 0; j < srcPlayers.length; j++) {
                const p = srcPlayers[j];
                if (!includeBots && p?.bot === true) continue;
                framePlayers.push({
                    idx: p.idx, alive: p.alive,
                    x: p.x, y: p.y, z: p.z,
                    qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw,
                    bot: p.bot,
                });
            }
            normalizedFrames[index] = { time: normalizedTime, players: framePlayers };
        }
        const sourceDuration = Number(normalizedFrames[normalizedFrames.length - 1]?.time) || 0;
        if (normalizedFrames.length < 2 || sourceDuration <= 0) return null;

        const clipPlayers = Array.isArray(players)
            ? players
                .filter((player) => includeBots || player?.isBot !== true)
                .map((player) => normalizeGhostPlayerMeta({
                    idx: player?.index,
                    color: player?.color,
                    isBot: player?.isBot,
                    modelScale: player?.modelScale,
                }))
                .filter(Boolean)
            : [];

        return normalizeGhostClip({
            sourceDuration,
            displayDuration: Math.max(0.5, Number(options.displayDuration) || 3),
            frames: normalizedFrames,
            players: clipPlayers,
        });
    }

    dump() {
        const eventList = this._eventStore.toLogLines();
        const lastRound = this.getLastRoundMetrics();
        const aggregate = this.getAggregateMetrics();

        logger.debug(`Duration: ${Math.round(this._elapsedSeconds() * 10) / 10}s`);
        logger.debug(`Events: ${this._eventStore.eventCount}`);
        if (lastRound) {
            logger.debug('Round KPI:', lastRound);
        }
        logger.debug('Aggregate KPI:', aggregate);

        const snapList = this._snapshotStore.getRecentSnapshotTable(20);
        if (snapList.length > 0) {
            logger.debug('Recent positions:', snapList);
        }

        return {
            events: eventList,
            snapshots: snapList,
            lastRound,
            aggregate,
            baselineDelta: null,
        };
    }
}
