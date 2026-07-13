// ============================================
// TrainingAutomationContractV33.js - V33 automation run contract, KPIs and artifact layout
// ============================================

import { deriveTrainingDomain } from '../../../state/training/TrainingDomain.js';
import { toFiniteNumber } from '../../../utils/MathOps.js';
import {
    DEFAULT_TRAINING_ENVIRONMENT_PROFILE,
    normalizeTrainingEnvironmentProfile,
    TRAINING_ENVIRONMENT_PROFILES,
} from '../observation/RuntimeNearObservationAdapter.js';

export const TRAINING_AUTOMATION_RUN_CONTRACT_VERSION = 'v33-run-v1';
export const TRAINING_AUTOMATION_KPI_CONTRACT_VERSION = 'v33-kpi-v1';
export const TRAINING_AUTOMATION_ARTIFACT_LAYOUT_VERSION = 'v33-artifact-v1';

export const TRAINING_AUTOMATION_STAGE_ORDER = Object.freeze(['run', 'eval', 'gate']);
export const TRAINING_AUTOMATION_BRIDGE_MODES = Object.freeze(['local', 'bridge']);
export const TRAINING_AUTOMATION_RUNNER_PROFILES = Object.freeze(['ops', 'learn']);
export const TRAINING_AUTOMATION_ENVIRONMENT_PROFILES = TRAINING_ENVIRONMENT_PROFILES;

const DEFAULT_EPISODES = 3;
const DEFAULT_SEEDS = Object.freeze([3, 7, 11]);
const DEFAULT_MODES = Object.freeze([
    { mode: 'classic', planarMode: false },
    { mode: 'hunt', planarMode: true },
]);
const DEFAULT_MAX_STEPS = 180;
const DEFAULT_RUNNER_PROFILE = 'ops';
const DEFAULT_ENVIRONMENT_PROFILE = DEFAULT_TRAINING_ENVIRONMENT_PROFILE;
const DEFAULT_TIMEOUTS = Object.freeze({
    stepMs: 75,
    episodeMs: 20_000,
    runMs: 180_000,
});

const RUNS_ROOT_DIR = 'data/training/runs';
const MODELS_ROOT_DIR = 'data/training/models';
const STAMP_SAFE_PATTERN = /[^a-zA-Z0-9_-]/g;

function toBoundedInt(value, fallback, minValue = 0, maxValue = Number.MAX_SAFE_INTEGER) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minValue, Math.min(maxValue, Math.trunc(numeric)));
}

function roundMetric(value) {
    return Math.round(toFiniteNumber(value, 0) * 1_000_000) / 1_000_000;
}

function normalizeSeedList(input) {
    const source = Array.isArray(input)
        ? input
        : (typeof input === 'string' ? input.split(',') : DEFAULT_SEEDS);
    const seen = new Set();
    const normalized = [];
    for (let i = 0; i < source.length; i++) {
        const seed = toBoundedInt(source[i], NaN, 0, 1_000_000_000);
        if (!Number.isFinite(seed) || seen.has(seed)) continue;
        seen.add(seed);
        normalized.push(seed);
    }
    return normalized.length > 0 ? normalized : [...DEFAULT_SEEDS];
}

function parseModeToken(token) {
    if (typeof token !== 'string') return null;
    const trimmed = token.trim().toLowerCase();
    if (!trimmed) return null;

    const domainMatch = trimmed.match(/^([a-z]+)-(2d|3d)$/);
    if (domainMatch) {
        return {
            mode: domainMatch[1],
            planarMode: domainMatch[2] === '2d',
        };
    }
    if (trimmed.endsWith('-planar')) {
        return {
            mode: trimmed.slice(0, -'-planar'.length),
            planarMode: true,
        };
    }
    if (trimmed.endsWith('-spatial')) {
        return {
            mode: trimmed.slice(0, -'-spatial'.length),
            planarMode: false,
        };
    }
    return {
        mode: trimmed,
        planarMode: false,
    };
}

function normalizeSingleModeEntry(entry) {
    if (typeof entry === 'string') {
        const parsed = parseModeToken(entry);
        if (!parsed) return null;
        const domain = deriveTrainingDomain(parsed);
        return {
            mode: domain.mode,
            planarMode: domain.planarMode,
            domainId: domain.domainId,
        };
    }
    if (!entry || typeof entry !== 'object') return null;

    const fallbackFromDomainId = parseModeToken(entry.domainId);
    const mode = typeof entry.mode === 'string' ? entry.mode : fallbackFromDomainId?.mode;
    const planarMode = typeof entry.planarMode === 'boolean'
        ? entry.planarMode
        : (typeof entry.dimension === 'string' ? entry.dimension.trim().toLowerCase() === '2d' : fallbackFromDomainId?.planarMode);
    const domain = deriveTrainingDomain({
        mode,
        planarMode,
    });
    return {
        mode: domain.mode,
        planarMode: domain.planarMode,
        domainId: domain.domainId,
    };
}

function normalizeModeList(input) {
    const source = Array.isArray(input)
        ? input
        : (typeof input === 'string' ? input.split(',') : DEFAULT_MODES);
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < source.length; i++) {
        const modeEntry = normalizeSingleModeEntry(source[i]);
        if (!modeEntry) continue;
        if (seen.has(modeEntry.domainId)) continue;
        seen.add(modeEntry.domainId);
        normalized.push(modeEntry);
    }

    if (normalized.length > 0) {
        return normalized;
    }
    return DEFAULT_MODES.map((entry) => normalizeSingleModeEntry(entry));
}

function normalizeBridgeMode(input) {
    const normalized = typeof input === 'string'
        ? input.trim().toLowerCase()
        : 'local';
    if (normalized === 'off') return 'local';
    if (TRAINING_AUTOMATION_BRIDGE_MODES.includes(normalized)) {
        return normalized;
    }
    return 'local';
}

function normalizeRunnerProfile(input) {
    const normalized = typeof input === 'string'
        ? input.trim().toLowerCase()
        : DEFAULT_RUNNER_PROFILE;
    if (TRAINING_AUTOMATION_RUNNER_PROFILES.includes(normalized)) {
        return normalized;
    }
    return DEFAULT_RUNNER_PROFILE;
}

function resolveDefaultEnvironmentProfile(runnerProfile) {
    if (runnerProfile === 'ops' || runnerProfile === 'learn') {
        return DEFAULT_ENVIRONMENT_PROFILE;
    }
    return 'synthetic-smoke';
}

function parseOptionalBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function normalizeTimeouts(input = {}) {
    return {
        stepMs: toBoundedInt(input.stepMs, DEFAULT_TIMEOUTS.stepMs, 1, 60_000),
        episodeMs: toBoundedInt(input.episodeMs, DEFAULT_TIMEOUTS.episodeMs, 1, 10 * 60_000),
        runMs: toBoundedInt(input.runMs, DEFAULT_TIMEOUTS.runMs, 1, 12 * 60 * 60_000),
    };
}

export function normalizeTrainingRunConfig(input = {}) {
    const episodes = toBoundedInt(input.episodes, DEFAULT_EPISODES, 1, 100_000);
    const maxSteps = toBoundedInt(input.maxSteps, DEFAULT_MAX_STEPS, 1, 1_000_000);
    const runnerProfile = normalizeRunnerProfile(input.runnerProfile);
    const environmentProfile = normalizeTrainingEnvironmentProfile(
        input.environmentProfile,
        resolveDefaultEnvironmentProfile(runnerProfile)
    );
    const injectInvalidActions = parseOptionalBoolean(input.injectInvalidActions);
    const normalizedStepTimeoutRetries = toBoundedInt(input.stepTimeoutRetries, NaN, 0, 10);
    return {
        contractVersion: TRAINING_AUTOMATION_RUN_CONTRACT_VERSION,
        kpiContractVersion: TRAINING_AUTOMATION_KPI_CONTRACT_VERSION,
        artifactLayoutVersion: TRAINING_AUTOMATION_ARTIFACT_LAYOUT_VERSION,
        episodes,
        seeds: normalizeSeedList(input.seeds),
        modes: normalizeModeList(input.modes),
        maxSteps,
        bridgeMode: normalizeBridgeMode(input.bridgeMode),
        runnerProfile,
        environmentProfile,
        injectInvalidActions: injectInvalidActions == null
            ? environmentProfile === 'synthetic-smoke'
            : injectInvalidActions,
        stepTimeoutRetries: Number.isFinite(normalizedStepTimeoutRetries)
            ? normalizedStepTimeoutRetries
            : (environmentProfile === 'runtime-near' ? 1 : 0),
        timeouts: normalizeTimeouts(input.timeouts || {}),
    };
}

function nowIsoStamp() {
    return new Date().toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z')
        .replace('T', 'T');
}

export function normalizeTrainingRunStamp(input = null) {
    const candidate = typeof input === 'string' ? input.trim() : '';
    const fallback = nowIsoStamp();
    const source = candidate || fallback;
    const normalized = source.replace(STAMP_SAFE_PATTERN, '');
    return normalized || fallback;
}

export function resolveTrainingRunArtifactLayout(stampInput = null) {
    const stamp = normalizeTrainingRunStamp(stampInput);
    const runDir = `${RUNS_ROOT_DIR}/${stamp}`;
    const modelDir = `${MODELS_ROOT_DIR}/${stamp}`;
    return {
        contractVersion: TRAINING_AUTOMATION_ARTIFACT_LAYOUT_VERSION,
        stageOrder: [...TRAINING_AUTOMATION_STAGE_ORDER],
        stamp,
        rootDir: RUNS_ROOT_DIR,
        modelRootDir: MODELS_ROOT_DIR,
        runDir,
        modelDir,
        runArtifactPath: `${runDir}/run.json`,
        evalArtifactPath: `${runDir}/eval.json`,
        gateArtifactPath: `${runDir}/gate.json`,
        trainerArtifactPath: `${runDir}/trainer.json`,
        benchmarkManifestPath: `${runDir}/benchmark-manifest.json`,
        decisionTracePath: `${runDir}/decision-trace.json`,
        benchmarkReportPath: `${runDir}/benchmark-report.json`,
        latestBackupPath: `${runDir}/latest-before.json`,
        checkpointPath: `${modelDir}/checkpoint.json`,
        latestIndexPath: `${RUNS_ROOT_DIR}/latest.json`,
    };
}

export function buildTrainingKpiSnapshot(input = {}) {
    const episodeCount = toBoundedInt(input.episodeCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const stepCount = toBoundedInt(input.stepCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const terminalCount = toBoundedInt(input.terminalCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const truncationCount = toBoundedInt(input.truncationCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const invalidActionStepCount = toBoundedInt(input.invalidActionStepCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const runtimeErrorCount = toBoundedInt(input.runtimeErrorCount, 0, 0, Number.MAX_SAFE_INTEGER);
    const episodeReturnTotal = toFiniteNumber(input.episodeReturnTotal, 0);
    return {
        contractVersion: TRAINING_AUTOMATION_KPI_CONTRACT_VERSION,
        episodeReturnMean: episodeCount > 0 ? roundMetric(episodeReturnTotal / episodeCount) : 0,
        terminalRate: episodeCount > 0 ? roundMetric(terminalCount / episodeCount) : 0,
        truncationRate: episodeCount > 0 ? roundMetric(truncationCount / episodeCount) : 0,
        invalidActionRate: stepCount > 0 ? roundMetric(invalidActionStepCount / stepCount) : 0,
        runtimeErrorCount,
    };
}

export function buildTrainingLatestIndex(input = {}) {
    const layout = resolveTrainingRunArtifactLayout(input.stamp);
    const artifacts = input.artifacts && typeof input.artifacts === 'object'
        ? input.artifacts
        : {};
    return {
        contractVersion: TRAINING_AUTOMATION_ARTIFACT_LAYOUT_VERSION,
        stamp: layout.stamp,
        generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date().toISOString(),
        stageOrder: [...TRAINING_AUTOMATION_STAGE_ORDER],
        runDir: layout.runDir,
        artifacts: {
            run: {
                path: layout.runArtifactPath,
                status: artifacts.run?.status || 'pending',
                exists: artifacts.run?.exists === true,
            },
            eval: {
                path: layout.evalArtifactPath,
                status: artifacts.eval?.status || 'pending',
                exists: artifacts.eval?.exists === true,
            },
            gate: {
                path: layout.gateArtifactPath,
                status: artifacts.gate?.status || 'pending',
                exists: artifacts.gate?.exists === true,
            },
            trainer: {
                path: layout.trainerArtifactPath,
                status: artifacts.trainer?.status || 'pending',
                exists: artifacts.trainer?.exists === true,
            },
            benchmarkManifest: {
                path: layout.benchmarkManifestPath,
                status: artifacts.benchmarkManifest?.status || 'pending',
                exists: artifacts.benchmarkManifest?.exists === true,
            },
            decisionTrace: {
                path: layout.decisionTracePath,
                status: artifacts.decisionTrace?.status || 'pending',
                exists: artifacts.decisionTrace?.exists === true,
            },
            benchmarkReport: {
                path: layout.benchmarkReportPath,
                status: artifacts.benchmarkReport?.status || 'pending',
                exists: artifacts.benchmarkReport?.exists === true,
            },
            checkpoint: {
                path: layout.checkpointPath,
                status: artifacts.checkpoint?.status || 'pending',
                exists: artifacts.checkpoint?.exists === true,
            },
        },
        resumeSource: typeof input.resumeSource === 'string' ? input.resumeSource : null,
        lastCompletedStage: typeof input.lastCompletedStage === 'string' ? input.lastCompletedStage : null,
    };
}
