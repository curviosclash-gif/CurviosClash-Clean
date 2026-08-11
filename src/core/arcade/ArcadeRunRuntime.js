import {
    ARCADE_RUN_PHASES,
    beginArcadeSector,
    cloneArcadeRunState,
    completeArcadeSector,
    createArcadeRunConfig,
    createArcadeRunRecords,
    createArcadeRunState,
} from '../../state/arcade/ArcadeRunState.js';
import {
    applyArcadeComboDecay,
    applyArcadeSectorScore,
    applyComboAction,
    buildArcadeRunSummary,
    mergeArcadeRunRecords,
} from '../../state/arcade/ArcadeScoreOps.js';
import {
    resolveMapSequence,
    getMapKeyForSector,
} from '../../state/arcade/ArcadeMapProgression.js';
import {
    calculateSectorXp,
    loadVehicleProfiles,
    getOrCreateProfile,
    addXp,
    getMasteryPerks,
    getSlotStatBonuses,
    XP_REWARD_TABLE,
} from '../../state/arcade/ArcadeVehicleProfile.js';
import {
    loadLeaderboard,
} from '../../state/arcade/ArcadeLeaderboard.js';
import {
    ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET,
    bootstrapGhostLibraryFromLeaderboard,
    getGhostLibraryDebugSnapshot,
    loadGhostLibrary,
} from '../../state/arcade/ArcadeGhostLibrary.js';
import { ArcadeGhostRecorder } from '../../state/arcade/ArcadeGhostRecorder.js';
import {
    updateSectorMissionState,
} from '../../state/arcade/ArcadeMissionState.js';
import {
    ARCADE_RUN_LEVELUP_REWARDS,
    ARCADE_SECTOR_MODIFIERS,
    resolveArcadeEndlessSectorDescriptor,
    resolveArcadeSectorRuntimeProfile,
} from '../../entities/directors/ArcadeEncounterCatalog.js';
import {
    getArcadeModifierRegistryDescriptor,
    resolveArcadeModifierMeta,
} from '../../shared/contracts/ArcadeModifierContract.js';
import {
    getArcadeRewardRegistryDescriptor,
    resolveArcadeRewardMeta,
} from '../../shared/contracts/ArcadeRewardContract.js';
import {
    getRuntimeMapCatalog,
    getRuntimeMapDefinition,
    listRuntimeMapPresetKeys,
    resolveRuntimeMapPresetLabel,
} from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { ArcadeRunPersistenceScheduler } from './ArcadeRunPersistenceScheduler.js';
import { applyArcadeIntermissionEffects, captureArcadeHumanVitals, syncArcadeRunRewardEffects } from './ArcadeIntermissionEffects.js';
import { applyArcadeMasteryScoreBonus, syncArcadeMasteryPerks } from './ArcadeMasteryPerkRuntimeOps.js';
import { assignArcadeSectorRuntimeState, updateArcadeObjectiveRuntimeState } from './ArcadeObjectiveRuntimeOps.js';
import { applyParcoursLeaderboardEvent } from './ArcadeParcoursLeaderboardOps.js';
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

const DEFAULT_GHOST_LIBRARY_SAVE_THROTTLE_MS = 250;
const DEFAULT_ARCADE_PERSISTENCE_SAVE_THROTTLE_MS = 250;
const ARCADE_RUN_ABORT_REASONS = new Set(['ABORT', 'ABORTED', 'MATCH_ABORT', 'QUIT', 'RUN_ABORT']);

import { toSafeNumber, computeDailySeed } from '../../shared/utils/ArcadeUtils.js';

function resolveLogger(logger) {
    if (logger && typeof logger.log === 'function') return logger;
    return console;
}

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clampIndex(index, maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
    const parsed = Number(index);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(maxExclusive - 1, Math.floor(parsed)));
}

function toSafeBudgetLimit(value, fallback = 0) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function formatMapLabel(mapKey) {
    const raw = String(mapKey || '').trim();
    if (!raw) return 'Unbekannte Map';
    const fromCatalog = resolveRuntimeMapPresetLabel(raw);
    if (typeof fromCatalog === 'string' && fromCatalog.trim().length > 0) {
        return fromCatalog.trim();
    }
    return raw.replace(/_/g, ' ');
}

function createModifierScoreBonusMap() {
    const map = new Map();
    for (let i = 0; i < ARCADE_SECTOR_MODIFIERS.length; i += 1) {
        const entry = ARCADE_SECTOR_MODIFIERS[i];
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim();
        if (!id) continue;
        map.set(id, Math.max(0, toSafeNumber(entry.scoreBonus, 0)));
    }
    return map;
}

const MODIFIER_SCORE_BONUS_BY_ID = createModifierScoreBonusMap();

export class ArcadeRunRuntime {
    constructor(options = {}) {
        this.settingsManager = options.settingsManager || null;
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
        this._missionState = null;
        this._hudEventSequence = 0;
        this._hudEvents = [];
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
        this.flushPersistenceSaves();
        const nextConfig = createArcadeRunConfig(runtimeConfig?.arcade || null);
        const store = this._resolveSettingsRecordStore();
        this._config = nextConfig;
        const ghostLibraryBudget = this._resolveGhostLibraryBudgetOptions(runtimeConfig?.arcade);
        this._enabled = nextConfig.enabled === true;
        this._records = this._readRecordsFromStorage();
        this._leaderboard = loadLeaderboard(store);
        this._ghostLibrary = loadGhostLibrary(store, ghostLibraryBudget, {
            onMigrationWrite: ({ telemetryDelta }) => this._mergeGhostLibraryTelemetryDelta(telemetryDelta),
        });
        const ghostLibraryBootstrap = bootstrapGhostLibraryFromLeaderboard(
            this._ghostLibrary,
            this._leaderboard,
            { budgetOptions: ghostLibraryBudget }
        );
        this._ghostLibrary = ghostLibraryBootstrap.ghostLibrary;
        this._mergeGhostLibraryTelemetryDelta(ghostLibraryBootstrap.telemetryDelta);
        if (ghostLibraryBootstrap.changed) {
            this._scheduleGhostLibrarySave(store, ghostLibraryBudget);
        }
        if (!this._enabled) {
            this.resetRunState({ preserveRecords: true });
        }
        return cloneArcadeRunState(this._state);
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
        const budgetSource = source && typeof source === 'object'
            ? source
            : this._config;
        return {
            maxRoutes: toSafeBudgetLimit(
                budgetSource?.ghostLibraryMaxRoutes,
                ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxRoutes
            ),
            maxFramesPerRoute: toSafeBudgetLimit(
                budgetSource?.ghostLibraryMaxFramesPerRoute,
                ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxFramesPerRoute
            ),
            maxBytes: toSafeBudgetLimit(
                budgetSource?.ghostLibraryMaxBytes,
                ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxBytes
            ),
        };
    }

    setStrategy(strategy) {
        this._strategy = strategy || null;
        if (!this._strategy) return;
        try { this._strategy.setActiveModifier?.(this._activeModifierId); } catch { /* no-op */ }
        try { this._strategy.setSectorType?.(this._currentSectorType); } catch { /* no-op */ }
        const profile = this.getVehicleProfile();
        try { this._strategy.applyVehicleUpgrades?.(getSlotStatBonuses(profile?.upgrades, profile?.hangarBonuses)); } catch { /* no-op */ }
        syncArcadeRunRewardEffects(this._state, this._strategy);
        if (this._state?.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH) {
            try { this._strategy.enterSuddenDeath?.(); } catch { /* no-op */ }
        }
    }

    _resetStrategyRuntimeState() {
        const strategy = this._strategy;
        if (!strategy || typeof strategy !== 'object') return;
        try { strategy.exitSuddenDeath?.(); } catch { /* no-op */ }
        try { strategy.setActiveModifier?.(null); } catch { /* no-op */ }
        try { strategy.setSectorType?.(null); } catch { /* no-op */ }
        try { strategy.applyVehicleUpgrades?.(null); } catch { /* no-op */ }
        syncArcadeRunRewardEffects(null, strategy);
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

    getVehicleProfile() {
        if (!this._vehicleProfiles || !this._activeVehicleId) return null;
        return getOrCreateProfile(this._vehicleProfiles, this._activeVehicleId);
    }

    // 82.1.1: Whether the current sector is a parcours time-trial sector
    isCurrentSectorParcours() {
        return this._currentSectorType === 'sector_parcours';
    }

    _resolveSectorType(sectorIndex) {
        const seq = this._state?.encounterSequence;
        if (!Array.isArray(seq) || sectorIndex < 1) return null;
        const entry = seq[sectorIndex - 1];
        if (!entry || typeof entry !== 'object') return null;
        return entry.parcoursEnabled === true ? 'sector_parcours' : null;
    }

    _applySectorType(sectorIndex) {
        const sectorType = this._resolveSectorType(sectorIndex);
        this._currentSectorType = sectorType;
        if (this._strategy && typeof this._strategy.setSectorType === 'function') {
            try { this._strategy.setSectorType(sectorType); } catch { /* no-op */ }
        }
    }

    // 61.4.1: Active modifier for the current sector
    getActiveModifierId() {
        return this._activeModifierId;
    }

    _resolveModifierForSector(sectorIndex) {
        const seq = this._state?.encounterSequence;
        if (!Array.isArray(seq) || sectorIndex < 1) return null;
        const entry = seq[sectorIndex - 1];
        return (entry && typeof entry.modifierId === 'string') ? entry.modifierId : null;
    }

    getMissionState() {
        return this._missionState ? { ...this._missionState } : null;
    }

    _getEncounterSectorEntry(sectorIndex) {
        const sequence = this._state?.encounterSequence;
        if (!Array.isArray(sequence) || sequence.length === 0) return null;
        const idx = Math.max(0, toSafeInt(sectorIndex, 1) - 1);
        const entry = sequence[idx];
        return entry && typeof entry === 'object' ? entry : null;
    }

    _ensureEncounterSectorEntry(sectorIndex) {
        const normalizedSectorIndex = Math.max(1, toSafeInt(sectorIndex, 1));
        const existing = this._getEncounterSectorEntry(normalizedSectorIndex);
        if (existing) return existing;
        if (!this._state) return null;

        const descriptor = resolveArcadeEndlessSectorDescriptor({
            seed: this._resolveActiveRunSeed(),
            sectorIndex: normalizedSectorIndex,
            difficulty: this._state?.encounterDifficulty || 'normal',
        });
        const encounterSequence = Array.isArray(this._state.encounterSequence)
            ? [...this._state.encounterSequence]
            : [];
        encounterSequence[normalizedSectorIndex - 1] = descriptor;
        this._state.encounterSequence = encounterSequence;

        const mapSequence = Array.isArray(this._state.mapSequence)
            ? [...this._state.mapSequence]
            : [];
        mapSequence[normalizedSectorIndex - 1] = descriptor.mapKey;
        this._state.mapSequence = mapSequence;
        return descriptor;
    }

    getSectorRuntimeProfile(sectorIndex = this._state?.sectorIndex || 1, options = {}) {
        const normalizedSectorIndex = Math.max(1, toSafeInt(sectorIndex, 1));
        const sequenceIndex = Math.max(0, normalizedSectorIndex - 1);
        const encounterEntry = this._ensureEncounterSectorEntry(normalizedSectorIndex);
        const mapKey = getMapKeyForSector(this._state?.mapSequence, sequenceIndex);
        return resolveArcadeSectorRuntimeProfile(encounterEntry, {
            sectorIndex: normalizedSectorIndex,
            mapKey,
            fallbackBotCount: options.fallbackBotCount,
            fallbackDifficulty: options.fallbackDifficulty,
        });
    }

    _resolveRewardChoicesForSector(sectorIndex) {
        const sectorEntry = this._getEncounterSectorEntry(sectorIndex);
        const rewardRegistryIds = getArcadeRewardRegistryDescriptor().entries
            .map((entry) => String(entry.id || '').trim())
            .filter(Boolean);
        const sourceChoices = Array.isArray(sectorEntry?.rewardChoices) && sectorEntry.rewardChoices.length > 0
            ? sectorEntry.rewardChoices
            : (rewardRegistryIds.length > 0
                ? rewardRegistryIds
                : ARCADE_RUN_LEVELUP_REWARDS.map((entry) => entry.id));
        const deduped = [];
        const used = new Set();
        for (let i = 0; i < sourceChoices.length; i += 1) {
            const rewardId = String(sourceChoices[i] || '').trim();
            if (!rewardId || used.has(rewardId)) continue;
            used.add(rewardId);
            const meta = resolveArcadeRewardMeta(rewardId);
            deduped.push({
                id: rewardId,
                label: meta?.label || rewardId,
                effectText: meta?.effectText || '',
            });
            if (deduped.length >= 3) break;
        }
        if (deduped.length > 0) return deduped;

        const fallback = getArcadeRewardRegistryDescriptor().entries[0] || ARCADE_RUN_LEVELUP_REWARDS[0];
        const fallbackId = String(fallback?.id || 'run_speed_t1');
        const fallbackMeta = resolveArcadeRewardMeta(fallbackId);
        return [{
            id: fallbackId,
            label: fallbackMeta?.label || fallbackId,
            effectText: fallbackMeta?.effectText || '',
        }];
    }

    _buildIntermissionChoices(nextSectorIndex) {
        const sequence = Array.isArray(this._state?.mapSequence) ? this._state.mapSequence : [];
        const targetIndex = Math.max(0, toSafeInt(nextSectorIndex, 1) - 1);
        const baseMapKey = getMapKeyForSector(sequence, targetIndex);
        const encounterEntry = this._getEncounterSectorEntry(nextSectorIndex);
        const baseModifierId = String(encounterEntry?.modifierId || this._activeModifierId || '').trim();

        const runtimeMapCatalog = getRuntimeMapCatalog();
        const mapCatalogKeys = listRuntimeMapPresetKeys(runtimeMapCatalog);
        const choices = [];
        const pushChoice = (mapKey, modifierId, source) => {
            const normalizedMapKey = String(mapKey || '').trim();
            if (!normalizedMapKey) return;
            const normalizedModifierId = String(modifierId || '').trim();
            const id = `${source}-${normalizedMapKey}-${normalizedModifierId || 'none'}`;
            if (choices.some((entry) => entry.id === id)) return;
            const modifierMeta = resolveArcadeModifierMeta(normalizedModifierId);
            choices.push({
                id,
                mapKey: normalizedMapKey,
                mapLabel: formatMapLabel(normalizedMapKey),
                modifierId: normalizedModifierId || null,
                modifierLabel: modifierMeta?.label || (normalizedModifierId || 'Kein Modifier'),
                modifierEffect: modifierMeta?.effectText || '',
                source,
                objectiveLabel: String(encounterEntry?.objectiveId || '').replace(/_/g, ' '),
                squadLabel: String(encounterEntry?.squadId || '').replace(/_/g, ' '),
            });
        };

        pushChoice(baseMapKey, baseModifierId, 'plan');

        const nextSectorIsParcours = encounterEntry?.parcoursEnabled === true;
        const candidateMaps = mapCatalogKeys.filter((mapKey) => {
            if (mapKey === baseMapKey) return false;
            const definition = getRuntimeMapDefinition(mapKey, runtimeMapCatalog);
            const mapIsParcours = definition?.parcours?.enabled === true;
            return mapIsParcours === nextSectorIsParcours;
        });
        const modifierIds = getArcadeModifierRegistryDescriptor().entries
            .map((entry) => String(entry.id || '').trim())
            .filter(Boolean);
        const altTargetCount = candidateMaps.length > 0 ? 3 : 1;
        for (let i = 0; i < altTargetCount && choices.length < 3; i += 1) {
            const mapIdx = (targetIndex + i) % Math.max(1, candidateMaps.length);
            const modifierIdx = (targetIndex + i + 1) % Math.max(1, modifierIds.length);
            const mapKey = candidateMaps[mapIdx] || baseMapKey;
            const modifierId = modifierIds[modifierIdx] || baseModifierId;
            pushChoice(mapKey, modifierId, 'alt');
        }

        return choices.slice(0, 3);
    }

    _prepareIntermission(nowMs = Date.now()) {
        if (!this._state) return null;
        const nextSectorIndex = Math.max(1, toSafeInt(this._state.completedSectors, 0) + 1);
        const choices = this._buildIntermissionChoices(nextSectorIndex);
        const rewards = this._resolveRewardChoicesForSector(nextSectorIndex);
        const selectedChoiceId = choices[0]?.id || null;
        const selectedRewardId = rewards[0]?.id || null;
        const selectedChoice = choices.find((entry) => entry.id === selectedChoiceId) || null;
        const selectedReward = rewards.find((entry) => entry.id === selectedRewardId) || null;

        const lastSectorSummary = this._state.lastSectorSummary || null;
        const missionsCompleted = Math.max(0, toSafeInt(this._missionState?.completedCount, 0));
        const missionsTotal = Math.max(0, toSafeInt(this._missionState?.missions?.length, 0));
        const nextSectorEntry = this._getEncounterSectorEntry(nextSectorIndex);
        const intermissionState = {
            generatedAtMs: Math.max(0, toSafeNumber(nowMs, Date.now())),
            nextSectorIndex,
            selectedChoiceId,
            selectedRewardId,
            choices,
            rewardChoices: rewards,
            missionsCompleted,
            missionsTotal,
            lastSectorPoints: Math.max(0, toSafeNumber(lastSectorSummary?.awardedPoints, 0)),
            lastSectorMultiplier: Math.max(1, toSafeNumber(lastSectorSummary?.multiplierApplied, 1)),
            lastSectorXp: Math.max(0, toSafeNumber(this._state?.lastSectorXp?.earned, 0)),
            nextSectorPreview: {
                templateId: String(nextSectorEntry?.templateId || ''),
                objectiveId: String(nextSectorEntry?.objectiveId || ''),
                squadId: String(nextSectorEntry?.squadId || ''),
                mapKey: String(selectedChoice?.mapKey || ''),
                mapLabel: String(selectedChoice?.mapLabel || ''),
                modifierId: String(selectedChoice?.modifierId || ''),
                modifierLabel: String(selectedChoice?.modifierLabel || ''),
                modifierEffect: String(selectedChoice?.modifierEffect || ''),
            },
            selectedRewardLabel: String(selectedReward?.label || ''),
            selectedRewardEffect: String(selectedReward?.effectText || ''),
        };
        this._state.intermission = intermissionState;
        return intermissionState;
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

    getReplayState() {
        const replay = this._state?.replay && typeof this._state.replay === 'object'
            ? this._state.replay
            : {};
        const runReplayId = typeof replay.runReplayId === 'string' ? replay.runReplayId : '';
        const playbackEnabled = replay.playbackEnabled !== false;
        const snapshot = this._latestReplaySnapshot;
        const payloadAvailable = !!snapshot
            && typeof snapshot === 'object'
            && (
                (Array.isArray(snapshot.actions) && snapshot.actions.length >= 0)
                || (snapshot.initialState && typeof snapshot.initialState === 'object')
            );
        return {
            runReplayId,
            playbackEnabled,
            payloadAvailable,
            playbackAvailable: playbackEnabled && payloadAvailable,
            fallbackMode: playbackEnabled ? 'json_export_if_no_player' : 'disabled',
        };
    }

    getMenuSurfaceState() {
        return {
            phase: String(this._state?.phase || ''),
            isDailyChallenge: this._state?.isDailyChallenge === true,
            records: this.getRecordsSnapshot(),
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
        if (!this._state?.intermission) return null;
        const intermission = this._state.intermission;
        const choices = Array.isArray(intermission.choices) ? intermission.choices : [];
        if (choices.length === 0) return this.getIntermissionState();

        const selectedChoice = typeof choiceIdOrIndex === 'number'
            ? choices[clampIndex(choiceIdOrIndex, choices.length)]
            : choices.find((entry) => entry.id === String(choiceIdOrIndex || '').trim());
        if (!selectedChoice) return this.getIntermissionState();

        intermission.selectedChoiceId = selectedChoice.id;
        intermission.nextSectorPreview = {
            ...(intermission.nextSectorPreview && typeof intermission.nextSectorPreview === 'object'
                ? intermission.nextSectorPreview
                : {}),
            mapKey: selectedChoice.mapKey,
            mapLabel: selectedChoice.mapLabel,
            modifierId: selectedChoice.modifierId || null,
            modifierLabel: selectedChoice.modifierLabel || 'Kein Modifier',
            modifierEffect: selectedChoice.modifierEffect || '',
        };
        const nextSectorIndex = Math.max(1, toSafeInt(intermission.nextSectorIndex, this._state.completedSectors + 1));
        const seqIndex = Math.max(0, nextSectorIndex - 1);

        if (Array.isArray(this._state.mapSequence) && seqIndex < this._state.mapSequence.length) {
            this._state.mapSequence[seqIndex] = selectedChoice.mapKey;
        }
        if (Array.isArray(this._state.encounterSequence) && seqIndex < this._state.encounterSequence.length) {
            const currentEntry = this._state.encounterSequence[seqIndex];
            if (currentEntry && typeof currentEntry === 'object') {
                const modifierId = selectedChoice.modifierId || null;
                this._state.encounterSequence[seqIndex] = {
                    ...currentEntry,
                    modifierId,
                    scoreBonus: modifierId ? (MODIFIER_SCORE_BONUS_BY_ID.get(modifierId) || 0) : 0,
                };
            }
        }
        return this.getIntermissionState();
    }

    selectReward(rewardId) {
        if (!this._state?.intermission) return null;
        const intermission = this._state.intermission;
        const rewards = Array.isArray(intermission.rewardChoices) ? intermission.rewardChoices : [];
        const selectedReward = rewards.find((entry) => entry.id === String(rewardId || '').trim()) || null;
        if (!selectedReward) return this.getIntermissionState();

        intermission.selectedRewardId = selectedReward.id;
        intermission.selectedRewardLabel = selectedReward.label || selectedReward.id;
        intermission.selectedRewardEffect = selectedReward.effectText || '';
        return this.getIntermissionState();
    }

    applyPendingIntermissionEffects({ players = null } = {}) {
        if (!this._pendingIntermissionEffects) return null;
        const context = this._pendingIntermissionEffects;
        const result = applyArcadeIntermissionEffects({
            players,
            strategy: this._strategy,
            context,
            state: this._state,
            nowMs: this.now(),
        });
        this._pendingIntermissionEffects = null;
        return result;
    }

    requestReplayPlayback() {
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

    getHudState() {
        if (!this._enabled || !this._state) return null;
        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const score = this._state.score && typeof this._state.score === 'object'
            ? this._state.score
            : {};
        const breakdown = score.breakdown && typeof score.breakdown === 'object'
            ? score.breakdown
            : {};
        const parcoursXpGain = this._peekHudEvent('parcours_xp') || this._state.lastParcoursXpGain || null;
        const parcoursSegmentSplit = this._peekHudEvent('parcours_split') || this._state.lastParcoursSegmentSplit || null;
        const parcoursPenalty = this._peekHudEvent('parcours_penalty') || this._state.lastParcoursPenalty || null;
        // 82.8.3: Vehicle stats for sector-start HUD flash
        const profile = this.getVehicleProfile();
        const profileBonuses = profile ? getSlotStatBonuses(profile.upgrades, profile.hangarBonuses) : null;
        const vehicleStats = {
            level: profile?.level ?? 1,
            speedBonusPct: Math.min(50, profileBonuses?.speedBonusPct || 0),
            turningBonusPct: Math.min(50, profileBonuses?.turningBonusPct || 0),
            maxHpBonus: Math.min(50, profileBonuses?.maxHpBonus || 0),
        };
        return {
            nowMs,
            parcoursXpGain,
            parcoursSegmentSplit,
            parcoursPenalty,
            events: this._hudEvents,
            vehicleStats,
            phase: String(this._state.phase || ''),
            sectorIndex: Math.max(0, Math.floor(toSafeNumber(this._state.sectorIndex, 0))),
            completedSectors: Math.max(0, Math.floor(toSafeNumber(this._state.completedSectors, 0))),
            currentMapKey: String(this._state.currentMapKey || ''),
            activeModifierId: this._activeModifierId,
            missionState: this._missionState,
            objectiveState: this._state.objectiveState || null,
            comboWindowMs: Math.max(800, toSafeInt(this._state?.config?.comboWindowMs, 5000)),
            comboFreezeUntilMs: Math.max(0, toSafeNumber(this._state?.comboFreezeUntilMs, 0)),
            suddenDeathElapsedMs: this._state.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH
                ? Math.max(0, nowMs - Math.max(0, toSafeNumber(this._state?.suddenDeathStartedAtMs, nowMs)))
                : 0,
            score: {
                total: Math.max(0, toSafeNumber(score.total, 0)),
                combo: Math.max(0, Math.floor(toSafeNumber(score.combo, 0))),
                multiplier: Math.max(1, toSafeNumber(score.multiplier, 1)),
                lastComboAtMs: Math.max(0, toSafeNumber(score.lastComboAtMs, 0)),
                breakdown: {
                    base: Math.max(0, toSafeNumber(breakdown.base, 0)),
                    survival: Math.max(0, toSafeNumber(breakdown.survival, 0)),
                    kills: Math.max(0, toSafeNumber(breakdown.kills, 0)),
                    cleanSector: Math.max(0, toSafeNumber(breakdown.cleanSector, 0)),
                    risk: Math.max(0, toSafeNumber(breakdown.risk, 0)),
                    penalty: Math.max(0, toSafeNumber(breakdown.penalty, 0)),
                    total: Math.max(0, toSafeNumber(breakdown.total, 0)),
                },
            },
        };
    }

    updateMissions(event) {
        if (!this._missionState) return;
        this._missionState = updateSectorMissionState(this._missionState, event);
        if (this._state) {
            this._state.missions = this._missionState;
        }
    }

    _applyComboDecayAt(nowMs) {
        if (!this._state?.score) return;
        const frozenUntil = Math.max(0, toSafeNumber(this._state.comboFreezeUntilMs, 0));
        if (nowMs <= frozenUntil) return;
        const decayedScore = applyArcadeComboDecay(this._state.score, this._state.config, nowMs, this._state.masteryPerks);
        if (decayedScore !== this._state.score) {
            this._state = { ...this._state, score: decayedScore };
        }
    }

    tickGameplay(dt = 0) {
        if (!this._enabled || !this._state) return null;
        const phase = String(this._state.phase || '');
        if (phase !== ARCADE_RUN_PHASES.SECTOR_ACTIVE && phase !== ARCADE_RUN_PHASES.SUDDEN_DEATH) {
            return null;
        }
        this._sectorElapsedSeconds += Math.max(0, toSafeNumber(dt, 0));
        const elapsedSecond = Math.floor(this._sectorElapsedSeconds);
        if (elapsedSecond <= this._lastMissionTickSecond) return null;
        this._lastMissionTickSecond = elapsedSecond;
        return this.applyGameplayEvent({ type: 'tick', elapsed: this._sectorElapsedSeconds });
    }

    /**
     * Apply a mission event and, for action events, increment the combo.
     * 61.2.1 + 61.2.3 + 61.3.5
     */
    applyGameplayEvent(event) {
        if (!this._enabled || !this._state) return null;
        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const eventWithTime = { ...event, nowMs };

        this._applyComboDecayAt(nowMs);

        // Update missions first so allCompleted flag reflects current action
        updateArcadeObjectiveRuntimeState(this, eventWithTime);
        const wasAllCompleted = this._missionState?.allCompleted === true;
        this.updateMissions(eventWithTime);

        // 61.2.3: Freeze combo 3s on mission-all-complete (first time only)
        // 61.3.5: Also award score boost when all sector missions completed
        const justCompleted = !wasAllCompleted && this._missionState?.allCompleted === true;
        if (justCompleted && this._state.score) {
            const MISSION_ALL_COMPLETE_BONUS = 500;
            const multiplier = Math.max(1, toSafeNumber(this._state.score?.multiplier, 1));
            const bonus = applyArcadeMasteryScoreBonus(
                MISSION_ALL_COMPLETE_BONUS * multiplier,
                this._state.masteryPerks
            );
            this._state = {
                ...this._state,
                comboFreezeUntilMs: nowMs + 3000,
                score: {
                    ...this._state.score,
                    total: Math.max(0, toSafeNumber(this._state.score.total, 0) + bonus),
                    lastMissionBonus: bonus,
                    lastComboAtMs: Math.max(toSafeNumber(this._state.score.lastComboAtMs, 0), nowMs),
                },
            };
        }

        // Combo freeze protects against decay; scoring actions still extend the chain.
        const newScore = applyComboAction(this._state.score, eventWithTime, this._state.config);
        if (newScore !== this._state.score) {
            this._state = { ...this._state, score: newScore };
        }

        return this.getStateSnapshot();
    }

    startRun(options = {}) {
        if (!this._enabled) return null;
        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const runId = this._nextRunId(nowMs);
        this._pendingIntermissionEffects = null;
        this._pendingHumanVitals = null;
        this._latestReplaySnapshot = null;
        this._strategy = options.strategy || this._strategy || null;
        this._resetStrategyRuntimeState();
        // 61.10.1: Allow options.seed to override config seed (e.g., for daily challenge)
        const runConfig = options.seed != null
            ? { ...this._config, seed: toSafeNumber(options.seed, this._config.seed) }
            : this._config;
        const activeRunSeed = this._resolveActiveRunSeed(runConfig);
        this._state = createArcadeRunState({
            config: runConfig,
            records: this._records,
            nowMs,
            runId,
        });
        if (options.dailyChallenge || runConfig.dailyChallenge === true) {
            this._state.isDailyChallenge = true;
        }
        this._state.intermission = null;
        this._hudEvents = [];
        this._state.sectorHistory = [];
        this._state.rewardHistory = [];
        this._state.postRunSummary = null;
        this._state.lastIntermissionHeal = null;
        this._state.suddenDeathStartedAtMs = 0;
        this._state.replay = {
            ...(this._state.replay && typeof this._state.replay === 'object' ? this._state.replay : {}),
            playbackEnabled: runConfig.replayHooksEnabled === true,
            payloadAvailable: false,
        };

        // Load vehicle profiles and notify slot bonuses
        const store = this._resolveSettingsRecordStore();
        this._vehicleProfiles = loadVehicleProfiles(store);
        const activeProfile = this.getVehicleProfile();
        syncArcadeMasteryPerks(this._state, activeProfile);
        this._notifyVehicleUpgradesChanged(getSlotStatBonuses(activeProfile?.upgrades, activeProfile?.hangarBonuses));

        // Resolve map sequence from encounter plan if available
        if (options.encounterPlan) {
            const runtimeMapCatalog = getRuntimeMapCatalog();
            const mapSequence = resolveMapSequence(options.encounterPlan, activeRunSeed, runtimeMapCatalog);
            this._state.mapSequence = mapSequence;
            if (mapSequence.length > 0) {
                this._state.currentMapKey = mapSequence[0];
            }
            // Store encounter sequence for dynamic sector scoring (V61.1)
            if (Array.isArray(options.encounterPlan.sequence)) {
                this._state.encounterSequence = options.encounterPlan.sequence;
            }
            this._state.encounterDifficulty = String(options.encounterPlan.difficulty || 'normal');
        }
        if (!this._state.currentMapKey) {
            this._state.currentMapKey = getMapKeyForSector(this._state.mapSequence, 0);
        }

        this._state = beginArcadeSector(this._state, nowMs);
        this._sectorElapsedSeconds = 0;
        this._lastMissionTickSecond = 0;

        // 61.4.1: Resolve modifier for the first sector
        this._activeModifierId = this._resolveModifierForSector(this._state.sectorIndex);
        this._notifyModifierChanged(this._activeModifierId);

        // 82.1.1: Apply sector type (parcours vs arena)
        this._applySectorType(this._state.sectorIndex);

        // Assign initial missions
        this._assignMissionsForCurrentSector();

        this._startReplayRecording(options);
        return this.getStateSnapshot();
    }

    /**
     * Start a Daily Challenge run using today's UTC date as the seed.
     * All players on the same calendar day get the same sector sequence. (61.10.1)
     */
    startDailyChallenge(options = {}) {
        const seed = computeDailySeed(options.date || null);
        return this.startRun({ ...options, dailyChallenge: true, seed });
    }

    beginNextSector() {
        if (!this._enabled || !this._state) return null;
        const phase = String(this._state.phase || '');
        if (phase !== ARCADE_RUN_PHASES.INTERMISSION && phase !== ARCADE_RUN_PHASES.WARMUP) {
            return this.getStateSnapshot();
        }
        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const previousIntermission = this._state.intermission && typeof this._state.intermission === 'object'
            ? this._state.intermission
            : null;
        if (previousIntermission) {
            const selectedChoice = Array.isArray(previousIntermission.choices)
                ? previousIntermission.choices.find((entry) => entry.id === previousIntermission.selectedChoiceId) || null
                : null;
            const selectedRewardId = String(previousIntermission.selectedRewardId || '').trim() || null;
            const selectedChoiceId = selectedChoice?.id || null;
            if (selectedRewardId) {
                const rewardHistory = Array.isArray(this._state.rewardHistory) ? this._state.rewardHistory : [];
                rewardHistory.push({
                    rewardId: selectedRewardId,
                    selectedAtIso: new Date(nowMs).toISOString(),
                    sectorIndex: Math.max(0, toSafeInt(this._state.completedSectors, 0)),
                    nextSectorIndex: Math.max(1, toSafeInt(previousIntermission.nextSectorIndex, this._state.completedSectors + 1)),
                });
                this._state.rewardHistory = rewardHistory;
            }
            this._pendingIntermissionEffects = {
                selectedRewardId,
                selectedChoiceId,
                missionsCompleted: Math.max(0, toSafeInt(previousIntermission.missionsCompleted, 0)),
                missionsTotal: Math.max(0, toSafeInt(previousIntermission.missionsTotal, 0)),
                humanVitals: Array.isArray(this._pendingHumanVitals)
                    ? this._pendingHumanVitals.map((entry) => ({ ...entry }))
                    : [],
            };
            this._pendingHumanVitals = null;
        } else {
            this._pendingIntermissionEffects = null;
            this._pendingHumanVitals = null;
        }
        syncArcadeRunRewardEffects(this._state, this._strategy);
        this._state.intermission = null;

        // Resolve the next sector's authored map before the round/session restarts.
        const prevMapKey = this._state.currentMapKey;
        const nextSequenceIndex = Math.max(0, toSafeInt(this._state.completedSectors, 0));
        this._ensureEncounterSectorEntry(nextSequenceIndex + 1);
        const nextMapKey = getMapKeyForSector(this._state.mapSequence, nextSequenceIndex);
        this._state.currentMapKey = nextMapKey;

        this._state = beginArcadeSector(this._state, nowMs);
        this._sectorElapsedSeconds = 0;
        this._lastMissionTickSecond = 0;

        // 61.4.1: Resolve modifier for the new sector
        this._activeModifierId = this._resolveModifierForSector(this._state.sectorIndex);
        this._notifyModifierChanged(this._activeModifierId);

        // 82.1.1: Apply sector type (parcours vs arena)
        this._applySectorType(this._state.sectorIndex);

        // 61.6.2: Notify when Sudden Death phase is entered
        if (this._state.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH) {
            if (!this._state.suddenDeathStartedAtMs || this._state.suddenDeathStartedAtMs <= 0) {
                this._state.suddenDeathStartedAtMs = nowMs;
            }
            this._notifySuddenDeathEntered();
        }

        // Assign new missions for the sector
        this._assignMissionsForCurrentSector();

        if (this._onMapTransition) {
            try {
                const runtimeProfile = this.getSectorRuntimeProfile(this._state.sectorIndex, {
                    fallbackBotCount: 0,
                    fallbackDifficulty: 'NORMAL',
                });
                this._onMapTransition({
                    ...runtimeProfile,
                    fromMap: prevMapKey,
                    toMap: nextMapKey,
                    mapChanged: prevMapKey !== nextMapKey,
                });
            } catch (err) {
                this.logger?.warn?.('[ArcadeRunRuntime] Sector transition handler error:', err);
            }
        }

        return this.getStateSnapshot();
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
        if (!this._enabled || !this._state) return null;
        if (!this.isCurrentSectorParcours()) return null;

        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const completionMs = Math.max(0, toSafeNumber(parcoursResult?.parcours?.completionTimeMs, 0));
        this.applyGameplayEvent({
            type: 'sector_complete',
            elapsed: completionMs > 0 ? completionMs / 1000 : this._sectorElapsedSeconds,
        });
        this._state = completeArcadeSector(this._state, nowMs);
        // Parcours completion: human player always continues (not finished by death)
        this._prepareIntermission(nowMs);

        const scoreTotal = Math.max(0, toSafeNumber(this._state?.score?.total, 0));
        const sectorLabel = `${this._state.completedSectors}/${this._state.config.sectorCount}`;
        const completionSec = completionMs > 0 ? (completionMs / 1000).toFixed(2) : '?';
        const requiredWins = Math.max(1, Number(options?.winsNeeded) || 1);
        const messageText = `Parcours abgeschlossen — ${completionSec}s | Sektor ${sectorLabel}`;
        const messageSub = 'Intermission: naechster Sektor';

        return {
            outcome: {
                state: 'ROUND_END',
                canWinMatch: true,
                requiredWins,
                matchWinner: null,
                reason: 'PARCOURS_COMPLETE',
                parcours: parcoursResult?.parcours || null,
                messageText,
                messageSub,
                arcade: {
                    phase: this._state.phase,
                    sectorIndex: this._state.sectorIndex,
                    completedSectors: this._state.completedSectors,
                    score: scoreTotal,
                    intermission: this.getIntermissionState(),
                    parcours: parcoursResult?.parcours || null,
                },
            },
            transition: {
                roundPause: Number(this._config.intermissionSeconds) || 10,
                nextState: 'ROUND_END',
                overlayMessageText: messageText,
                overlayMessageSub: messageSub,
            },
        };
    }

    deriveRoundEndPlan({ players, inputs = {}, baseController } = {}) {
        if (!this._enabled || !this._state || !baseController) {
            return baseController?.deriveOnRoundEndPlan?.(players, inputs) || null;
        }

        this._pendingHumanVitals = captureArcadeHumanVitals(players);

        const outcomeReason = String(inputs?.reason || '').trim().toUpperCase();
        const parcoursInput = inputs?.parcours && typeof inputs.parcours === 'object'
            ? inputs.parcours
            : null;
        const roster = Array.isArray(players) ? players : [];
        const humans = roster.filter((entry) => entry && entry.isBot !== true);
        const hasAliveHuman = humans.some((entry) => entry.alive !== false && toSafeNumber(entry.hp, 1) > 0);
        const allHumansDead = humans.length > 0
            ? !hasAliveHuman
            : outcomeReason !== 'PARCOURS_COMPLETE';
        const terminalReason = allHumansDead
            ? 'ELIMINATION'
            : (ARCADE_RUN_ABORT_REASONS.has(outcomeReason) ? outcomeReason : '');

        if (!terminalReason && outcomeReason === 'PARCOURS_COMPLETE') {
            const parcoursPlan = this.completeParcoursSector(
                {
                    reason: outcomeReason,
                    parcours: parcoursInput,
                },
                {
                    winsNeeded: inputs?.winsNeeded,
                }
            );
            if (parcoursPlan) {
                return parcoursPlan;
            }
        }

        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const finished = terminalReason.length > 0;
        if (finished) {
            this._pendingHumanVitals = null;
            this._state.phase = ARCADE_RUN_PHASES.FINISHED;
            this._state.intermission = null;
        } else {
            this.applyGameplayEvent({ type: 'sector_complete', elapsed: this._sectorElapsedSeconds });
            this._state = completeArcadeSector(this._state, nowMs);
            this._prepareIntermission(nowMs);
        }
        const scoreTotal = Math.max(0, toSafeNumber(this._state?.score?.total, 0));
        const combo = Math.max(0, Math.floor(toSafeNumber(this._state?.score?.combo, 0)));
        const multiplier = Math.max(1, toSafeNumber(this._state?.score?.multiplier, 1));
        const sectorLabel = `${this._state.completedSectors}/${this._state.config.sectorCount}`;
        const messageText = finished
            ? `Arcade Run beendet - Score ${Math.round(scoreTotal)}`
            : `Sektor ${sectorLabel} abgeschlossen`;
        const messageSub = finished
            ? 'ENTER fuer neuen Run oder ESC fuer Menue'
            : `Intermission: Combo ${combo} / x${multiplier}`;

        return {
            outcome: {
                state: finished ? 'MATCH_END' : 'ROUND_END',
                canWinMatch: true,
                requiredWins: Math.max(1, Number(inputs?.winsNeeded) || 1),
                matchWinner: null,
                reason: terminalReason || outcomeReason,
                parcours: parcoursInput,
                messageText,
                messageSub,
                arcade: {
                    phase: this._state.phase,
                    sectorIndex: this._state.sectorIndex,
                    completedSectors: this._state.completedSectors,
                    score: scoreTotal,
                    intermission: finished ? null : this.getIntermissionState(),
                },
            },
            transition: {
                roundPause: Number(this._config.intermissionSeconds) || 10,
                nextState: finished ? 'MATCH_END' : 'ROUND_END',
                overlayMessageText: messageText,
                overlayMessageSub: messageSub,
            },
        };
    }

    handleRoundEndTelemetry(payload = null) {
        if (!this._enabled || !this._state || !payload || typeof payload !== 'object') {
            return this.getStateSnapshot();
        }

        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        this._state = applyArcadeSectorScore(this._state, payload, { nowMs, masteryPerks: this._state.masteryPerks });
        this._applySectorXpReward(payload);
        this._recordSectorHistoryEntry(payload, nowMs);

        const payloadState = String(payload.state || '').trim().toUpperCase();
        if (payloadState === 'MATCH_END' || this._state.phase === ARCADE_RUN_PHASES.FINISHED) {
            this._finalizeRun(nowMs);
        }
        return this.getStateSnapshot();
    }

    handleMatchEndTelemetry(payload = null) {
        if (!this._enabled || !this._state || !payload || typeof payload !== 'object') {
            return this.getStateSnapshot();
        }

        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));
        const payloadState = String(payload.state || '').trim().toUpperCase();
        if (payloadState === 'MATCH_END' || this._state.phase === ARCADE_RUN_PHASES.FINISHED) {
            this._finalizeRun(nowMs);
        }
        return this.getStateSnapshot();
    }

    _recordSectorHistoryEntry(payload, nowMs = Date.now()) {
        if (!this._state) return;
        const lastSectorSummary = this._state.lastSectorSummary;
        const sectorIndex = Math.max(0, toSafeInt(lastSectorSummary?.sectorIndex, 0));
        if (sectorIndex <= 0) return;
        const existing = Array.isArray(this._state.sectorHistory) ? this._state.sectorHistory : [];
        if (existing.some((entry) => toSafeInt(entry?.sectorIndex, -1) === sectorIndex)) return;

        const encounterEntry = this._getEncounterSectorEntry(sectorIndex);
        const missionsCompleted = Math.max(0, toSafeInt(this._missionState?.completedCount, 0));
        const missionsTotal = Math.max(0, toSafeInt(this._missionState?.missions?.length, 0));
        const breakdown = lastSectorSummary?.breakdown && typeof lastSectorSummary.breakdown === 'object'
            ? { ...lastSectorSummary.breakdown }
            : {};
        existing.push({
            sectorIndex,
            endedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),
            phase: String(lastSectorSummary?.sectorPhase || ''),
            wasSuddenDeath: lastSectorSummary?.wasSuddenDeath === true,
            mapKey: getMapKeyForSector(this._state.mapSequence, Math.max(0, sectorIndex - 1)),
            templateId: String(encounterEntry?.templateId || ''),
            encounterId: String(lastSectorSummary?.encounterId || encounterEntry?.encounterId || encounterEntry?.id || ''),
            objectiveId: String(encounterEntry?.objectiveId || ''),
            squadId: String(encounterEntry?.squadId || ''),
            modifierId: String(lastSectorSummary?.modifierId || encounterEntry?.modifierId || this._activeModifierId || ''),
            scoreBonus: Math.max(0, toSafeNumber(encounterEntry?.scoreBonus, 0)),
            awardedPoints: Math.max(0, toSafeNumber(lastSectorSummary?.awardedPoints, 0)),
            multiplierApplied: Math.max(1, toSafeNumber(lastSectorSummary?.multiplierApplied, 1)),
            comboAtSectorEnd: Math.max(0, toSafeInt(lastSectorSummary?.comboAtSectorEnd, 0)),
            missionsCompleted,
            missionsTotal,
            kills: Math.max(0, toSafeInt(payload?.kills, 0)),
            duration: Math.max(0, toSafeNumber(payload?.duration, 0)),
            selfCollisions: Math.max(0, toSafeInt(payload?.selfCollisions, 0)),
            itemUses: Math.max(0, toSafeInt(payload?.itemUses, 0)),
            stuckEvents: Math.max(0, toSafeInt(payload?.stuckEvents, 0)),
            breakdown,
            xpEarned: Math.max(0, toSafeNumber(this._state?.lastSectorXp?.earned, 0)),
        });
        this._state.sectorHistory = existing;
    }

    applyParcoursXpEvent(eventType, playerIndex = 0) {
        if (!this._enabled || !this._activeVehicleId || !this._vehicleProfiles) return null;
        const xpByEvent = {
            checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
            finish: XP_REWARD_TABLE.parcoursFinish,
            new_best_time: XP_REWARD_TABLE.parcoursNewBestTime,
        };
        const baseXp = xpByEvent[String(eventType)] || 0;
        if (baseXp <= 0) return null;

        let profile = getOrCreateProfile(this._vehicleProfiles, this._activeVehicleId);
        const perks = getMasteryPerks(profile.level);
        const xpEarned = Math.max(1, Math.round(baseXp * (1 + perks.xpBonusPct / 100)));

        const result = addXp(profile, xpEarned);
        this._vehicleProfiles[this._activeVehicleId] = result.profile;
        syncArcadeMasteryPerks(this._state, result.profile);
        this._scheduleVehicleProfilesSave();

        if (this._state) {
            this._state.lastParcoursXpGain = this._enqueueHudEvent('parcours_xp', {
                eventType: String(eventType),
                earned: xpEarned,
                leveledUp: result.leveledUp,
                newLevel: result.newLevel,
            });
        }
        return { earned: xpEarned, leveledUp: result.leveledUp, newLevel: result.newLevel };
    }

    applyParcoursLeaderboardEvent(data) {
        return applyParcoursLeaderboardEvent(this, data);
    }

    _applySectorXpReward(telemetryPayload) {
        if (!this._activeVehicleId || !this._vehicleProfiles) return;

        const missionsCompleted = this._missionState?.completedCount || 0;
        const totalMissions = this._missionState?.missions?.length || 0;
        const telemetry = {
            kills: toSafeNumber(telemetryPayload?.kills, 0),
            multiplier: toSafeNumber(this._state?.score?.multiplier, 1),
            missionsCompleted,
            totalMissions,
            cleanSector: Math.max(0, toSafeNumber(telemetryPayload?.selfCollisions, 0)) === 0,
        };

        let profile = getOrCreateProfile(this._vehicleProfiles, this._activeVehicleId);
        // 61.8.2: Apply mastery XP perk before awarding XP
        const perks = getMasteryPerks(profile.level);
        const baseXp = calculateSectorXp(telemetry);
        const xpEarned = baseXp <= 0 ? 0 : Math.round(baseXp * (1 + perks.xpBonusPct / 100));
        if (xpEarned <= 0) return;

        const result = addXp(profile, xpEarned);
        profile = result.profile;
        this._vehicleProfiles[this._activeVehicleId] = profile;
        syncArcadeMasteryPerks(this._state, profile);
        this._scheduleVehicleProfilesSave();

        // Attach XP info to state for UI consumption
        if (this._state) {
            this._state.lastSectorXp = {
                earned: xpEarned,
                leveledUp: result.leveledUp,
                newLevel: result.newLevel,
                unlocksGained: result.unlocksGained,
            };
        }
    }

    _finalizeRun(nowMs = Date.now()) {
        if (!this._state) return null;
        if (this._state.persistedAtIso) {
            return this.getStateSnapshot();
        }
        if (this._state.finishedAtIso) {
            this.flushPersistenceSaves();
            return this.getStateSnapshot();
        }

        const replaySnapshot = this._stopReplayRecording();
        this._latestReplaySnapshot = replaySnapshot && typeof replaySnapshot === 'object'
            ? { ...replaySnapshot }
            : null;
        const replayId = typeof replaySnapshot?.matchId === 'string' ? replaySnapshot.matchId : '';
        const summary = buildArcadeRunSummary(this._state, {
            endedAtMs: nowMs,
            replayId,
        });
        if (!summary) return this.getStateSnapshot();

        this._records = mergeArcadeRunRecords(this._records, summary);
        const sectorHistory = Array.isArray(this._state.sectorHistory)
            ? this._state.sectorHistory.map((entry) => ({ ...entry }))
            : [];
        const missionsCompleted = sectorHistory.reduce((sum, entry) => sum + Math.max(0, toSafeInt(entry?.missionsCompleted, 0)), 0);
        const missionsTotal = sectorHistory.reduce((sum, entry) => sum + Math.max(0, toSafeInt(entry?.missionsTotal, 0)), 0);
        const missionCompletionRate = missionsTotal > 0 ? missionsCompleted / missionsTotal : 0;
        const xpEarned = sectorHistory.reduce((sum, entry) => sum + Math.max(0, toSafeNumber(entry?.xpEarned, 0)), 0);
        const scorePerSector = sectorHistory.map((entry) => ({
            sectorIndex: Math.max(0, toSafeInt(entry?.sectorIndex, 0)),
            mapKey: String(entry?.mapKey || ''),
            modifierId: String(entry?.modifierId || ''),
            awardedPoints: Math.max(0, toSafeNumber(entry?.awardedPoints, 0)),
            comboAtSectorEnd: Math.max(0, toSafeInt(entry?.comboAtSectorEnd, 0)),
        }));
        const postRunSummary = {
            generatedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),
            runId: String(summary.runId || ''),
            isDailyChallenge: summary.isDailyChallenge === true,
            seed: Math.max(0, toSafeInt(summary.seed, 0)),
            score: Math.max(0, toSafeNumber(summary.score, 0)),
            peakMultiplier: Math.max(1, toSafeNumber(summary.peakMultiplier, 1)),
            bestCombo: Math.max(0, toSafeInt(summary.peakCombo, 0)),
            completedSectors: Math.max(0, toSafeInt(summary.completedSectors, 0)),
            missionCompletionRate,
            missionsCompleted,
            missionsTotal,
            xpEarned: Math.max(0, Math.round(xpEarned)),
            xpAnimation: {
                from: 0,
                to: Math.max(0, Math.round(xpEarned)),
                durationMs: 900,
            },
            scorePerSector,
            sectorHistory,
            rewardHistory: Array.isArray(this._state.rewardHistory)
                ? this._state.rewardHistory.map((entry) => ({ ...entry }))
                : [],
        };
        const replayState = this.getReplayState();
        this._state = {
            ...this._state,
            phase: ARCADE_RUN_PHASES.FINISHED,
            finishedAtIso: summary.finishedAtIso,
            persistedAtIso: '',
            updatedAtIso: summary.finishedAtIso,
            records: createArcadeRunRecords(this._records),
            postRunSummary,
            replay: {
                runReplayId: replayId,
                playbackEnabled: replayState.playbackEnabled,
                payloadAvailable: replayState.payloadAvailable,
            },
        };
        const finalizedRunId = String(summary.runId || '');
        this._scheduleRecordsSave(this._records, () => {
            if (String(this._state?.runId || '') !== finalizedRunId) return;
            this._state.persistedAtIso = summary.finishedAtIso;
            this._state.updatedAtIso = summary.finishedAtIso;
        });
        return this.getStateSnapshot();
    }

    resetRunState(options = {}) {
        const preserveRecords = options?.preserveRecords === true;
        this.flushPersistenceSaves();
        this._ghostRecorder?.reset?.();
        const replayRecorder = this.replayRecorder;
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
        this._pendingIntermissionEffects = null;
        this._pendingHumanVitals = null;
        this._latestReplaySnapshot = null;
        this._activeModifierId = null;
        this._lastGhostPlaybackRouteId = '';
        this._missionState = null;
        this._sectorElapsedSeconds = 0;
        this._lastMissionTickSecond = 0;
        this._hudEvents = [];
        this._resetStrategyRuntimeState();
        this._state = null;
        if (!preserveRecords) {
            this._records = this._readRecordsFromStorage();
        }
        return this.getStateSnapshot();
    }
}
