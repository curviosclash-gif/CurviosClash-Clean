import {
    buildRouteFromParcours,
    createPlayerProgressState,
    formatDurationMs,
    normalizeString,
    nowMs,
} from './ParcoursProgressUtils.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { resetParcoursProgressState, rewindParcoursProgressState } from './ParcoursProgressStateOps.js';
import {
    buildRouteSnapshot,
    cancelGhostRecordingForPlayer,
    clearGhostRecording,
    playerOwnsGhostRecording,
    resolveProgressPlayerIndex,
} from './ParcoursProgressRuntime.js';
import {
    createPlayerHudState,
    createPlayerProgressSnapshot,
} from './ParcoursProgressSnapshot.js';

export class ParcoursProgressSystem {
    constructor(entityManager, options = {}) {
        this.entityManager = entityManager || null;
        this.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : nowMs;
        this._route = null;
        this._playerStates = new Map();
        this._completionOrder = [];
        this._xpEventCallback = null;
        this._leaderboardCallback = null;
        this._ghostRecorder = null;
        this._progressPlayerIndexResolver = null;
    }
    setXpEventCallback(callback) {
        this._xpEventCallback = typeof callback === 'function' ? callback : null;
    }
    setLeaderboardCallback(callback) {
        this._leaderboardCallback = typeof callback === 'function' ? callback : null;
    }
    setGhostRecorder(recorder) {
        this._ghostRecorder = recorder && typeof recorder.sample === 'function' ? recorder : null;
    }
    setProgressPlayerIndexResolver(resolver) {
        this._progressPlayerIndexResolver = typeof resolver === 'function' ? resolver : null;
    }
    _resolveProgressPlayerIndex(players = null) {
        return resolveProgressPlayerIndex(
            this.entityManager,
            this._route,
            this._progressPlayerIndexResolver,
            players
        );
    }
    _playerOwnsGhostRecording(player) {
        return playerOwnsGhostRecording(this._ghostRecorder, player);
    }
    _clearGhostRecording(reason = 'reset') {
        clearGhostRecording(this._ghostRecorder, reason);
    }
    _cancelGhostRecordingForPlayer(player, reason = 'cancelled') {
        return cancelGhostRecordingForPlayer(this._ghostRecorder, player, reason);
    }
    isEnabled() {
        return !!this._route;
    }
    reset() {
        this._clearGhostRecording('parcours-reset');
        this._route = null;
        this._playerStates.clear();
        this._completionOrder.length = 0;
        this.entityManager?.arena?._portalGateSystem?.checkpointRingRuntime?.setProgressProvider?.(null);
    }
    startRound(players = []) {
        this._clearGhostRecording('round-start');
        const entityRuntimeConfig = resolveEntityRuntimeConfig(this.entityManager);
        const mapScale = Number(entityRuntimeConfig?.ARENA?.MAP_SCALE);
        this._route = buildRouteFromParcours(this.entityManager?.arena?.currentMapDefinition?.parcours, {
            positionScale: Number.isFinite(mapScale) && mapScale > 0 ? mapScale : 1,
        });
        this._playerStates.clear();
        this._completionOrder.length = 0;
        if (!this._route) return;
        if (!Array.isArray(players)) return;
        for (const player of players) {
            if (!player || !Number.isInteger(player.index)) continue;
            this._playerStates.set(player.index, createPlayerProgressState(this._route.totalCheckpoints));
        }
        const rt = this.entityManager?.arena?._portalGateSystem?.checkpointRingRuntime;
        rt?.setProgressProvider?.(() => {
            const progressPlayerIndex = this._resolveProgressPlayerIndex(this.entityManager?.players || players);
            return this.getPlayerProgressSnapshot(progressPlayerIndex);
        });
        rt?.setParticleSystem?.(this.entityManager?.particles || null);
    }
    _ensurePlayerState(playerIndex) {
        if (!this._route || !Number.isInteger(playerIndex)) return null;
        if (!this._playerStates.has(playerIndex)) {
            this._playerStates.set(playerIndex, createPlayerProgressState(this._route.totalCheckpoints));
        }
        return this._playerStates.get(playerIndex);
    }
    _setCheckpointCooldown(state, checkpointId, now) {
        if (!state || !checkpointId) return;
        state.cooldownByCheckpointId.set(checkpointId, now);
    }
    _isCheckpointOnCooldown(state, checkpointId, cooldownMs, now) {
        if (!state || !checkpointId || !(cooldownMs > 0)) return false;
        const lastTriggerAt = state.cooldownByCheckpointId.get(checkpointId);
        if (!Number.isFinite(lastTriggerAt)) return false;
        return (now - lastTriggerAt) < cooldownMs;
    }
    _isCheckpointTriggered(entry, player, previousPosition, now, state) {
        if (!entry || !player?.position || !previousPosition) return false;
        const px = Number(player.position.x) || 0;
        const py = Number(player.position.y) || 0;
        const pz = Number(player.position.z) || 0;
        const radius = Math.max(0.05, Number(player.hitboxRadius) || 0.8);
        const checkRadius = entry.radius + radius;
        const dx = px - entry.pos[0];
        const dy = py - entry.pos[1];
        const dz = pz - entry.pos[2];
        const insideRadius = ((dx * dx) + (dy * dy) + (dz * dz)) <= (checkRadius * checkRadius);
        const insideMap = state?.insideCheckpointById;
        const checkpointId = entry.id || '';
        if (!insideRadius) {
            if (checkpointId && insideMap instanceof Map) {
                insideMap.set(checkpointId, false);
            }
            return false;
        }

        const wasInside = checkpointId && insideMap instanceof Map
            ? insideMap.get(checkpointId) === true
            : false;
        if (checkpointId && insideMap instanceof Map) {
            insideMap.set(checkpointId, true);
        }
        if (wasInside) return false;
        if (this._isCheckpointOnCooldown(state, entry.id, entry.cooldownMs, now)) return false;
        if (this._route?.rules?.bidirectionalCheckpoints !== false || !entry.forward) return true;

        const prevDx = (Number(previousPosition.x) || 0) - entry.pos[0];
        const prevDy = (Number(previousPosition.y) || 0) - entry.pos[1];
        const prevDz = (Number(previousPosition.z) || 0) - entry.pos[2];
        const dotPrev = (prevDx * entry.forward[0]) + (prevDy * entry.forward[1]) + (prevDz * entry.forward[2]);
        const dotCurr = (dx * entry.forward[0]) + (dy * entry.forward[1]) + (dz * entry.forward[2]);
        return dotPrev <= 0 && dotCurr > 0;
    }
    _notifyPlayer(player, message) {
        if (!player || !message) return;
        this.entityManager?._notifyPlayerFeedback?.(player, message);
    }
    _logRecorderEvent(type, player, details = '') {
        if (!player) return;
        this.entityManager?.recorder?.logEvent?.(type, player.index, details);
    }
    _playProgressAudio(type, player, options = {}) {
        if (!type || !player || player.isBot === true) return;
        this.entityManager?.audio?.play?.(type, options);
    }
    _setErrorState(state, message, now) {
        if (!this._route || !state) return;
        state.lastError = normalizeString(message, '');
        state.errorUntilMs = Math.max(0, now + this._route.rules.errorIndicatorMs);
    }
    onPlayerSpawn(player, options = {}) {
        if (!this._route || !player || !Number.isInteger(player.index)) return;
        const state = this._ensurePlayerState(player.index);
        if (!state) return;
        const reason = normalizeString(options.reason, 'spawn');
        if (reason === 'round_start' || reason === 'match_start' || reason === 'spawn_all') {
            resetParcoursProgressState(state, {
                countReset: false,
                preserveCounters: false,
                errorMessage: '',
                now: this.nowProvider(),
                setErrorState: this._setErrorState.bind(this),
            });
        }
    }

    onPlayerDeath(player, options = {}) {
        if (!this._route || !player || !Number.isInteger(player.index)) return;
        const state = this._ensurePlayerState(player.index);
        if (!state || state.completed) return;

        const reason = normalizeString(options.cause, 'death');
        this._cancelGhostRecordingForPlayer(player, `death:${reason}`);
        if (this._route.rules.resetOnDeath) {
            resetParcoursProgressState(state, {
                countReset: true,
                preserveCounters: true,
                errorMessage: 'Parcours-Reset nach Tod',
                now: this.nowProvider(),
                setErrorState: this._setErrorState.bind(this),
            });
            this._notifyPlayer(player, 'Parcours-Reset nach Respawn');
            this._logRecorderEvent('PARCOURS_RESET', player, `cause=${reason}`);
            return;
        }

        if (this._route.rules.resetToLastValid) {
            rewindParcoursProgressState(state, this._route, {
                now: this.nowProvider(),
                errorMessage: 'Rueckfall auf letzten Checkpoint',
                setErrorState: this._setErrorState.bind(this),
            });
            this._notifyPlayer(player, 'Parcours-Rueckfall nach Respawn');
            this._logRecorderEvent('PARCOURS_RESET', player, `cause=${reason} mode=last-valid`);
        }
    }

    _acceptCheckpoint(player, state, entry, now) {
        if (!this._route || !state || !entry) return;
        this._setCheckpointCooldown(state, entry.id, now);
        if (state.startedAtMs <= 0) {
            state.startedAtMs = now;
            const shouldStartGhostRecording = this._route.rules.showGhost && player?.isBot !== true;
            if (shouldStartGhostRecording) {
                const recorderStarted = this._ghostRecorder
                    ? this._ghostRecorder.startRecording(player.index, now, {
                        routeId: this._route.routeId,
                        isBot: player?.isBot === true,
                        color: player?.color,
                        modelScale: player?.modelScale,
                    }) === true
                    : false;
                if (recorderStarted) {
                    this._leaderboardCallback?.({
                        type: 'ghost_start',
                        playerIndex: player.index,
                        routeId: this._route.routeId,
                        source: 'parcours_checkpoint_start',
                    });
                }
            }
        }
        state.lastCheckpointAtMs = now;
        state.lastCheckpointId = entry.id;
        state.lastError = '';
        state.errorUntilMs = 0;
        if (entry.routeIndex >= 0 && entry.routeIndex < state.passedMask.length) {
            state.passedMask[entry.routeIndex] = 1;
            state.stageCheckpointIds[entry.routeIndex] = entry.id;
        }

        if (this._route.rules.ordered) {
            state.nextCheckpointIndex = Math.max(
                state.nextCheckpointIndex,
                Math.min(this._route.totalCheckpoints, entry.routeIndex + 1)
            );
        } else {
            let passedCount = 0;
            for (let i = 0; i < state.passedMask.length; i += 1) {
                if (state.passedMask[i] === 1) passedCount += 1;
            }
            state.nextCheckpointIndex = passedCount;
        }

        const progressText = `Checkpoint validiert (${Math.min(this._route.totalCheckpoints, state.nextCheckpointIndex)}/${this._route.totalCheckpoints})`;
        this._notifyPlayer(player, progressText);
        this._logRecorderEvent(
            'PARCOURS_CP',
            player,
            `id=${entry.id} index=${entry.routeIndex + 1}/${this._route.totalCheckpoints}`
        );
        this._playProgressAudio(
            entry.isBranchOption === true ? 'PARCOURS_BRANCH' : 'PARCOURS_CP',
            player,
            { intensity: entry.isBranchOption === true ? 1.05 : 0.9 }
        );
        const splitMs = state.startedAtMs > 0 ? Math.max(0, now - state.startedAtMs) : 0;
        state.segmentSplitsMs.push(splitMs);
        const checkpointIndex = state.segmentSplitsMs.length - 1;

        const cpXpResult = this._xpEventCallback?.('checkpoint', player.index);
        if (cpXpResult?.earned > 0) {
            this._notifyPlayer(player, `+${cpXpResult.earned} XP`);
        }
        this._leaderboardCallback?.({
            type: 'checkpoint',
            playerIndex: player.index,
            routeId: this._route.routeId,
            checkpointIndex,
            currentSplitMs: splitMs,
        });
    }

    _registerWrongOrder(player, state, entry, now) {
        if (!this._route || !state || !entry) return;
        if (now - state.lastWrongOrderAtMs < this._route.rules.wrongOrderCooldownMs) return;
        state.lastWrongOrderAtMs = now;
        state.wrongOrderCount += 1;
        const penaltyMs = Math.max(0, Math.trunc(Number(this._route.rules?.wrongOrderPenaltyMs) || 0));
        if (penaltyMs > 0) {
            state.penaltyTimeMs = Math.max(0, Math.trunc(Number(state.penaltyTimeMs) || 0)) + penaltyMs;
        }
        this._setErrorState(state, 'Falsche Reihenfolge', now);
        if (penaltyMs > 0) {
            this._notifyPlayer(player, `Falsche Reihenfolge: ${entry.id} (+${(penaltyMs / 1000).toFixed(1)}s Penalty)`);
            this._leaderboardCallback?.({
                type: 'wrong_order',
                playerIndex: player.index,
                routeId: this._route.routeId,
                penaltyMs,
                totalPenaltyMs: state.penaltyTimeMs,
            });
        } else {
            this._notifyPlayer(player, `Falsche Reihenfolge: ${entry.id}`);
        }
        this._logRecorderEvent(
            'PARCOURS_WRONG_ORDER',
            player,
            `expected=${state.nextCheckpointIndex + 1} got=${entry.id} penaltyMs=${penaltyMs} totalPenaltyMs=${state.penaltyTimeMs}`
        );
    }

    _registerSegmentTimeout(player, state, now) {
        this._cancelGhostRecordingForPlayer(player, 'segment-timeout');
        if (this._route?.rules?.resetToLastValid) {
            rewindParcoursProgressState(state, this._route, {
                now,
                errorMessage: 'Segment-Zeit ueberschritten',
                setErrorState: this._setErrorState.bind(this),
            });
            this._notifyPlayer(player, 'Segment-Zeitfenster verpasst (Rueckfall)');
            this._logRecorderEvent('PARCOURS_TIMEOUT', player, 'segment-timeout mode=last-valid');
            return;
        }

        resetParcoursProgressState(state, {
            countReset: true,
            preserveCounters: true,
            errorMessage: 'Segment-Zeit ueberschritten',
            now,
            setErrorState: this._setErrorState.bind(this),
        });
        this._notifyPlayer(player, 'Segment-Zeitfenster verpasst');
        this._logRecorderEvent('PARCOURS_TIMEOUT', player, 'segment-timeout mode=full-reset');
    }

    _completeParcours(player, state, now) {
        if (!this._route || !state || state.completed) return;
        state.completed = true;
        state.completedAtMs = now;
        const baseTimeMs = Math.max(0, now - (state.startedAtMs || now));
        const penaltyTimeMs = Math.max(0, Math.trunc(Number(state.penaltyTimeMs) || 0));
        state.completionTimeMs = baseTimeMs + penaltyTimeMs;
        state.nextCheckpointIndex = this._route.totalCheckpoints;
        state.lastCheckpointAtMs = now;
        state.lastError = '';
        state.errorUntilMs = 0;

        if (!this._completionOrder.some((entry) => entry.playerIndex === player.index)) {
            this._completionOrder.push({
                playerIndex: player.index,
                completedAtMs: state.completedAtMs,
                completionTimeMs: state.completionTimeMs,
                penaltyTimeMs,
            });
            this._completionOrder.sort((left, right) => {
                if (left.completedAtMs !== right.completedAtMs) {
                    return left.completedAtMs - right.completedAtMs;
                }
                return left.playerIndex - right.playerIndex;
            });
        }

        this._notifyPlayer(player, `Parcours abgeschlossen (${formatDurationMs(state.completionTimeMs)})`);
        this._logRecorderEvent(
            'PARCOURS_COMPLETE',
            player,
            `route=${this._route.routeId} timeMs=${Math.round(state.completionTimeMs)} penaltyMs=${penaltyTimeMs}`
        );
        this._playProgressAudio('PARCOURS_FINISH', player, { intensity: 1.15 });
        const finishXpResult = this._xpEventCallback?.('finish', player.index);
        if (finishXpResult?.earned > 0) {
            this._notifyPlayer(player, `+${finishXpResult.earned} XP (Parcours)`);
        }
        const shouldFinalizeGhost = this._route.rules.showGhost && player?.isBot !== true;
        const recorderOwnedByPlayer = this._playerOwnsGhostRecording(player);
        const ghostClip = shouldFinalizeGhost && recorderOwnedByPlayer
            ? (this._ghostRecorder?.stopRecording?.(player.index) || null)
            : null;
        const ghostDurationMsFromClip = Math.max(0, Math.round(Number(ghostClip?.sourceDuration) * 1000));
        this._leaderboardCallback?.({
            type: 'finish',
            playerIndex: player.index,
            routeId: this._route.routeId,
            totalTimeMs: state.completionTimeMs,
            penaltyTimeMs,
            segmentSplitsMs: [...state.segmentSplitsMs],
            ghostDurationMs: ghostDurationMsFromClip > 0 ? ghostDurationMsFromClip : baseTimeMs,
            ghostClip,
        });
    }

    _findTriggeredEntry(entries, player, previousPosition, now, state) {
        if (!Array.isArray(entries) || entries.length === 0) return null;
        for (const entry of entries) {
            if (this._isCheckpointTriggered(entry, player, previousPosition, now, state)) {
                return entry;
            }
        }
        return null;
    }

    updatePlayerProgress(player, previousPosition, now = this.nowProvider()) {
        if (!this._route || !player?.alive || !Number.isInteger(player.index)) return null;
        const state = this._ensurePlayerState(player.index);
        if (!state || state.completed) return null;

        if (state.startedAtMs > 0 && this._playerOwnsGhostRecording(player)) {
            this._ghostRecorder.sample(player, now);
        }

        const expectedIndex = Math.max(0, Math.min(this._route.totalCheckpoints, state.nextCheckpointIndex));
        const segmentTimeoutActive = this._route.rules.maxSegmentTimeMs > 0
            && state.lastCheckpointAtMs > 0
            && expectedIndex > 0;
        if (segmentTimeoutActive && (now - state.lastCheckpointAtMs) > this._route.rules.maxSegmentTimeMs) {
            this._registerSegmentTimeout(player, state, now);
            return { type: 'segment-timeout' };
        }

        if (expectedIndex < this._route.totalCheckpoints) {
            const expectedEntries = this._route.entriesByCheckpointIndex[expectedIndex] || [];
            const expectedHit = this._findTriggeredEntry(expectedEntries, player, previousPosition, now, state);
            if (expectedHit) {
                this._acceptCheckpoint(player, state, expectedHit, now);
                return { type: 'checkpoint', checkpointId: expectedHit.id };
            }
        }

        if (expectedIndex >= this._route.totalCheckpoints && this._route.finish) {
            const finishHit = this._isCheckpointTriggered(this._route.finish, player, previousPosition, now, state);
            if (finishHit) {
                this._completeParcours(player, state, now);
                return { type: 'finish', checkpointId: this._route.finish.id };
            }
        }

        for (const entry of this._route.checkpoints) {
            if (entry.routeIndex === expectedIndex) continue;
            if (!this._isCheckpointTriggered(entry, player, previousPosition, now, state)) continue;
            this._registerWrongOrder(player, state, entry, now);
            return { type: 'wrong-order', checkpointId: entry.id };
        }

        return null;
    }

    getRoundOutcome() {
        if (!this._route || this._route.rules.winnerByParcoursComplete !== true) return null;
        const completion = this._completionOrder[0];
        if (!completion) return null;
        const winner = this.entityManager?.players?.[completion.playerIndex] || null;
        if (!winner) return null;
        return {
            shouldEnd: true,
            winner,
            reason: 'PARCOURS_COMPLETE',
            parcours: {
                routeId: this._route.routeId,
                checkpointCount: this._route.totalCheckpoints,
                completionTimeMs: completion.completionTimeMs,
                penaltyTimeMs: Math.max(0, Math.trunc(Number(completion.penaltyTimeMs) || 0)),
                completedAtMs: completion.completedAtMs,
            },
        };
    }

    getPlayerProgressSnapshot(playerIndex, now = this.nowProvider()) {
        if (!this._route) return null;
        const state = this._ensurePlayerState(playerIndex);
        if (!state) return null;
        return createPlayerProgressSnapshot(this._route, state, now);
    }

    getPlayerHudState(playerIndex, now = this.nowProvider()) {
        if (!this._route) return null;
        const snapshot = this.getPlayerProgressSnapshot(playerIndex, now);
        if (!snapshot) return null;
        return createPlayerHudState(snapshot);
    }

    getRouteSnapshot() {
        return buildRouteSnapshot(this._route);
    }
}
