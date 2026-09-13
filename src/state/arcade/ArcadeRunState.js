import {
    ARCADE_RUN_PROFILE_SCHEMA_VERSION,
    CURRENT_ARCADE_SCORE_MODEL,
    normalizeArcadeScoreModel,
} from '../../shared/contracts/ArcadeRunSettingsContract.js';

const DEFAULT_ARCADE_RUN_CONFIG = Object.freeze({
    enabled: false,
    profileId: 'arcade-default',
    runType: 'gauntlet',
    seed: 0,
    scoreModel: CURRENT_ARCADE_SCORE_MODEL,
    sectorCount: 8,
    intermissionSeconds: 10,
    comboWindowMs: 5000,
    comboDecayPerSecond: 1,
    maxMultiplier: 8,
    replayHooksEnabled: true,
    dailyChallenge: false,
    ghostDuelMode: 'off',
    ghostLibraryMaxRoutes: 64,
    ghostLibraryMaxFramesPerRoute: 1200,
    ghostLibraryMaxBytes: 4_000_000,
});

export const ARCADE_RUN_PHASES = Object.freeze({
    WARMUP: 'warmup',
    SECTOR_ACTIVE: 'sector_active',
    INTERMISSION: 'intermission',
    VICTORY: 'victory',
    SUDDEN_DEATH: 'sudden_death',
    FINISHED: 'finished',
});

const ARCADE_PHASE_SET = new Set(Object.values(ARCADE_RUN_PHASES));

import { toSafeNumber, clampNumber, clampInteger } from '../../shared/utils/ArcadeUtils.js';
import { normalizeArcadeGhostDuelMode } from '../../shared/contracts/ArcadeGhostDuelContract.js';

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function toIsoString(nowMs) {
    return new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString();
}

function createEmptyBreakdown(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    const base = Math.max(0, toSafeNumber(input.base, 0));
    const survival = Math.max(0, toSafeNumber(input.survival, 0));
    const kills = Math.max(0, toSafeNumber(input.kills, 0));
    const cleanSector = Math.max(0, toSafeNumber(input.cleanSector, 0));
    const risk = Math.max(0, toSafeNumber(input.risk, 0));
    const penalty = Math.max(0, toSafeNumber(input.penalty, 0));
    const completion = Math.max(0, toSafeNumber(input.completion, 0));
    const checkpoints = Math.max(0, toSafeNumber(input.checkpoints, 0));
    const time = Math.max(0, toSafeNumber(input.time, 0));
    const precision = Math.max(0, toSafeNumber(input.precision, 0));
    const total = Math.max(0, toSafeNumber(input.total, base + survival + kills + cleanSector + risk - penalty + completion + checkpoints + time + precision));
    return {
        base,
        survival,
        kills,
        cleanSector,
        risk,
        penalty,
        completion, checkpoints, time, precision,
        total,
    };
}

function resolveSectorPhase(config, sectorIndex) {
    if (sectorIndex > config.sectorCount) {
        return ARCADE_RUN_PHASES.SUDDEN_DEATH;
    }
    return ARCADE_RUN_PHASES.SECTOR_ACTIVE;
}

export function createArcadeRunConfig(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    return {
        enabled: input.enabled === true,
        profileId: normalizeText(input.profileId, DEFAULT_ARCADE_RUN_CONFIG.profileId),
        runType: normalizeText(input.runType, DEFAULT_ARCADE_RUN_CONFIG.runType),
        seed: clampInteger(input.seed, 0, 2_147_483_647, DEFAULT_ARCADE_RUN_CONFIG.seed),
        scoreModel: normalizeArcadeScoreModel(input.scoreModel),
        sectorCount: clampInteger(input.sectorCount, 1, 20, DEFAULT_ARCADE_RUN_CONFIG.sectorCount),
        intermissionSeconds: clampNumber(input.intermissionSeconds, 0.5, 20, DEFAULT_ARCADE_RUN_CONFIG.intermissionSeconds),
        comboWindowMs: clampInteger(input.comboWindowMs, 800, 20_000, DEFAULT_ARCADE_RUN_CONFIG.comboWindowMs),
        comboDecayPerSecond: clampNumber(input.comboDecayPerSecond, 0, 10, DEFAULT_ARCADE_RUN_CONFIG.comboDecayPerSecond),
        maxMultiplier: clampInteger(input.maxMultiplier, 1, 25, DEFAULT_ARCADE_RUN_CONFIG.maxMultiplier),
        replayHooksEnabled: input.replayHooksEnabled !== false,
        dailyChallenge: input.dailyChallenge === true,
        ghostDuelMode: normalizeArcadeGhostDuelMode(input.ghostDuelMode, DEFAULT_ARCADE_RUN_CONFIG.ghostDuelMode),
        ghostLibraryMaxRoutes: clampInteger(
            input.ghostLibraryMaxRoutes,
            1,
            2048,
            DEFAULT_ARCADE_RUN_CONFIG.ghostLibraryMaxRoutes
        ),
        ghostLibraryMaxFramesPerRoute: clampInteger(
            input.ghostLibraryMaxFramesPerRoute,
            1,
            20000,
            DEFAULT_ARCADE_RUN_CONFIG.ghostLibraryMaxFramesPerRoute
        ),
        ghostLibraryMaxBytes: clampInteger(
            input.ghostLibraryMaxBytes,
            1,
            20_000_000,
            DEFAULT_ARCADE_RUN_CONFIG.ghostLibraryMaxBytes
        ),
    };
}

export function createArcadeRunRecords(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    const comparableInput = input.schemaVersion === ARCADE_RUN_PROFILE_SCHEMA_VERSION
        && input.scoreModel === CURRENT_ARCADE_SCORE_MODEL
        ? input
        : {};
    return {
        schemaVersion: ARCADE_RUN_PROFILE_SCHEMA_VERSION,
        scoreModel: CURRENT_ARCADE_SCORE_MODEL,
        updatedAt: normalizeText(comparableInput.updatedAt, ''),
        runsPlayed: Math.max(0, clampInteger(comparableInput.runsPlayed, 0, 999_999, 0)),
        bestScore: Math.max(0, toSafeNumber(comparableInput.bestScore, 0)),
        bestMultiplier: Math.max(1, toSafeNumber(comparableInput.bestMultiplier, 1)),
        bestCombo: Math.max(0, clampInteger(comparableInput.bestCombo, 0, 99_999, 0)),
        bestSector: Math.max(0, clampInteger(comparableInput.bestSector, 0, 999, 0)),
        bestRunAt: normalizeText(comparableInput.bestRunAt, ''),
        lastScore: Math.max(0, toSafeNumber(comparableInput.lastScore, 0)),
        lastMultiplier: Math.max(1, toSafeNumber(comparableInput.lastMultiplier, 1)),
        lastCombo: Math.max(0, clampInteger(comparableInput.lastCombo, 0, 99_999, 0)),
        lastSector: Math.max(0, clampInteger(comparableInput.lastSector, 0, 999, 0)),
        lastRunAt: normalizeText(comparableInput.lastRunAt, ''),
        replay: {
            lastRunId: normalizeText(comparableInput?.replay?.lastRunId, ''),
            bestRunId: normalizeText(comparableInput?.replay?.bestRunId, ''),
        },
        breakdownTotals: createEmptyBreakdown(comparableInput.breakdownTotals),
        daily: {
            lastRecordedRunId: normalizeText(comparableInput?.daily?.lastRecordedRunId, ''),
            lastSucceeded: comparableInput?.daily?.lastSucceeded === true,
            lastCompletedSectors: Math.max(0, toSafeNumber(comparableInput?.daily?.lastCompletedSectors, 0)),
            seed: Math.max(0, clampInteger(comparableInput?.daily?.seed, 0, 2_147_483_647, 0)),
            runsPlayed: Math.max(0, clampInteger(comparableInput?.daily?.runsPlayed, 0, 999_999, 0)),
            bestScore: Math.max(0, toSafeNumber(comparableInput?.daily?.bestScore, 0)),
            bestRunAt: normalizeText(comparableInput?.daily?.bestRunAt, ''),
            lastScore: Math.max(0, toSafeNumber(comparableInput?.daily?.lastScore, 0)),
            lastRunAt: normalizeText(comparableInput?.daily?.lastRunAt, ''),
        },
    };
}

export function createArcadeRunState({
    config = null,
    records = null,
    nowMs = Date.now(),
    runId = '',
} = {}) {
    const nextConfig = createArcadeRunConfig(config);
    const nextRecords = createArcadeRunRecords(records);
    const startedAtIso = toIsoString(nowMs);
    const normalizedRunId = normalizeText(runId, `arcade-run-${Math.floor(Math.max(0, nowMs)).toString(36)}`);

    return {
        enabled: !!nextConfig.enabled,
        runId: normalizedRunId,
        config: nextConfig,
        phase: ARCADE_RUN_PHASES.WARMUP,
        gameplayTimeMs: 0,
        xpEarned: 0,
        dailyResult: null,
        victory: null,
        intermissionPaused: false,
        sectorIndex: 0,
        completedSectors: 0,
        startedAtIso,
        updatedAtIso: startedAtIso,
        finishedAtIso: '',
        persistedAtIso: '',
        score: {
            total: 0,
            multiplier: 1,
            peakMultiplier: 1,
            combo: 0,
            peakCombo: 0,
            lastComboAtMs: 0,
            lastScoredSector: 0,
            lastSectorPoints: 0,
            breakdown: createEmptyBreakdown(),
        },
        records: nextRecords,
        replay: {
            runReplayId: '',
        },
        lastSectorSummary: null,
        lastCompletedSectorResult: null,
        mapSequence: [],
        currentMapKey: null,
        missions: null,
    };
}

export function cloneArcadeRunState(state) {
    if (!state || typeof state !== 'object') return null;
    return deepClone(state);
}

export function setArcadeRunPhase(state, nextPhase, nowMs = Date.now()) {
    if (!state || typeof state !== 'object') return state;
    const requested = normalizeText(nextPhase, state.phase);
    const phase = ARCADE_PHASE_SET.has(requested) ? requested : state.phase;
    if (phase === state.phase) return state;
    return {
        ...state,
        phase,
        updatedAtIso: toIsoString(nowMs),
    };
}

export function beginArcadeSector(state, nowMs = Date.now()) {
    if (!state || typeof state !== 'object') return state;
    if (state.phase === ARCADE_RUN_PHASES.FINISHED) return state;
    // 61.6.1: Allow sectorIndex to exceed sectorCount for SUDDEN_DEATH (endless mode)
    const nextSectorIndex = Math.max(1, (Math.max(0, toSafeNumber(state.completedSectors, 0)) || 0) + 1);
    return {
        ...state,
        phase: resolveSectorPhase(state.config, nextSectorIndex),
        sectorIndex: nextSectorIndex,
        updatedAtIso: toIsoString(nowMs),
    };
}

export function completeArcadeSector(state, nowMs = Date.now()) {
    if (!state || typeof state !== 'object') return state;
    if (state.phase === ARCADE_RUN_PHASES.FINISHED) return state;
    const maxSectors = Math.max(1, toSafeNumber(state?.config?.sectorCount, 1));
    const isSuddenDeath = state.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH;
    // 61.6.1: In SUDDEN_DEATH, completedSectors can exceed maxSectors (endless mode)
    const completedSectors = isSuddenDeath
        ? Math.max(0, Math.max(
            clampInteger(state.completedSectors, 0, 99_999, 0),
            clampInteger(state.sectorIndex, 0, 99_999, 0)
        ))
        : Math.min(maxSectors, Math.max(
            Math.max(0, clampInteger(state.completedSectors, 0, maxSectors, 0)),
            Math.max(0, clampInteger(state.sectorIndex, 0, maxSectors, 0))
        ));
    const sectorEntry = Array.isArray(state.encounterSequence)
        ? state.encounterSequence[Math.max(0, completedSectors - 1)] || null
        : null;
    const lastCompletedSectorResult = Object.freeze({
        sectorIndex: completedSectors,
        sectorPhase: String(state.phase || ''),
        wasSuddenDeath: isSuddenDeath,
        mapKey: String(state.currentMapKey || ''),
        templateId: String(sectorEntry?.templateId || ''),
        encounterId: String(sectorEntry?.encounterId || sectorEntry?.id || sectorEntry?.templateId || ''),
        modifierId: String(sectorEntry?.modifierId || ''),
    });
    // 61.6.1: Always go to INTERMISSION — FINISHED is set by _finalizeRun when player dies/quits
    return {
        ...state,
        completedSectors,
        lastCompletedSectorResult,
        phase: completedSectors === maxSectors && !isSuddenDeath
            ? ARCADE_RUN_PHASES.VICTORY : ARCADE_RUN_PHASES.INTERMISSION,
        updatedAtIso: toIsoString(nowMs),
    };
}
