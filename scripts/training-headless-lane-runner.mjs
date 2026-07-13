import { WebSocket } from 'ws';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    createHeadlessMatchKernelRuntime,
    MATCH_KERNEL_HEADLESS_RUNTIME_CONTRACT_VERSION,
} from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    createMatchKernelTrainingAdapter,
    MATCH_KERNEL_TRAINING_ADAPTER_CONTRACT_VERSION,
} from '../src/core/MatchKernelTrainingAdapter.js';
import { TrainingTransportFacade } from '../src/entities/ai/training/TrainingTransportFacade.js';
import { WebSocketTrainerBridge } from '../src/entities/ai/training/WebSocketTrainerBridge.js';
import {
    MATCH_KERNEL_FIXED_STEP_SECONDS,
    MATCH_KERNEL_SURFACES,
} from '../src/shared/contracts/MatchKernelRuntimeContract.js';
import { buildTrainerRuntimeObservationPayload } from '../src/entities/ai/training/TrainerPayloadAdapter.js';
import {
    buildTrainingResetContract,
    buildTrainingStepContract,
} from '../src/entities/ai/training/TrainingContractV1.js';
import { createNeutralBotAction, sanitizeBotAction } from '../src/entities/ai/actions/BotActionContract.js';
import { resolveHybridDecision } from '../src/entities/ai/hybrid/HybridDecisionArchitecture.js';
import { RuntimeNearObservationTracker } from '../src/entities/ai/observation/RuntimeNearObservationAdapter.js';
import {
    HEALTH_RATIO,
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SPEED_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';
import { buildObservation, createObservationContext } from '../src/entities/ai/observation/ObservationSystem.js';
import {
    EpisodeController,
    TRAINING_TERMINAL_REASONS,
    TRAINING_TRUNCATION_REASONS,
} from '../src/state/training/EpisodeController.js';
import { RewardCalculator } from '../src/state/training/RewardCalculator.js';

const DEFAULT_ENVIRONMENT_PROFILE = 'runtime-near';
const DEFAULT_LANE_WORKER_COUNT = 1;
const DEFAULT_MAX_STEPS = 100;
const DEFAULT_SEED = 91;
const DEFAULT_PORT = 9765;
const DEFAULT_SESSION_ID = 'bt92-single-env';
const DEFAULT_ACTION_TIMEOUT_MS = 2_000;
const DEFAULT_ACK_TIMEOUT_MS = 2_000;
const DEFAULT_BRIDGE_READY_TIMEOUT_MS = 8_000;
const DEFAULT_STATS_TIMEOUT_MS = 2_000;
const KERNEL_RUNNING_LIFECYCLES = new Set(['running', 'round_end', 'match_end']);
export const BT93J_REWARD_CURRICULUM_PROOF_PROFILE_ID = 'bt93j-reward-curriculum-proof-v1';
export const BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID = 'bt93l-objective-reachability-v1';

const BT93J_PROOF_REWARD_WEIGHTS = Object.freeze({
    baseStep: -0.005,
    survival: 0.04,
    survivalPressureBonus: 0.02,
    kill: 1,
    crash: -7,
    stuck: -0.5,
    itemPickup: 0.08,
    itemUse: 0.03,
    damageDealt: 0.02,
    damageTaken: -0.18,
    wallRisk: -0.1,
    trailRisk: -0.16,
    opponentRisk: -0.1,
    lowHealthThreat: -0.3,
    win: 2.5,
    loss: -4,
    checkpointReached: 0.75,
    parcoursCompleted: 2,
    wrongOrder: -0.3,
});

const BT93J_PROOF_CURRICULUM_STAGES = Object.freeze([
    Object.freeze({
        name: 'bt93j-proof-terminal-pressure',
        minSteps: 0,
        weightOverrides: Object.freeze({
            survival: 0.04,
            survivalPressureBonus: 0.02,
            baseStep: -0.005,
            loss: -4,
            win: 2.5,
            checkpointReached: 0.75,
        }),
    }),
    Object.freeze({
        name: 'bt93j-proof-diversity-pressure',
        minSteps: 250_000,
        weightOverrides: Object.freeze({
            survival: 0.03,
            survivalPressureBonus: 0.015,
            baseStep: -0.006,
            loss: -4.5,
            win: 3,
            checkpointReached: 0.9,
        }),
    }),
]);

export function resolveHeadlessRewardProfile(profileId = '') {
    if (String(profileId || '') === BT93J_REWARD_CURRICULUM_PROOF_PROFILE_ID) {
        return {
            profileId: BT93J_REWARD_CURRICULUM_PROOF_PROFILE_ID,
            active: true,
            runKindBound: ['bt93j-user-owned-1m-proof-longrun'],
            rewardCalculatorOptions: {
                weights: BT93J_PROOF_REWARD_WEIGHTS,
                curriculum: true,
                curriculumStages: BT93J_PROOF_CURRICULUM_STAGES,
            },
            intent: 'BT93J.5b proof lane: player-dead-only must be net-negative; non-death natural terminal remains separately positive.',
        };
    }
    if (String(profileId || '') === BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID) {
        return {
            profileId: BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
            active: true,
            runKindBound: ['bt93l-progress-reachability', 'bt93l-reward-balance'],
            rewardCalculatorOptions: {
                weights: {
                    baseStep: -0.016,
                    survival: 0.012,
                    survivalPressureBonus: 0.01,
                    checkpointReached: 0.85,
                    parcoursCompleted: 2,
                    loss: -4.5,
                    win: 2.5,
                },
            },
            intent: 'BT93L.2/93L.3 diagnostic lane: progress must come from real observation deltas; survival-only, noop, and max-step plateaus are non-success.',
        };
    }
    return {
        profileId: 'default-training-reward-v1',
        active: false,
        runKindBound: [],
        rewardCalculatorOptions: {},
        intent: 'default training reward semantics',
    };
}

if (typeof globalThis.WebSocket !== 'function') {
    globalThis.WebSocket = WebSocket;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits = 3) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    const factor = 10 ** digits;
    return Math.round(numeric * factor) / factor;
}

function normalizeBooleanOption(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
}

function normalizeDomainMode(modeToken) {
    const normalized = String(modeToken || '').trim().toLowerCase();
    if (normalized === 'classic' || normalized === 'classic-3d' || normalized === 'classic3d') {
        return { gameMode: 'CLASSIC', planarMode: false, domainId: 'classic-3d', modePath: 'normal' };
    }
    if (normalized === 'classic-2d' || normalized === 'classic2d' || normalized === 'planar') {
        return { gameMode: 'CLASSIC', planarMode: true, domainId: 'classic-2d', modePath: 'normal' };
    }
    if (normalized === 'hunt' || normalized === 'fight' || normalized === 'hunt-3d' || normalized === 'hunt3d' || normalized === 'fight-3d' || normalized === 'fight3d') {
        return { gameMode: 'HUNT', planarMode: false, domainId: 'hunt-3d', modePath: 'fight' };
    }
    if (normalized === 'hunt-2d' || normalized === 'hunt2d' || normalized === 'fight-2d' || normalized === 'fight2d') {
        return { gameMode: 'HUNT', planarMode: true, domainId: 'hunt-2d', modePath: 'fight' };
    }
    return { gameMode: 'CLASSIC', planarMode: false, domainId: 'classic-3d', modePath: 'normal' };
}

function createPlayerSnapshot(player) {
    return {
        index: Number.isInteger(player?.index) ? player.index : 0,
        hp: Number(player?.hp ?? 0),
        maxHp: Number(player?.maxHp ?? 1),
        shieldHP: Number(player?.shieldHP ?? 0),
        maxShieldHp: Number(player?.maxShieldHp ?? 0),
        inventory: Array.isArray(player?.inventory) ? [...player.inventory] : [],
        inventoryLength: Array.isArray(player?.inventory) ? player.inventory.length : 0,
        alive: player?.alive !== false,
    };
}

function createSmokeSettings(options = {}) {
    const domain = normalizeDomainMode(options.domainMode);
    const mapKey = String(options.mapKey || 'standard').trim() || 'standard';
    const gameMode = String(options.gameMode || domain.gameMode || 'CLASSIC').trim().toUpperCase();
    const planarMode = Object.prototype.hasOwnProperty.call(options, 'planarMode')
        ? normalizeBooleanOption(options.planarMode, domain.planarMode)
        : domain.planarMode;
    const modePath = String(options.modePath || domain.modePath || 'normal').trim() || 'normal';
    return {
        localSettings: {
            modePath,
            sessionType: 'single',
        },
        mode: '1p',
        mapKey,
        gameMode,
        trainingDomainMode: domain.domainId,
        numBots: 1,
        winsNeeded: 3,
        botDifficulty: 'NORMAL',
        gameplay: {
            planarMode,
        },
        portalsEnabled: false,
    };
}

function normalizeKernelLifecycle(...values) {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const normalized = value.trim().toLowerCase();
        if (normalized) return normalized;
    }
    return 'running';
}

function normalizeReason(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

export function deriveHeadlessLaneEpisodeStep({
    player = null,
    lifecycle = 'running',
    tickLifecycle = null,
    input = {},
    nowMs = null,
} = {}) {
    const kernelLifecycle = normalizeKernelLifecycle(tickLifecycle, lifecycle);
    const playerAlive = player?.alive !== false;

    if (!playerAlive) {
        return {
            done: true,
            terminalReason: TRAINING_TERMINAL_REASONS.PLAYER_DEAD,
            truncated: false,
            truncatedReason: null,
            nowMs,
        };
    }

    if (kernelLifecycle === 'round_end' || kernelLifecycle === 'match_end') {
        return {
            done: true,
            terminalReason: TRAINING_TERMINAL_REASONS.MATCH_ENDED,
            truncated: false,
            truncatedReason: null,
            nowMs,
        };
    }

    if (input?.done === true) {
        return {
            done: true,
            terminalReason: normalizeReason(input.terminalReason, TRAINING_TERMINAL_REASONS.EXTERNAL),
            truncated: false,
            truncatedReason: null,
            nowMs,
        };
    }

    if (input?.truncated === true || input?.timeout === true) {
        return {
            done: false,
            terminalReason: null,
            truncated: true,
            truncatedReason: normalizeReason(
                input.truncatedReason,
                input?.timeout === true
                    ? TRAINING_TRUNCATION_REASONS.TIME_LIMIT
                    : TRAINING_TRUNCATION_REASONS.EXTERNAL,
            ),
            nowMs,
        };
    }

    return {
        done: false,
        terminalReason: null,
        truncated: false,
        truncatedReason: null,
        nowMs,
    };
}

function isDeathLikeTerminalReason(value) {
    const reason = normalizeReason(value, '').toLowerCase();
    if (!reason) return false;
    if (reason === TRAINING_TERMINAL_REASONS.PLAYER_DEAD) return true;
    return ['dead', 'death', 'killed', 'loss', 'crash'].some((token) => reason.includes(token));
}

function readObservationValue(observation, index, fallback = 0) {
    if (!observation || typeof observation.length !== 'number') return fallback;
    const value = Number(observation[index]);
    return Number.isFinite(value) ? value : fallback;
}

function roundDelta(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 1_000_000) / 1_000_000;
}

function actionHasEffect(action = {}) {
    if (!action || typeof action !== 'object') return false;
    return Object.values(action).some((value) => {
        if (value === true) return true;
        if (typeof value !== 'number') return false;
        return Number.isFinite(value) && value >= 0;
    });
}

export function deriveHeadlessObjectiveReachabilitySignals({
    previousObservation = null,
    observation = null,
    episode = {},
    input = {},
    action = null,
    rewardProfileId = '',
} = {}) {
    const profileActive = String(rewardProfileId || '') === BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID;
    const manualInjection = input?.progressEvent === true;
    const hasPrevious = previousObservation && typeof previousObservation.length === 'number';
    const hasCurrent = observation && typeof observation.length === 'number';
    const realEnvStepPath = profileActive && hasPrevious && hasCurrent && !manualInjection;
    const actionActive = actionHasEffect(action || input?.action || {});

    const previousTargetDistance = readObservationValue(previousObservation, TARGET_DISTANCE_RATIO, 1);
    const currentTargetDistance = readObservationValue(observation, TARGET_DISTANCE_RATIO, 1);
    const previousTargetAlignment = readObservationValue(previousObservation, TARGET_ALIGNMENT, 0);
    const currentTargetAlignment = readObservationValue(observation, TARGET_ALIGNMENT, 0);
    const previousOpenness = readObservationValue(previousObservation, LOCAL_OPENNESS_RATIO, 0);
    const currentOpenness = readObservationValue(observation, LOCAL_OPENNESS_RATIO, 0);
    const previousSpeed = readObservationValue(previousObservation, SPEED_RATIO, 0);
    const currentSpeed = readObservationValue(observation, SPEED_RATIO, 0);
    const currentTargetInFront = readObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5;
    const currentWallFront = readObservationValue(observation, WALL_DISTANCE_FRONT, 1);
    const currentPressure = readObservationValue(observation, PRESSURE_LEVEL, 0);
    const currentHealth = readObservationValue(observation, HEALTH_RATIO, 1);
    const currentProjectileThreat = readObservationValue(observation, PROJECTILE_THREAT, 0);

    const targetDistanceDelta = previousTargetDistance - currentTargetDistance;
    const targetAlignmentDelta = currentTargetAlignment - previousTargetAlignment;
    const opennessDelta = currentOpenness - previousOpenness;
    const speedDelta = currentSpeed - previousSpeed;
    const survivedStep = episode?.done !== true && episode?.truncated !== true;

    const targetDistanceImproved = actionActive && targetDistanceDelta >= 0.0025;
    const targetAlignmentImproved = actionActive && currentTargetInFront && targetAlignmentDelta >= 0.015;
    const safeMovementProgress = actionActive && speedDelta >= 0.01 && currentSpeed >= 0.02 && currentWallFront >= 0.1 && currentHealth > 0;
    const opennessImproved = actionActive && opennessDelta >= 0.01;
    const pressureSurvivalObserved = survivedStep && currentPressure >= 0.35 && currentSpeed >= 0.02;

    const progressEvents = [];
    if (targetDistanceImproved) progressEvents.push('target-distance-improved');
    if (targetAlignmentImproved) progressEvents.push('target-alignment-improved');
    if (safeMovementProgress) progressEvents.push('safe-movement-observed');
    if (opennessImproved) progressEvents.push('local-openness-improved');

    const objectiveEvents = progressEvents.filter((event) => event !== 'pressure-survival-step');
    const progressSignalReachable = realEnvStepPath && progressEvents.length > 0;
    const objectiveSignalReachable = realEnvStepPath && objectiveEvents.length > 0;

    return {
        active: profileActive,
        realEnvStepPath,
        actionActive,
        manualInjection,
        manualInjectionCounterprobe: manualInjection,
        source: progressSignalReachable ? 'runtime-observation-delta' : (manualInjection ? 'manual-injection-counterprobe' : 'none'),
        progressSignalReachable,
        objectiveSignalReachable,
        progressEvents,
        objectiveEvents,
        checkpointReached: objectiveSignalReachable ? 1 : 0,
        parcoursEnabled: progressSignalReachable,
        deltas: {
            targetDistance: roundDelta(targetDistanceDelta),
            targetAlignment: roundDelta(targetAlignmentDelta),
            localOpenness: roundDelta(opennessDelta),
            speed: roundDelta(speedDelta),
        },
        metrics: {
            speedRatio: roundDelta(currentSpeed),
            targetDistanceRatio: roundDelta(currentTargetDistance),
            targetAlignment: roundDelta(currentTargetAlignment),
            targetInFront: currentTargetInFront,
            localOpennessRatio: roundDelta(currentOpenness),
            wallDistanceFront: roundDelta(currentWallFront),
            pressureLevel: roundDelta(currentPressure),
            projectileThreat: roundDelta(currentProjectileThreat),
            healthRatio: roundDelta(currentHealth),
            pressureSurvivalObserved,
        },
    };
}

export function buildHeadlessTrainingRewardSignals(episode = {}, context = {}) {
    const done = episode?.done === true;
    const truncated = episode?.truncated === true;
    const terminalReason = normalizeReason(episode?.terminalReason, '');
    const terminalReasonLower = terminalReason.toLowerCase();
    const deathLikeTerminal = done && isDeathLikeTerminalReason(terminalReason);
    const proofProfileActive = String(context.rewardProfileId || '') === BT93J_REWARD_CURRICULUM_PROOF_PROFILE_ID;
    const objectiveReachability = context.objectiveReachability && typeof context.objectiveReachability === 'object'
        ? context.objectiveReachability
        : null;
    const signals = {
        survival: done !== true && truncated !== true,
        lost: deathLikeTerminal || terminalReasonLower === 'match-loss',
        won: terminalReasonLower === 'match-win'
            || (proofProfileActive && done && !deathLikeTerminal && terminalReasonLower === TRAINING_TERMINAL_REASONS.MATCH_ENDED),
        crashed: terminalReasonLower.includes('crash'),
    };
    if (proofProfileActive && context.progressEvent === true) {
        signals.parcoursEnabled = true;
        signals.checkpointReached = 1;
    }
    if (objectiveReachability?.progressSignalReachable === true) {
        signals.parcoursEnabled = true;
    }
    if (objectiveReachability?.objectiveSignalReachable === true) {
        signals.checkpointReached = Math.max(1, Number(objectiveReachability.checkpointReached || 0));
    }
    if (objectiveReachability?.metrics && typeof objectiveReachability.metrics === 'object') {
        signals.healthRatio = objectiveReachability.metrics.healthRatio;
        signals.pressureLevel = objectiveReachability.metrics.pressureLevel;
        signals.projectileThreat = objectiveReachability.metrics.projectileThreat;
        signals.wallRisk = Math.max(0, 1 - Number(objectiveReachability.metrics.wallDistanceFront || 1));
    }
    if (Number.isFinite(Number(context.totalEnvSteps))) {
        signals.totalEnvSteps = Number(context.totalEnvSteps);
    }
    return signals;
}

async function waitForLatestAction(bridge, timeoutMs = DEFAULT_ACTION_TIMEOUT_MS) {
    const startedAt = performance.now();
    let latestFailure = null;
    while ((performance.now() - startedAt) < timeoutMs) {
        const action = bridge.consumeLatestAction?.();
        if (action && typeof action === 'object') {
            return {
                action,
                latencyMs: round(performance.now() - startedAt),
            };
        }
        const failure = bridge.consumeFailure?.();
        if (failure) {
            latestFailure = failure;
        }
        await sleep(5);
    }
    throw new Error(`timed out waiting for bot-action-response${latestFailure ? ` (${latestFailure})` : ''}`);
}

async function waitForTrainingAck(bridge, label, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    const startedAt = performance.now();
    let latestFailure = null;
    while ((performance.now() - startedAt) < timeoutMs) {
        const response = bridge.consumeLatestResponse?.();
        if (response?.type === 'trainer-ready') {
            continue;
        }
        if (response?.ok === true && (response?.type === 'training-ack' || response?.type === label)) {
            return {
                response,
                latencyMs: round(performance.now() - startedAt),
            };
        }
        if (response?.ok === false) {
            throw new Error(`${label} rejected by sidecar: ${response.error || response.type || 'unknown-error'}`);
        }
        const failure = bridge.consumeFailure?.();
        if (failure) {
            latestFailure = failure;
        }
        await sleep(5);
    }
    throw new Error(`timed out waiting for ${label} ack${latestFailure ? ` (${latestFailure})` : ''}`);
}

function drainBridge(bridge) {
    while (bridge.consumeLatestAction?.()) {
        // drain
    }
    while (bridge.consumeLatestResponse?.()) {
        // drain
    }
    while (bridge.consumeFailure?.()) {
        // drain
    }
}

async function waitForSidecarReady(bridge, timeoutMs = DEFAULT_BRIDGE_READY_TIMEOUT_MS) {
    const startedAt = performance.now();
    while ((performance.now() - startedAt) < timeoutMs) {
        const remainingMs = Math.max(50, Math.trunc(timeoutMs - (performance.now() - startedAt)));
        const ready = await bridge.waitForReady(Math.min(600, remainingMs));
        if (ready === true) {
            return true;
        }
        await sleep(120);
    }
    return false;
}

export class HeadlessLaneStepRunner {
    constructor({
        runtime,
        trainingAdapter,
        runtimeConfig,
        settings,
        maxSteps = DEFAULT_MAX_STEPS,
        seed = DEFAULT_SEED,
        episodeIdPrefix = 'headless-lane',
        environmentProfile = DEFAULT_ENVIRONMENT_PROFILE,
        laneWorkerCount = DEFAULT_LANE_WORKER_COUNT,
        rewardProfileId = '',
        curriculumStepOffset = 0,
    } = {}) {
        this.runtime = runtime;
        this.trainingAdapter = trainingAdapter;
        this.runtimeConfig = runtimeConfig;
        this.settings = settings;
        this.seed = seed;
        this.episodeIdPrefix = episodeIdPrefix;
        this.environmentProfile = environmentProfile;
        this.laneWorkerCount = laneWorkerCount;
        this.curriculumStepOffset = Math.max(0, Math.trunc(Number(curriculumStepOffset) || 0));
        this.globalEnvSteps = 0;
        this.episodeController = new EpisodeController({
            defaultMaxSteps: maxSteps,
        });
        this.rewardProfile = resolveHeadlessRewardProfile(rewardProfileId);
        this.rewardCalculator = new RewardCalculator(this.rewardProfile.rewardCalculatorOptions);
        this.observationTracker = new RuntimeNearObservationTracker();
        this._actionScratch = createNeutralBotAction({});
        this._observationScratch = null;
        this._observationContext = null;
        this._previousObjectiveObservation = null;
    }

    get session() {
        return this.runtime?.session || null;
    }

    get mode() {
        return String(
            this.runtimeConfig?.session?.activeGameMode
            || this.session?.entityManager?.activeGameMode
            || this.settings?.gameMode
            || 'CLASSIC'
        ).toLowerCase();
    }

    get planarMode() {
        return !!this.runtimeConfig?.gameplay?.planarMode;
    }

    get matchId() {
        return String(this.session?.effectiveMapKey || this.runtimeConfig?.session?.mapKey || 'standard');
    }

    _getPlayer() {
        const player = this.session?.entityManager?.players?.[0] || null;
        assert(player, 'missing controlled player in headless runtime');
        return player;
    }

    _refreshObservationContext() {
        this._observationContext = createObservationContext({
            arena: this.session?.arena || this.session?.entityManager?.arena || null,
            players: this.session?.entityManager?.players || [],
            projectiles: this.session?.entityManager?.projectiles || [],
            mode: this.mode,
            planarMode: this.planarMode,
        }, this._observationContext || {});
        return this._observationContext;
    }

    _buildRawObservation() {
        const player = this._getPlayer();
        const context = this._refreshObservationContext();
        const observation = buildObservation(player, context, this._observationScratch || undefined);
        this._observationScratch = observation;
        return Array.from(observation);
    }

    _buildMetadata(extra = {}) {
        const {
            curriculumStageTelemetry = null,
            ...metadataExtra
        } = extra && typeof extra === 'object' ? extra : {};
        const curriculumTotalEnvSteps = this.curriculumStepOffset + this.globalEnvSteps;
        return {
            environmentProfile: this.environmentProfile,
            lane: {
                workerCount: this.laneWorkerCount,
                seed: this.seed,
            },
            rewardProfile: {
                profileId: this.rewardProfile.profileId,
                active: this.rewardProfile.active,
                runKindBound: this.rewardProfile.runKindBound,
            },
            effectiveEnvironment: {
                mapKey: this.matchId,
                mode: this.mode,
                gameMode: this.settings?.gameMode || null,
                planarMode: this.planarMode,
                modePath: this.settings?.localSettings?.modePath || null,
                domainMode: this.settings?.trainingDomainMode || null,
                curriculumStepOffset: this.curriculumStepOffset,
                globalEnvSteps: this.globalEnvSteps,
                curriculumTotalEnvSteps,
                activeCurriculumStage: this.rewardCalculator.currentStage || null,
                ...(curriculumStageTelemetry && typeof curriculumStageTelemetry === 'object'
                    ? curriculumStageTelemetry
                    : {}),
            },
            kernel: {
                surface: MATCH_KERNEL_SURFACES.HEADLESS,
                tickIndex: this.trainingAdapter.tickIndex,
                roundIndex: this.trainingAdapter.roundIndex,
                lifecycle: this.trainingAdapter.lifecycle,
                contractVersion: MATCH_KERNEL_HEADLESS_RUNTIME_CONTRACT_VERSION,
            },
            ...metadataExtra,
        };
    }

    buildActionRequestPayload() {
        const player = createPlayerSnapshot(this._getPlayer());
        const observation = this._buildRawObservation();
        return buildTrainerRuntimeObservationPayload({
            mode: this.mode,
            planarMode: this.planarMode,
            dt: MATCH_KERNEL_FIXED_STEP_SECONDS,
            observation,
            observationContext: this._buildMetadata({
                requestTick: this.trainingAdapter.tickIndex,
            }),
        }, player);
    }

    reset(input = {}) {
        this.trainingAdapter.restartRound();
        this.observationTracker.reset();
        const player = createPlayerSnapshot(this._getPlayer());
        const observation = this._buildRawObservation();
        this._previousObjectiveObservation = Array.from(observation);
        const metadata = this._buildMetadata(input.metadata || {});
        const episode = this.episodeController.reset({
            episodeId: `${this.episodeIdPrefix}-${this.seed}`,
            episodeIndex: 0,
            mode: this.mode,
            planarMode: this.planarMode,
        });
        const liftedObservation = this.observationTracker.lift(observation, {
            environmentProfile: this.environmentProfile,
            metadata,
            player,
            stepIndex: 0,
        });
        return buildTrainingResetContract({
            mode: this.mode,
            planarMode: this.planarMode,
            matchId: this.matchId,
            seed: this.seed,
            player,
            observation: liftedObservation.observation,
            observationSchemaVersion: liftedObservation.details.schemaVersion,
            observationLength: liftedObservation.observation.length,
            episode,
            metadata: {
                ...metadata,
                observationContext: liftedObservation.details,
            },
        });
    }

    step(input = {}) {
        const action = sanitizeBotAction(
            input.action,
            {
                inventoryLength: createPlayerSnapshot(this._getPlayer()).inventoryLength,
            },
            this._actionScratch,
        );
        const tickIndex = this.trainingAdapter.tickIndex;
        this.globalEnvSteps += 1;
        const curriculumTotalEnvSteps = this.curriculumStepOffset + this.globalEnvSteps;
        const stepResult = this.trainingAdapter.step({
            players: [{
                actions: { ...action },
            }],
        }, {
            tickIndex,
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            frameId: tickIndex + 1,
            wallClockMs: (tickIndex + 1) * 16,
            highResTimestampMs: (tickIndex + 1) * 16,
        });
        assert(stepResult?.tickResult, 'headless lane produced no tickResult');
        const kernelLifecycle = normalizeKernelLifecycle(stepResult.lifecycle, stepResult.tickResult.lifecycle);
        assert(
            KERNEL_RUNNING_LIFECYCLES.has(kernelLifecycle),
            `headless lane lifecycle drifted to ${kernelLifecycle}`,
        );

        const player = createPlayerSnapshot(this._getPlayer());
        const previousObjectiveObservation = this._previousObjectiveObservation
            ? Array.from(this._previousObjectiveObservation)
            : null;
        const observation = this._buildRawObservation();
        const episodeStepInput = deriveHeadlessLaneEpisodeStep({
            player,
            lifecycle: stepResult.lifecycle,
            tickLifecycle: stepResult.tickResult.lifecycle,
            input,
            nowMs: (tickIndex + 1) * 16,
        });
        const episode = this.episodeController.step(episodeStepInput);
        const objectiveReachability = deriveHeadlessObjectiveReachabilitySignals({
            previousObservation: previousObjectiveObservation,
            observation,
            episode,
            input,
            action,
            rewardProfileId: this.rewardProfile.profileId,
        });
        this._previousObjectiveObservation = Array.from(observation);
        const rewardSignals = buildHeadlessTrainingRewardSignals(episode, {
            totalEnvSteps: curriculumTotalEnvSteps,
            rewardProfileId: this.rewardProfile.profileId,
            progressEvent: input.progressEvent === true,
            objectiveReachability,
        });
        const previousCurriculumStage = this.rewardCalculator.currentStage || null;
        const reward = this.rewardCalculator.compute(rewardSignals, episode);
        const activeCurriculumStage = this.rewardCalculator.currentStage || null;
        const curriculumStageChanged = previousCurriculumStage !== activeCurriculumStage;
        const metadata = this._buildMetadata({
            tickResult: {
                lifecycle: stepResult.tickResult.lifecycle,
                tickIndex: stepResult.tickResult.tickIndex,
            },
            curriculumStageTelemetry: {
                activeCurriculumStage,
                curriculumStageChanged,
                curriculumTotalEnvSteps,
            },
        });
        const liftedObservation = this.observationTracker.lift(observation, {
            environmentProfile: this.environmentProfile,
            metadata,
            player,
            stepIndex: episode.stepIndex,
        });
        const hybridDecision = resolveHybridDecision(action, {
            observation: liftedObservation.observation,
            observationDetails: liftedObservation.details,
            planarMode: this.planarMode,
            player,
            intent: null,
        });
        return buildTrainingStepContract({
            mode: this.mode,
            planarMode: this.planarMode,
            matchId: this.matchId,
            seed: this.seed,
            player,
            observation: liftedObservation.observation,
            observationSchemaVersion: liftedObservation.details.schemaVersion,
            observationLength: liftedObservation.observation.length,
            episode,
            action: { ...hybridDecision.action },
            reward: reward.total,
            rewardBreakdown: reward.components,
            terminalReason: episode.terminalReason,
            truncatedReason: episode.truncatedReason,
            metadata: {
                ...metadata,
                episodeSemantics: {
                    source: 'player-kernel-state',
                    playerAlive: player.alive,
                    kernelLifecycle,
                    curriculumStepOffset: this.curriculumStepOffset,
                    globalEnvSteps: this.globalEnvSteps,
                    curriculumTotalEnvSteps,
                    activeCurriculumStage,
                    previousCurriculumStage,
                    curriculumStageChanged,
                    progressEventReachable: input.progressEvent === true,
                    manualProgressEvent: input.progressEvent === true,
                    realEnvStepPath: objectiveReachability.realEnvStepPath === true,
                    actionActiveForObjectiveSignal: objectiveReachability.actionActive === true,
                    progressSignalSource: objectiveReachability.source,
                    objectiveSignalSource: objectiveReachability.objectiveSignalReachable === true
                        ? objectiveReachability.source
                        : 'none',
                    progressSignalReachable: objectiveReachability.progressSignalReachable === true,
                    objectiveSignalReachable: objectiveReachability.objectiveSignalReachable === true,
                    objectiveReachability,
                    progressSignalReported: rewardSignals.parcoursEnabled === true,
                    checkpointReachedSignal: Number(rewardSignals.checkpointReached || 0),
                    done: episode.done,
                    truncated: episode.truncated,
                    terminalReason: episode.terminalReason,
                    truncatedReason: episode.truncatedReason,
                },
                observationContext: liftedObservation.details,
                hybridDecision: {
                    contractVersion: 'v80-hybrid-decision-trace-v1',
                    intent: hybridDecision.intent,
                    safety: hybridDecision.safety,
                    control: hybridDecision.control,
                },
            },
        });
    }
}

export class HeadlessBoundaryController {
    constructor(options = {}) {
        this.options = {
            port: Number(options.port ?? DEFAULT_PORT),
            maxSteps: Number(options.maxSteps ?? DEFAULT_MAX_STEPS),
            seed: Number(options.seed ?? DEFAULT_SEED),
            sessionId: String(options.sessionId || DEFAULT_SESSION_ID),
            episodeIdPrefix: String(options.episodeIdPrefix || 'headless-lane'),
            environmentProfile: String(options.environmentProfile || DEFAULT_ENVIRONMENT_PROFILE),
            laneWorkerCount: Math.max(1, Number(options.laneWorkerCount ?? DEFAULT_LANE_WORKER_COUNT)),
            rewardProfileId: String(options.rewardProfileId || ''),
            mapKey: String(options.mapKey || 'standard'),
            domainMode: String(options.domainMode || 'classic-3d'),
            gameMode: String(options.gameMode || ''),
            modePath: String(options.modePath || ''),
            planarMode: Object.prototype.hasOwnProperty.call(options, 'planarMode')
                ? normalizeBooleanOption(options.planarMode, false)
                : undefined,
            curriculumStepOffset: Math.max(0, Math.trunc(Number(options.curriculumStepOffset) || 0)),
        };
        this.readyPayload = null;
        this.settings = null;
        this.runtime = null;
        this.runtimeConfig = null;
        this.bridge = null;
        this.trainingAdapter = null;
        this.facade = null;
        this.stepRunner = null;
    }

    async initialize() {
        this.bridge = new WebSocketTrainerBridge({
            enabled: true,
            url: `ws://127.0.0.1:${this.options.port}`,
            timeoutMs: 250,
            maxRetries: 0,
            retryDelayMs: 0,
            requireReadyMessage: true,
            maxPendingAcks: 32,
            backpressureThreshold: 16,
        });
        const bridgeReady = await waitForSidecarReady(this.bridge, DEFAULT_BRIDGE_READY_TIMEOUT_MS);
        assert(bridgeReady === true, 'sidecar ready handshake failed');
        this.readyPayload = this.bridge.consumeLatestReadyPayload?.() || this.bridge.consumeLatestResponse?.() || null;

        this.settings = createSmokeSettings(this.options);
        this.runtimeConfig = createRuntimeConfigSnapshot(this.settings);
        this.runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
            settings: this.settings,
            runtimeConfig: this.runtimeConfig,
            requestedMapKey: this.runtimeConfig?.session?.mapKey,
            profile: {
                sessionId: this.options.sessionId,
                fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
                deterministic: true,
            },
        }));
        this.trainingAdapter = createMatchKernelTrainingAdapter({
            headlessRuntime: this.runtime,
        });
        this.stepRunner = new HeadlessLaneStepRunner({
            runtime: this.runtime,
            trainingAdapter: this.trainingAdapter,
            runtimeConfig: this.runtimeConfig,
            settings: this.settings,
            maxSteps: this.options.maxSteps,
            seed: this.options.seed,
            episodeIdPrefix: this.options.episodeIdPrefix,
            environmentProfile: this.options.environmentProfile,
            laneWorkerCount: this.options.laneWorkerCount,
            rewardProfileId: this.options.rewardProfileId,
            curriculumStepOffset: this.options.curriculumStepOffset,
        });
        this.facade = new TrainingTransportFacade({
            bridge: this.bridge,
            stepRunner: this.stepRunner,
            kernelProfile: this.runtime.getConsumerDescriptors?.()?.training?.profile || {
                matchId: this.runtime.session?.effectiveMapKey || this.runtimeConfig?.session?.mapKey || 'standard',
                modeId: this.runtime.session?.entityManager?.activeGameMode || this.runtimeConfig?.session?.activeGameMode || 'CLASSIC',
            },
        });
    }

    async reset() {
        drainBridge(this.bridge);
        const packet = this.facade.reset();
        const ack = await waitForTrainingAck(this.bridge, 'training-reset');
        return {
            ok: true,
            command: 'reset',
            ackLatencyMs: ack.latencyMs,
            packet,
        };
    }

    async step() {
        drainBridge(this.bridge);
        this.bridge.submitObservation(this.stepRunner.buildActionRequestPayload());
        const actionResponse = await waitForLatestAction(this.bridge);
        const packet = this.facade.step({
            action: actionResponse.action,
        });
        const ack = await waitForTrainingAck(this.bridge, 'training-step');
        return {
            ok: true,
            command: 'step',
            actionLatencyMs: actionResponse.latencyMs,
            ackLatencyMs: ack.latencyMs,
            resolvedAction: actionResponse.action,
            packet,
        };
    }

    async stats() {
        const stats = await this.bridge.submitCommand('trainer-stats-request', {}, {
            timeoutMs: DEFAULT_STATS_TIMEOUT_MS,
        });
        return {
            ok: true,
            command: 'stats',
            stats,
            bridgeTelemetry: this.bridge.getTelemetrySnapshot?.() || null,
            runtime: {
                headlessRuntimeContractVersion: MATCH_KERNEL_HEADLESS_RUNTIME_CONTRACT_VERSION,
                trainingAdapterContractVersion: MATCH_KERNEL_TRAINING_ADAPTER_CONTRACT_VERSION,
                surface: this.runtime.getConsumerDescriptors?.()?.training?.profile?.surface || MATCH_KERNEL_SURFACES.HEADLESS,
                rewardProfile: this.stepRunner?.rewardProfile || null,
                effectiveEnvironment: this.stepRunner?._buildMetadata?.().effectiveEnvironment || null,
            },
        };
    }

    async close() {
        this.bridge?.close?.();
        this.trainingAdapter?.dispose?.();
        this.bridge = null;
        this.trainingAdapter = null;
        this.facade = null;
        this.stepRunner = null;
        this.runtime = null;
        this.runtimeConfig = null;
        this.settings = null;
        return {
            ok: true,
            command: 'close',
        };
    }
}
