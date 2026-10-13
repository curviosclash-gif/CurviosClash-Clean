// Facade of the Arcade run. State and the public API live here; the work is done by the
// Arcade*Ops modules next to it, which receive this runtime as their first parameter.
import { arcadeRunUsesProfileBuild } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { recordArcadeDailyResult, finalizeArcadeRun } from './ArcadeRunCompletionOps.js';
import { completeArcadeParcoursSector } from './ArcadeRunParcoursSectorOps.js';
import { resolveArcadeRunReplayState } from './ArcadeRunReplayStateOps.js';
import {
    ARCADE_RUN_PHASES,
    cloneArcadeRunState,
    createArcadeRunConfig,
    createArcadeRunRecords,
} from '../../state/arcade/ArcadeRunState.js';
import { createArcadeDailyProjection } from '../../state/arcade/ArcadeDailyState.js';
import {
    getArcadeRunVehicleBonusesForRun,
    getArcadeRunVehicleId,
    getArcadeRunVehicleProfile,
} from './ArcadeRunVehicleRewardOps.js';
import { createLeaderboardProjection } from '../../state/arcade/ArcadeLeaderboard.js';
import { getGhostLibraryDebugSnapshot } from '../../state/arcade/ArcadeGhostLibrary.js';
import { ArcadeGhostRecorder } from '../../state/arcade/ArcadeGhostRecorder.js';
import { ArcadeRunPersistenceScheduler } from './ArcadeRunPersistenceScheduler.js';
import { initializeArcadePlayerProfileBindings } from './ArcadePlayerProfileBindings.js';
import { createArcadeTelemetrySnapshot } from './ArcadeTelemetrySnapshot.js';
import { syncArcadeMasteryPerks } from './ArcadeMasteryPerkRuntimeOps.js';
import { assignArcadeSectorRuntimeState } from './ArcadeObjectiveRuntimeOps.js';
import { applyParcoursLeaderboardEvent } from './ArcadeParcoursLeaderboardOps.js';
import { prepareArcadeIntermissionState } from './ArcadeIntermissionPlanOps.js';
import {
    clearGhostLibrarySaveTimer,
    flushArcadePersistenceSaves,
    flushPendingGhostLibrarySave,
    mergeGhostLibraryTelemetryDelta,
    readArcadeRecordsFromStorage,
    resolveArcadeSettingsRecordStore,
    scheduleArcadeLeaderboardSave,
    scheduleArcadeRecordsSave,
    scheduleArcadeVehicleProfilesSave,
    scheduleGhostLibrarySave,
} from './ArcadeRunPersistenceOps.js';
import { configureArcadeRun, resolveArcadeGhostLibraryBudgetOptions } from './ArcadeRunConfigureOps.js';
import { getArcadeRunHudState } from './ArcadeRunHudOps.js';
import {
    applyArcadeRunComboDecayAt,
    applyArcadeRunGameplayEvent,
    tickArcadeRunGameplay,
    updateArcadeRunMissions,
} from './ArcadeRunGameplayOps.js';
import {
    applyArcadePendingIntermissionEffects,
    resolveArcadeVictoryChoice,
    selectArcadeIntermissionChoice,
    selectArcadeReward,
} from './ArcadeRunIntermissionChoiceOps.js';
import {
    beginNextArcadeSector,
    resetArcadeRunState,
    startArcadeDailyChallenge,
    startArcadeRun,
} from './ArcadeRunLifecycleOps.js';
import {
    resetArcadeRunStrategyState,
    restoreArcadeSuddenDeath,
    setArcadeRunStrategy,
} from './ArcadeRunStrategyBridgeOps.js';
import { deriveArcadeRoundEndPlan } from './ArcadeRunRoundEndPlanOps.js';
import {
    applyArcadeSectorType,
    ensureArcadeEncounterSectorEntry,
    getArcadeEncounterSectorEntry,
    getArcadeSectorRuntimeProfile,
    resolveArcadeModifierForSector,
    resolveArcadeSectorType,
} from './ArcadeRunSectorOps.js';
import {
    applyArcadeParcoursXpEvent,
    applyArcadeSectorXpReward,
    handleArcadeMatchEndTelemetry,
    handleArcadeRoundEndTelemetry,
    recordArcadeSectorHistoryEntry,
} from './ArcadeRunTelemetryOps.js';
import { toSafeInt } from '../../shared/utils/ArcadeUtils.js';

const DEFAULT_GHOST_LIBRARY_SAVE_THROTTLE_MS = 250;
const DEFAULT_ARCADE_PERSISTENCE_SAVE_THROTTLE_MS = 250;

function resolveLogger(logger) {
    if (logger && typeof logger.log === 'function') return logger;
    return console;
}

export class ArcadeRunRuntime {
    constructor(options = {}) {
        this.settingsManager = options.settingsManager || null;
        initializeArcadePlayerProfileBindings(this, options.getRecordStoreForPlayerIndex);
        this.replayRecorder = options.replayRecorder || null;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.logger = resolveLogger(options.logger);
        this._runSequence = 0;
        this._config = createArcadeRunConfig();
        this._records = createArcadeRunRecords();
        this._state = null;
        this._enabled = false;
        this._vehicleProfiles = null;
        this._activeVehicleId = null;
        this._rewardBinding = null;
        this._missionState = null;
        this._hudEventSequence = 0;
        this._hudEvents = [];
        this._getMissionCapabilities = options.getMissionCapabilities || null;
        this._getObjectiveParticipants = typeof options.getObjectiveParticipants === 'function' ? options.getObjectiveParticipants : null;
        this._requestRoundEnd = typeof options.requestRoundEnd === 'function' ? options.requestRoundEnd : null;
        this._sectorElapsedSeconds = 0;
        this._lastMissionTickSecond = 0;
        this._onMapTransition = null;
        this._activeModifierId = null;
        this._onModifierChanged = null;
        this._onVehicleUpgradesChanged = null;
        this._onSuddenDeathEntered = null;
        this._pendingIntermissionEffects = null;
        this._pendingHumanVitals = null;
        this._latestReplaySnapshot = null;
        this._strategy = options.strategy || null;
        // 82.1.1: Current sector type ('sector_parcours' | null)
        this._currentSectorType = null;
        this._leaderboard = null;
        this._lastParcoursResult = null;
        this._ghostLibrary = {};
        this._ghostRecorder = new ArcadeGhostRecorder();
        this._onGhostPlayback = null;
        this._lastGhostPlaybackRouteId = '';
        this._ghostLibrarySaveThrottleMs = Math.max(
            0,
            toSafeInt(options.ghostLibrarySaveThrottleMs, DEFAULT_GHOST_LIBRARY_SAVE_THROTTLE_MS)
        );
        this._ghostLibrarySaveTimer = null;
        this._pendingGhostLibrarySave = null;
        this._persistenceScheduler = options.persistenceScheduler || new ArcadeRunPersistenceScheduler({
            saveThrottleMs: toSafeInt(
                options.arcadePersistenceSaveThrottleMs,
                DEFAULT_ARCADE_PERSISTENCE_SAVE_THROTTLE_MS
            ),
            logger: this.logger,
        });
        this._ghostLibraryDebugCounters = {
            evictedRoutes: 0,
            trimmedFrames: 0,
            migrationWrites: 0,
            droppedByByteBudget: 0,
        };
    }

    _nextRunId(nowMs = Date.now()) {
        this._runSequence += 1;
        return `arcade-run-${Math.floor(Math.max(0, nowMs)).toString(36)}-${this._runSequence}`;
    }

    _resolveSettingsRecordStore() {
        return resolveArcadeSettingsRecordStore(this);
    }

    _scheduleVehicleProfilesSave() {
        return scheduleArcadeVehicleProfilesSave(this);
    }

    _scheduleLeaderboardSave() {
        return scheduleArcadeLeaderboardSave(this);
    }

    _readRecordsFromStorage() {
        return readArcadeRecordsFromStorage(this);
    }

    _scheduleRecordsSave(records = this._records, onPersisted = null) {
        return scheduleArcadeRecordsSave(this, records, onPersisted);
    }

    _mergeGhostLibraryTelemetryDelta(delta) {
        mergeGhostLibraryTelemetryDelta(this, delta);
    }

    _clearGhostLibrarySaveTimer() {
        clearGhostLibrarySaveTimer(this);
    }

    _flushPendingGhostLibrarySave() {
        return flushPendingGhostLibrarySave(this);
    }

    flushGhostLibrarySaves() {
        return this._flushPendingGhostLibrarySave();
    }

    flushPersistenceSaves() {
        return flushArcadePersistenceSaves(this);
    }

    _scheduleGhostLibrarySave(store, budgetOptions) {
        scheduleGhostLibrarySave(this, store, budgetOptions);
    }

    configure(runtimeConfig = null) {
        return configureArcadeRun(this, runtimeConfig);
    }

    isEnabled() {
        return this._enabled;
    }

    getStateSnapshot() {
        return cloneArcadeRunState(this._state);
    }

    getPhase() {
        return String(this._state?.phase || '');
    }

    _enqueueHudEvent(type, payload = null) {
        const normalizedType = String(type || '').trim();
        if (!normalizedType) return null;
        this._hudEventSequence += 1;
        const event = Object.freeze({
            ...(payload && typeof payload === 'object' ? payload : {}),
            type: normalizedType,
            sequence: this._hudEventSequence,
        });
        this._hudEvents = [...this._hudEvents, event].slice(-64);
        return event;
    }

    _peekHudEvent(type) {
        for (let i = this._hudEvents.length - 1; i >= 0; i -= 1) {
            if (this._hudEvents[i]?.type === type) return this._hudEvents[i];
        }
        return null;
    }

    getRecordsSnapshot() {
        return createArcadeRunRecords(this._records);
    }

    _startReplayRecording({ entityManager = null, roundStateController = null, playerCount = 1 } = {}) {
        const recorder = this.replayRecorder;
        const replayEnabled = this._state?.config?.replayHooksEnabled === true
            || (this._state == null && this._config.replayHooksEnabled === true);
        if (!replayEnabled || !recorder || typeof recorder.startRecording !== 'function') {
            return;
        }
        try {
            recorder.startRecording(entityManager, roundStateController, playerCount);
        } catch (error) {
            this.logger?.warn?.('[ArcadeRunRuntime] Replay recording start failed:', error);
        }
    }

    _stopReplayRecording() {
        const recorder = this.replayRecorder;
        if (!recorder) return null;
        try {
            if (typeof recorder.stopRecording === 'function' && recorder.isRecording) {
                return recorder.stopRecording();
            }
            if (typeof recorder.getReplay === 'function') {
                return recorder.getReplay();
            }
        } catch (error) {
            this.logger?.warn?.('[ArcadeRunRuntime] Replay recording stop failed:', error);
        }
        return null;
    }

    setMapTransitionHandler(handler) {
        this._onMapTransition = typeof handler === 'function' ? handler : null;
    }

    // 61.4.1: Callback when active modifier changes (used to sync strategy)
    setModifierChangedHandler(handler) {
        this._onModifierChanged = typeof handler === 'function' ? handler : null;
    }

    _notifyModifierChanged(modifierId) {
        if (this._onModifierChanged) {
            try { this._onModifierChanged(modifierId); } catch { /* no-op */ }
        }
    }

    // 61.8.1: Callback when vehicle slot bonuses change (used to sync strategy)
    setVehicleUpgradesHandler(handler) {
        this._onVehicleUpgradesChanged = typeof handler === 'function' ? handler : null;
    }

    _notifyVehicleUpgradesChanged(bonuses) {
        if (this._onVehicleUpgradesChanged) {
            try { this._onVehicleUpgradesChanged(bonuses); } catch { /* no-op */ }
        }
    }

    // 61.6.2: Callback when Sudden Death phase is entered (used to sync strategy)
    setSuddenDeathEnteredHandler(handler) {
        this._onSuddenDeathEntered = typeof handler === 'function' ? handler : null;
    }

    _restoreSuddenDeath() {
        restoreArcadeSuddenDeath(this);
    }

    _notifySuddenDeathEntered() {
        if (this._onSuddenDeathEntered) {
            try { this._onSuddenDeathEntered(); } catch { /* no-op */ }
        }
    }

    setGhostPlaybackHandler(handler) {
        this._onGhostPlayback = typeof handler === 'function' ? handler : null;
    }

    getGhostRecorder() {
        return this._ghostRecorder;
    }

    _resolveGhostLibraryBudgetOptions(source = null) {
        return resolveArcadeGhostLibraryBudgetOptions(this, source);
    }

    // The strategy is built for the match being started, so its run type wins over a not yet synced config.
    _usesProfileBuild() {
        const runType = this._strategy?.getRunType?.() || this._config.runType || 'gauntlet';
        return arcadeRunUsesProfileBuild(runType, { dailyChallenge: this._config.dailyChallenge });
    }

    _getVehicleBonuses(profile = this.getVehicleProfile()) {
        return this._usesProfileBuild() ? (this._runBonuses = getArcadeRunVehicleBonusesForRun(this, profile)) : null;
    }

    setStrategy(strategy, humanPlayers = null) {
        setArcadeRunStrategy(this, strategy, humanPlayers);
    }

    _resetStrategyRuntimeState() {
        resetArcadeRunStrategyState(this);
    }

    _resolveActiveRunSeed(config = null) {
        return Math.max(0, toSafeInt(
            config?.seed ?? this._state?.config?.seed ?? this._config?.seed,
            0
        ));
    }

    setActiveVehicle(vehicleId) {
        this._activeVehicleId = String(vehicleId || 'ship1');
        syncArcadeMasteryPerks(this._state, this.getVehicleProfile());
    }

    _getRunVehicleId() {
        return getArcadeRunVehicleId(this);
    }

    getVehicleProfile() {
        return getArcadeRunVehicleProfile(this);
    }

    // 82.1.1: Whether the current sector is a parcours time-trial sector
    isCurrentSectorParcours() {
        return this._currentSectorType === 'sector_parcours';
    }

    _resolveSectorType(sectorIndex) {
        return resolveArcadeSectorType(this, sectorIndex);
    }

    _applySectorType(sectorIndex) {
        applyArcadeSectorType(this, sectorIndex);
    }

    // 61.4.1: Active modifier for the current sector
    getActiveModifierId() {
        return this._activeModifierId;
    }

    _resolveModifierForSector(sectorIndex) {
        return resolveArcadeModifierForSector(this, sectorIndex);
    }

    getMissionState() {
        return this._missionState ? { ...this._missionState } : null;
    }

    _getEncounterSectorEntry(sectorIndex) {
        return getArcadeEncounterSectorEntry(this, sectorIndex);
    }

    _ensureEncounterSectorEntry(sectorIndex) {
        return ensureArcadeEncounterSectorEntry(this, sectorIndex);
    }

    getSectorRuntimeProfile(sectorIndex = this._state?.sectorIndex || 1, options = {}) {
        return getArcadeSectorRuntimeProfile(this, sectorIndex, options);
    }

    _prepareIntermission(nowMs = Date.now()) {
        if (this._state?.phase === ARCADE_RUN_PHASES.VICTORY) return null;
        this._state.intermissionPaused = false;
        return prepareArcadeIntermissionState(this, nowMs);
    }

    getIntermissionState() {
        if (!this._state?.intermission || typeof this._state.intermission !== 'object') return null;
        return JSON.parse(JSON.stringify(this._state.intermission));
    }

    getPostRunSummary() {
        const summary = this._state?.postRunSummary;
        if (!summary || typeof summary !== 'object') return null;
        return JSON.parse(JSON.stringify(summary));
    }

    getTelemetrySnapshot(terminalReason = '') {
        return createArcadeTelemetrySnapshot({
            enabled: this._enabled,
            state: this._state,
            activeVehicleId: this._getRunVehicleId(),
            terminalReason,
        });
    }

    getReplayState() {
        return resolveArcadeRunReplayState(this);
    }

    getMenuSurfaceState() {
        return {
            runType: this._config.runType, phase: String(this._state?.phase || ''),
            isDailyChallenge: this._state?.isDailyChallenge === true,
            records: this.getRecordsSnapshot(),
            leaderboard: createLeaderboardProjection(this._leaderboard),
            lastParcoursResult: this._lastParcoursResult ? { ...this._lastParcoursResult } : null,
            legacyRecords: this._legacyRecords || null,
            victory: this._state?.victory || null,
            dailyResult: this._state?.dailyResult || null,
            intermissionPaused: this._state?.intermissionPaused === true,
            daily: createArcadeDailyProjection(this._records),
            intermission: this.getIntermissionState(),
            postRunSummary: this.getPostRunSummary(),
            replay: this.getReplayState(),
        };
    }

    getDebugSnapshot() {
        return {
            ghostRecorder: this._ghostRecorder?.getDebugSnapshot?.() || null,
            ghostLibrary: {
                ...getGhostLibraryDebugSnapshot(
                    this._ghostLibrary,
                    this._resolveGhostLibraryBudgetOptions()
                ),
                pendingSave: this._pendingGhostLibrarySave != null,
                saveThrottleMs: this._ghostLibrarySaveThrottleMs,
                counters: { ...this._ghostLibraryDebugCounters },
            },
        };
    }

    selectIntermissionChoice(choiceIdOrIndex) {
        return selectArcadeIntermissionChoice(this, choiceIdOrIndex);
    }

    selectReward(rewardId) {
        return selectArcadeReward(this, rewardId);
    }

    applyPendingIntermissionEffects({ players = null } = {}) {
        return applyArcadePendingIntermissionEffects(this, { players });
    }

    requestReplayExport() {
        const replayState = this.getReplayState();
        if (!replayState.payloadAvailable) {
            return { ok: false, code: 'replay_unavailable', replayState };
        }
        if (!replayState.playbackEnabled) {
            return { ok: false, code: 'replay_disabled', replayState };
        }
        const replaySnapshot = this._latestReplaySnapshot && typeof this._latestReplaySnapshot === 'object'
            ? { ...this._latestReplaySnapshot }
            : null;
        const replayJson = replaySnapshot ? JSON.stringify(replaySnapshot) : '';
        return {
            ok: true,
            code: 'replay_export_ready',
            replayState,
            replaySnapshot,
            replayJson,
        };
    }

    // Keep the legacy method for callers that still retrieve the raw replay payload here.
    requestReplayPlayback() {
        return this.requestReplayExport();
    }

    getHudState() {
        return getArcadeRunHudState(this);
    }

    updateMissions(event) {
        updateArcadeRunMissions(this, event);
    }

    _applyComboDecayAt(nowMs) {
        applyArcadeRunComboDecayAt(this, nowMs);
    }

    tickGameplay(dt = 0) {
        return tickArcadeRunGameplay(this, dt);
    }

    /**
     * Apply a mission event and, for action events, increment the combo.
     * 61.2.1 + 61.2.3 + 61.3.5
     */
    applyGameplayEvent(event) {
        return applyArcadeRunGameplayEvent(this, event);
    }

    startRun(options = {}) {
        return startArcadeRun(this, options);
    }

    /**
     * Start a Daily Challenge run using today's date in Germany as the seed.
     * All players on the same calendar day get the same sector sequence. (61.10.1)
     */
    startDailyChallenge(options = {}) {
        return startArcadeDailyChallenge(this, options);
    }

    beginNextSector() {
        return beginNextArcadeSector(this);
    }

    _assignMissionsForCurrentSector() {
        assignArcadeSectorRuntimeState(this);
    }

    /**
     * 82.1.2: Complete the current sector when triggered by parcours checkpoint-finish.
     * Called externally (e.g. from GameRuntimeFacade) when ParcoursProgressSystem.getRoundOutcome()
     * returns { shouldEnd: true }. The player is always considered alive at this point.
     * @param {Object} parcoursResult - Result from ParcoursProgressSystem.getRoundOutcome()
     * @returns {Object|null} Round end plan with intermission prepared, or null if not enabled.
     */
    completeParcoursSector(parcoursResult = {}, options = {}) {
        return completeArcadeParcoursSector(this, parcoursResult, options);
    }

    deriveRoundEndPlan({ players, inputs = {}, baseController } = {}) {
        return deriveArcadeRoundEndPlan(this, { players, inputs, baseController });
    }

    handleRoundEndTelemetry(payload = null) {
        return handleArcadeRoundEndTelemetry(this, payload);
    }

    handleMatchEndTelemetry(payload = null) {
        return handleArcadeMatchEndTelemetry(this, payload);
    }

    _recordSectorHistoryEntry(payload, nowMs) {
        recordArcadeSectorHistoryEntry(this, payload, nowMs);
    }

    // playerVehicleId: plane of that local pilot, so split-screen XP levels the plane that earned it.
    applyParcoursXpEvent(eventType, playerIndex = 0, playerVehicleId = null) {
        return applyArcadeParcoursXpEvent(this, eventType, playerIndex, playerVehicleId);
    }

    applyParcoursLeaderboardEvent(data) {
        return applyParcoursLeaderboardEvent(this, data);
    }

    _applySectorXpReward(telemetryPayload) {
        applyArcadeSectorXpReward(this, telemetryPayload);
    }

    _recordDailyResult(nowMs = Date.now()) {
        return recordArcadeDailyResult(this, nowMs);
    }

    isIntermissionPaused() {
        return this._state?.intermissionPaused === true;
    }

    setIntermissionPaused(paused) {
        if (this._state?.phase !== ARCADE_RUN_PHASES.INTERMISSION) return false;
        this._state.intermissionPaused = paused === true;
        return true;
    }

    resolveVictoryChoice(choice) {
        return resolveArcadeVictoryChoice(this, choice);
    }

    _finalizeRun(nowMs = Date.now()) {
        return finalizeArcadeRun(this, nowMs);
    }

    resetRunState(options = {}) {
        return resetArcadeRunState(this, options);
    }
}
