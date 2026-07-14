export const TRAINING_BENCHMARK_PROFILE_VERSION = 'v80-benchmark-profiles-v1';
export const TRAINING_ALGORITHM_PROFILE_VERSION = 'v80-algorithm-profiles-v1';

const DEFAULT_PROMOTION_POLICY = Object.freeze({
    manualOnly: true,
    averageBotSurvivalDelta: 0.25,
    maxForcedRoundRate: 0,
    maxTimeoutRoundRate: 0,
});

export const TRAINING_ALGORITHM_PROFILES = Object.freeze({
    'champion-stable': Object.freeze({
        id: 'champion-stable',
        label: 'Champion stable',
        track: 'challenger',
        description: 'Stabiles Challenger-Profil fuer BT11-Vergleiche mit Prioritized Replay und konservativer Exploration.',
        referenceOnly: false,
        replay: Object.freeze({
            prioritized: true,
            priorityAlpha: 0.6,
            priorityBetaStart: 0.4,
            priorityBetaEnd: 1,
            priorityBetaAnnealSteps: 120_000,
        }),
        model: Object.freeze({
            hiddenLayers: Object.freeze([256, 128]),
            gamma: 0.99,
            trainEvery: 4,
            targetSyncInterval: 500,
            epsilonStart: 1,
            epsilonEnd: 0.05,
            epsilonDecaySteps: 24_000,
            rewardClamp: 10,
        }),
        promotion: DEFAULT_PROMOTION_POLICY,
    }),
    'challenger-balanced': Object.freeze({
        id: 'challenger-balanced',
        label: 'Challenger balanced',
        track: 'challenger',
        description: 'Runtime-nahe Challenger-Lane mit aktivem PER und laengerer Exploration fuer BT80C-Kandidaten.',
        referenceOnly: false,
        replay: Object.freeze({
            prioritized: true,
            priorityAlpha: 0.7,
            priorityBetaStart: 0.45,
            priorityBetaEnd: 1,
            priorityBetaAnnealSteps: 160_000,
        }),
        model: Object.freeze({
            hiddenLayers: Object.freeze([256, 128]),
            gamma: 0.992,
            trainEvery: 4,
            targetSyncInterval: 700,
            epsilonStart: 1,
            epsilonEnd: 0.03,
            epsilonDecaySteps: 48_000,
            rewardClamp: 12,
        }),
        promotion: DEFAULT_PROMOTION_POLICY,
    }),
    'challenger-high-util': Object.freeze({
        id: 'challenger-high-util',
        label: 'Challenger high util',
        track: 'challenger',
        description: 'Langlauf-Profil fuer hohe Auslastung mit schrittweise abnehmender Exploration und harter Promotion-Lane.',
        referenceOnly: false,
        replay: Object.freeze({
            prioritized: true,
            priorityAlpha: 0.7,
            priorityBetaStart: 0.5,
            priorityBetaEnd: 1,
            priorityBetaAnnealSteps: 240_000,
        }),
        model: Object.freeze({
            hiddenLayers: Object.freeze([256, 128]),
            gamma: 0.994,
            trainEvery: 4,
            targetSyncInterval: 900,
            epsilonStart: 1,
            epsilonEnd: 0.02,
            epsilonDecaySteps: 72_000,
            rewardClamp: 12,
        }),
        promotion: DEFAULT_PROMOTION_POLICY,
    }),
    'ablation-no-per': Object.freeze({
        id: 'ablation-no-per',
        label: 'Ablation no PER',
        track: 'ablation',
        description: 'Gezielte Ablation ohne Prioritized Replay; bleibt strikt Referenz- oder Smoke-Lane.',
        referenceOnly: true,
        replay: Object.freeze({
            prioritized: false,
            priorityAlpha: 0.6,
            priorityBetaStart: 0.4,
            priorityBetaEnd: 1,
            priorityBetaAnnealSteps: 120_000,
        }),
        model: Object.freeze({
            hiddenLayers: Object.freeze([256, 128]),
            gamma: 0.99,
            trainEvery: 4,
            targetSyncInterval: 500,
            epsilonStart: 1,
            epsilonEnd: 0.05,
            epsilonDecaySteps: 24_000,
            rewardClamp: 10,
        }),
        promotion: DEFAULT_PROMOTION_POLICY,
    }),
});

export const TRAINING_PERFORMANCE_PROFILES = Object.freeze({
    'quick-benchmark': Object.freeze({
        id: 'quick-benchmark',
        label: 'Quick benchmark',
        description: 'Kurzlauf fuer deterministische Kandidatenpruefung mit maximaler Reproduzierbarkeit.',
        algorithmProfileName: 'champion-stable',
        trainer: Object.freeze({
            workerCount: 1,
            replayCapacity: 50_000,
            batchSize: 64,
            replayWarmup: 256,
            targetSyncInterval: 500,
            checkpointEveryRuns: 1,
            parallelism: 1,
        }),
        run: Object.freeze({
            runnerProfile: 'ops',
            environmentProfile: 'runtime-near',
            episodes: 2,
            maxSteps: 120,
            stepTimeoutRetries: 0,
            timeoutStepMs: 120,
            timeoutEpisodeMs: 120_000,
            timeoutRunMs: 180_000,
        }),
        bridge: Object.freeze({
            maxPendingAcks: 256,
            backpressureThreshold: 192,
            dropTrainingWhenBacklogged: true,
        }),
        botValidation: Object.freeze({
            serverMode: 'preview',
            headless: true,
            previewBuild: false,
            scenarioCount: 4,
            rounds: 4,
            playingTimeoutMs: 30_000,
            totalTimeoutMs: 22 * 60_000,
            stageTimeoutMs: 25 * 60_000,
        }),
        loop: Object.freeze({
            runs: 1,
            durationHours: null,
            stageTimeoutMs: 20 * 60_000,
            stopOnFail: true,
            withTrainerServer: true,
        }),
        guardrails: Object.freeze({
            maxLatencyP95Ms: 12,
            maxTimeoutRate: 0.1,
            maxFallbackRate: 0.05,
            maxBackpressureDrops: 0,
            maxPendingAckRatio: 0.35,
            maxArtifactBacklog: 0,
            maxResumeFailures: 0,
            temperatureC: null,
        }),
    }),
    ablation: Object.freeze({
        id: 'ablation',
        label: 'Ablation',
        description: 'Mittlerer Vergleichslauf fuer isolierte Einzelvariablen.',
        algorithmProfileName: 'ablation-no-per',
        trainer: Object.freeze({
            workerCount: 1,
            replayCapacity: 75_000,
            batchSize: 96,
            replayWarmup: 512,
            targetSyncInterval: 700,
            checkpointEveryRuns: 1,
            parallelism: 1,
        }),
        run: Object.freeze({
            runnerProfile: 'learn',
            environmentProfile: 'synthetic-smoke',
            episodes: 4,
            maxSteps: 180,
            stepTimeoutRetries: 1,
            timeoutStepMs: 180,
            timeoutEpisodeMs: 180_000,
            timeoutRunMs: 360_000,
        }),
        bridge: Object.freeze({
            maxPendingAcks: 512,
            backpressureThreshold: 384,
            dropTrainingWhenBacklogged: true,
        }),
        loop: Object.freeze({
            runs: 3,
            durationHours: null,
            stageTimeoutMs: 40 * 60_000,
            stopOnFail: true,
            withTrainerServer: true,
        }),
        guardrails: Object.freeze({
            maxLatencyP95Ms: 18,
            maxTimeoutRate: 0.15,
            maxFallbackRate: 0.08,
            maxBackpressureDrops: 0,
            maxPendingAckRatio: 0.4,
            maxArtifactBacklog: 0,
            maxResumeFailures: 0,
            temperatureC: null,
        }),
    }),
    'overnight-high-util': Object.freeze({
        id: 'overnight-high-util',
        label: 'Overnight high util',
        description: 'Langlauf fuer hohe lokale Auslastung mit harten Resume- und Artefaktguardrails.',
        algorithmProfileName: 'challenger-balanced',
        trainer: Object.freeze({
            workerCount: 1,
            replayCapacity: 150_000,
            batchSize: 128,
            replayWarmup: 1_024,
            targetSyncInterval: 1_000,
            checkpointEveryRuns: 2,
            parallelism: 1,
        }),
        run: Object.freeze({
            runnerProfile: 'learn',
            environmentProfile: 'runtime-near',
            episodes: 8,
            maxSteps: 240,
            stepTimeoutRetries: 1,
            timeoutStepMs: 220,
            timeoutEpisodeMs: 240_000,
            timeoutRunMs: 1_200_000,
        }),
        bridge: Object.freeze({
            maxPendingAcks: 1_024,
            backpressureThreshold: 768,
            dropTrainingWhenBacklogged: true,
        }),
        loop: Object.freeze({
            runs: 100_000,
            durationHours: 10,
            stageTimeoutMs: 90 * 60_000,
            stopOnFail: false,
            withTrainerServer: true,
        }),
        guardrails: Object.freeze({
            maxLatencyP95Ms: 30,
            maxTimeoutRate: 0.2,
            maxFallbackRate: 0.1,
            maxBackpressureDrops: 2,
            maxPendingAckRatio: 0.55,
            maxArtifactBacklog: 0,
            maxResumeFailures: 0,
            temperatureC: 84,
        }),
    }),
    marathon: Object.freeze({
        id: 'marathon',
        label: 'Marathon',
        description: '24h-Operatorprofil fuer maximale nutzbare Leistung ohne stillen Artefaktstau.',
        algorithmProfileName: 'challenger-high-util',
        trainer: Object.freeze({
            workerCount: 1,
            replayCapacity: 250_000,
            batchSize: 160,
            replayWarmup: 2_048,
            targetSyncInterval: 1_500,
            checkpointEveryRuns: 4,
            parallelism: 1,
        }),
        run: Object.freeze({
            runnerProfile: 'learn',
            environmentProfile: 'runtime-near',
            episodes: 8,
            maxSteps: 320,
            stepTimeoutRetries: 1,
            timeoutStepMs: 240,
            timeoutEpisodeMs: 300_000,
            timeoutRunMs: 1_500_000,
        }),
        bridge: Object.freeze({
            maxPendingAcks: 1_536,
            backpressureThreshold: 1_152,
            dropTrainingWhenBacklogged: true,
        }),
        loop: Object.freeze({
            runs: 100_000,
            durationHours: 24,
            stageTimeoutMs: 120 * 60_000,
            stopOnFail: false,
            withTrainerServer: true,
        }),
        guardrails: Object.freeze({
            maxLatencyP95Ms: 36,
            maxTimeoutRate: 0.22,
            maxFallbackRate: 0.12,
            maxBackpressureDrops: 3,
            maxPendingAckRatio: 0.6,
            maxArtifactBacklog: 0,
            maxResumeFailures: 0,
            temperatureC: 82,
        }),
    }),
});

export function normalizeTrainingAlgorithmProfileName(value, fallback = null) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized && Object.prototype.hasOwnProperty.call(TRAINING_ALGORITHM_PROFILES, normalized)) {
        return normalized;
    }
    return fallback;
}

export function resolveTrainingAlgorithmProfile(value, fallback = null) {
    const profileName = normalizeTrainingAlgorithmProfileName(value, fallback);
    if (!profileName) return null;
    return TRAINING_ALGORITHM_PROFILES[profileName] || null;
}

export function listTrainingAlgorithmProfiles() {
    return Object.keys(TRAINING_ALGORITHM_PROFILES)
        .map((key) => resolveTrainingAlgorithmProfile(key))
        .filter(Boolean);
}

export function normalizeTrainingPerformanceProfileName(value, fallback = null) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized && Object.prototype.hasOwnProperty.call(TRAINING_PERFORMANCE_PROFILES, normalized)) {
        return normalized;
    }
    return fallback;
}

export function resolveTrainingPerformanceProfile(value, fallback = null) {
    const profileName = normalizeTrainingPerformanceProfileName(value, fallback);
    if (!profileName) return null;
    return TRAINING_PERFORMANCE_PROFILES[profileName] || null;
}

export function listTrainingPerformanceProfiles() {
    return Object.keys(TRAINING_PERFORMANCE_PROFILES)
        .map((key) => resolveTrainingPerformanceProfile(key))
        .filter(Boolean);
}
