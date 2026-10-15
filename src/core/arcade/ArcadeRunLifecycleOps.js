// Start, sector advance and reset of the Arcade run, moved out of ArcadeRunRuntime unchanged.
// `runtime` is the ArcadeRunRuntime.
import {
    ARCADE_RUN_PHASES,
    beginArcadeSector,
    createArcadeRunState,
} from '../../state/arcade/ArcadeRunState.js';
import { resolveMapSequence, getMapKeyForSector } from '../../state/arcade/ArcadeMapProgression.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { toSafeInt, toSafeNumber, computeDailySeed } from '../../shared/utils/ArcadeUtils.js';
import { bindArcadeRunVehicleRewards } from './ArcadeRunVehicleRewardOps.js';
import { clearArcadePlayerProfileBindings, loadArcadeRunVehicleProfiles } from './ArcadePlayerProfileBindings.js';
import { syncArcadeRunRewardEffects } from './ArcadeIntermissionEffects.js';

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

export function startArcadeRun(runtime, options = {}) {
    if (!runtime._enabled) return null;
    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    const runId = runtime._nextRunId(nowMs);
    runtime._pendingIntermissionEffects = null;
    runtime._pendingHumanVitals = null;
    runtime._latestReplaySnapshot = null;
    runtime._strategy = options.strategy || runtime._strategy || null;
    runtime._resetStrategyRuntimeState();
    // 61.10.1: Allow options.seed to override config seed (e.g., for daily challenge)
    const runConfig = { ...runtime._config,
        seed: options.seed != null ? toSafeNumber(options.seed, runtime._config.seed) : runtime._config.seed,
        dailyChallenge: options.dailyChallenge === true || runtime._config.dailyChallenge === true,
    };
    const activeRunSeed = runtime._resolveActiveRunSeed(runConfig);
    runtime._state = createArcadeRunState({
        config: runConfig,
        records: runtime._records,
        nowMs,
        runId,
    });
    bindArcadeRunVehicleRewards(runtime, runConfig.runType);
    runtime._runVehicleStoneStepsById = Object.create(null);
    runtime._runVehicleWeaponsById = Object.create(null);
    if (options.dailyChallenge || runConfig.dailyChallenge === true) {
        runtime._state.isDailyChallenge = true;
    }
    runtime._state.intermission = null;
    runtime._hudEvents = [];
    runtime._state.sectorHistory = [];
    runtime._state.rewardHistory = [];
    runtime._state.postRunSummary = null;
    runtime._state.lastIntermissionHeal = null;
    runtime._state.suddenDeathStartedAtMs = null;
    runtime._state.replay = {
        ...(runtime._state.replay && typeof runtime._state.replay === 'object' ? runtime._state.replay : {}),
        playbackEnabled: runConfig.replayHooksEnabled === true,
        payloadAvailable: false,
    };

    loadArcadeRunVehicleProfiles(runtime, runConfig, options);
    // Resolve map sequence from encounter plan if available
    if (options.encounterPlan) {
        const runtimeMapCatalog = getRuntimeMapCatalog();
        const mapSequence = resolveMapSequence(options.encounterPlan, String(activeRunSeed), runtimeMapCatalog);
        runtime._state.mapSequence = mapSequence;
        if (mapSequence.length > 0) {
            runtime._state.currentMapKey = mapSequence[0];
        }
        // Store encounter sequence for dynamic sector scoring (V61.1)
        if (Array.isArray(options.encounterPlan.sequence)) {
            runtime._state.encounterSequence = options.encounterPlan.sequence;
        }
        runtime._state.encounterDifficulty = String(options.encounterPlan.difficulty || 'normal');
    }
    if (!runtime._state.currentMapKey) {
        runtime._state.currentMapKey = getMapKeyForSector(runtime._state.mapSequence, 0);
    }

    runtime._state = beginArcadeSector(runtime._state, nowMs);
    runtime._sectorElapsedSeconds = 0;
    runtime._lastMissionTickSecond = 0;

    // 61.4.1: Resolve modifier for the first sector
    runtime._activeModifierId = runtime._resolveModifierForSector(runtime._state.sectorIndex);
    runtime._notifyModifierChanged(runtime._activeModifierId);

    // 82.1.1: Apply sector type (parcours vs arena)
    runtime._applySectorType(runtime._state.sectorIndex);

    // Assign initial missions
    runtime._assignMissionsForCurrentSector();

    runtime._startReplayRecording(options);
    return runtime.getStateSnapshot();
}

/**
 * Start a Daily Challenge run using today's date in Germany as the seed.
 * All players on the same calendar day get the same sector sequence. (61.10.1)
 */
export function startArcadeDailyChallenge(runtime, options = {}) {
    const seed = options.date || !runtime._config.dailyChallenge
        ? computeDailySeed(options.date || null) : runtime._config.seed;
    return runtime.startRun({ ...options, dailyChallenge: true, seed });
}

export function beginNextArcadeSector(runtime) {
    if (!runtime._enabled || !runtime._state) return null;
    const phase = String(runtime._state.phase || '');
    if (phase !== ARCADE_RUN_PHASES.INTERMISSION && phase !== ARCADE_RUN_PHASES.WARMUP) {
        return runtime.getStateSnapshot();
    }
    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    const previousIntermission = runtime._state.intermission && typeof runtime._state.intermission === 'object'
        ? runtime._state.intermission
        : null;
    if (previousIntermission) {
        const selectedChoice = Array.isArray(previousIntermission.choices)
            ? previousIntermission.choices.find((entry) => entry.id === previousIntermission.selectedChoiceId) || null
            : null;
        const selectedRewardId = String(previousIntermission.selectedRewardId || '').trim() || null;
        const selectedChoiceId = selectedChoice?.id || null;
        if (selectedRewardId) {
            const rewardHistory = Array.isArray(runtime._state.rewardHistory) ? runtime._state.rewardHistory : [];
            rewardHistory.push({
                rewardId: selectedRewardId,
                selectedAtIso: new Date(nowMs).toISOString(),
                sectorIndex: Math.max(0, toSafeInt(runtime._state.completedSectors, 0)),
                nextSectorIndex: Math.max(1, toSafeInt(previousIntermission.nextSectorIndex, runtime._state.completedSectors + 1)),
            });
            runtime._state.rewardHistory = rewardHistory;
        }
        runtime._pendingIntermissionEffects = {
            selectedRewardId,
            selectedChoiceId,
            missionsCompleted: Math.max(0, toSafeInt(previousIntermission.missionsCompleted, 0)),
            missionsTotal: Math.max(0, toSafeInt(previousIntermission.missionsTotal, 0)),
            humanVitals: Array.isArray(runtime._pendingHumanVitals)
                ? runtime._pendingHumanVitals.map((entry) => ({ ...entry }))
                : [],
        };
        runtime._pendingHumanVitals = null;
    } else {
        runtime._pendingIntermissionEffects = null;
        runtime._pendingHumanVitals = null;
    }
    syncArcadeRunRewardEffects(runtime._state, runtime._strategy);
    runtime._state.intermission = null;

    // Resolve the next sector's authored map before the round/session restarts.
    const prevMapKey = runtime._state.currentMapKey;
    const nextSequenceIndex = Math.max(0, toSafeInt(runtime._state.completedSectors, 0));
    runtime._ensureEncounterSectorEntry(nextSequenceIndex + 1);
    const nextMapKey = getMapKeyForSector(runtime._state.mapSequence, nextSequenceIndex);
    runtime._state.currentMapKey = nextMapKey;

    runtime._state = beginArcadeSector(runtime._state, nowMs);
    runtime._sectorElapsedSeconds = 0;
    runtime._lastMissionTickSecond = 0;

    // 61.4.1: Resolve modifier for the new sector
    runtime._activeModifierId = runtime._resolveModifierForSector(runtime._state.sectorIndex);
    runtime._notifyModifierChanged(runtime._activeModifierId);

    // 82.1.1: Apply sector type (parcours vs arena)
    runtime._applySectorType(runtime._state.sectorIndex);

    // 61.6.2: Notify when Sudden Death phase is entered
    if (runtime._state.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH) {
        if (runtime._state.suddenDeathStartedAtMs == null) {
            runtime._state.suddenDeathStartedAtMs = runtime._state.gameplayTimeMs;
        }
        runtime._restoreSuddenDeath();
    }

    // Assign new missions for the sector
    runtime._assignMissionsForCurrentSector();

    if (runtime._onMapTransition) {
        try {
            const runtimeProfile = runtime.getSectorRuntimeProfile(runtime._state.sectorIndex, {
                fallbackBotCount: 0,
            });
            runtime._onMapTransition({
                ...runtimeProfile,
                fromMap: prevMapKey,
                toMap: nextMapKey,
                mapChanged: prevMapKey !== nextMapKey,
            });
        } catch (err) {
            runtime.logger?.warn?.('[ArcadeRunRuntime] Sector transition handler error:', err);
        }
    }

    return runtime.getStateSnapshot();
}

export function resetArcadeRunState(runtime, options = {}) {
    const preserveRecords = options?.preserveRecords === true;
    if (runtime._state && !runtime._state.finishedAtIso) runtime._finalizeRun(runtime.now());
    runtime.flushPersistenceSaves();
    runtime._ghostRecorder?.reset?.();
    const replayRecorder = runtime.replayRecorder;
    if (replayRecorder?.isRecording && typeof replayRecorder.stopRecording === 'function') {
        try {
            const stopResult = replayRecorder.stopRecording();
            if (isPromiseLike(stopResult)) {
                stopResult.catch(() => { /* no-op */ });
            }
        } catch {
            // no-op
        }
    }
    runtime._pendingIntermissionEffects = null;
    runtime._pendingHumanVitals = null;
    runtime._latestReplaySnapshot = null;
    runtime._activeModifierId = null;
    runtime._lastGhostPlaybackRouteId = '';
    runtime._missionState = null;
    runtime._sectorElapsedSeconds = 0;
    runtime._lastMissionTickSecond = 0;
    runtime._hudEvents = [];
    runtime._resetStrategyRuntimeState();
    runtime._state = null;
    runtime._rewardBinding = null;
    clearArcadePlayerProfileBindings(runtime);
    if (!preserveRecords) {
        runtime._records = runtime._readRecordsFromStorage();
    }
    return runtime.getStateSnapshot();
}
