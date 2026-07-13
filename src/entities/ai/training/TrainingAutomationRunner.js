// ============================================
// TrainingAutomationRunner.js - deterministic batch orchestration for training automation V33
// ============================================

import {
    HEALTH_RATIO,
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SPEED_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from '../observation/ObservationSchemaV1.js';
import { TrainingTransportFacade } from './TrainingTransportFacade.js';
import { encodeModeId } from '../../../shared/contracts/EntityModeContract.js';
import { clamp01 } from '../../../utils/MathOps.js';
import {
    TRAINING_AUTOMATION_RUN_CONTRACT_VERSION,
    buildTrainingKpiSnapshot,
    normalizeTrainingRunConfig,
} from './TrainingAutomationContractV33.js';
import {
    buildLearnProfileAction,
    buildSyntheticPlayerState,
    resolveEnvironmentStepMetadata,
    toBoundedInt,
} from './TrainingAutomationRuntimeNearSupport.js';

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function roundMetric(value) {
    return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function clampSigned(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= -1) return -1;
    if (numeric >= 1) return 1;
    return numeric;
}

function hashStringToUint32(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createDeterministicRng(seedInput) {
    let seed = hashStringToUint32(seedInput) || 0x12345678;
    return () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 1_000_000) / 1_000_000;
    };
}

function createDeterministicObservation(context) {
    const values = new Array(OBSERVATION_LENGTH_V1).fill(0);
    const modeId = encodeModeId(context.mode);
    const stepRatio = context.maxSteps > 0 ? context.stepIndex / context.maxSteps : 0;
    for (let i = 0; i < values.length; i++) {
        const shaped = (context.rng() * 0.7) + (stepRatio * 0.3);
        values[i] = clamp01(shaped);
    }

    const frontClearance = clamp01(0.18 + (context.rng() * 0.62) - stepRatio * 0.18);
    const leftClearance = clamp01(0.22 + (context.rng() * 0.68));
    const rightClearance = clamp01(0.22 + (context.rng() * 0.68));
    const upClearance = context.planarMode
        ? 0
        : clamp01(0.24 + (context.rng() * 0.64));
    const downClearance = context.planarMode
        ? 0
        : clamp01(0.24 + (context.rng() * 0.64));
    const openness = clamp01(
        context.planarMode
            ? (frontClearance + leftClearance + rightClearance) / 3
            : (frontClearance + leftClearance + rightClearance + upClearance + downClearance) / 5
    );
    const healthRatio = clamp01(0.2 + (context.rng() * 0.7) - stepRatio * 0.12);
    const targetDistanceRatio = clamp01(context.rng());
    const targetAlignment = clampSigned((context.rng() * 2) - 1);
    const targetInFront = targetAlignment >= 0.1 && targetDistanceRatio <= 0.82;
    const projectileThreat = frontClearance < 0.32 && context.rng() > 0.58;
    const pressureLevel = clamp01(
        Math.max(
            1 - frontClearance,
            projectileThreat ? 0.88 : 0,
            Math.max(0, 0.45 - openness) * 1.5,
            targetInFront ? (1 - targetDistanceRatio) * 0.45 : 0
        )
    );

    values[SPEED_RATIO] = clamp01(0.25 + (context.rng() * 0.6));
    values[HEALTH_RATIO] = healthRatio;
    values[WALL_DISTANCE_FRONT] = frontClearance;
    values[WALL_DISTANCE_LEFT] = leftClearance;
    values[WALL_DISTANCE_RIGHT] = rightClearance;
    values[WALL_DISTANCE_UP] = upClearance;
    values[WALL_DISTANCE_DOWN] = downClearance;
    values[TARGET_DISTANCE_RATIO] = targetDistanceRatio;
    values[TARGET_ALIGNMENT] = targetAlignment;
    values[TARGET_IN_FRONT] = targetInFront ? 1 : 0;
    values[PRESSURE_LEVEL] = pressureLevel;
    values[PROJECTILE_THREAT] = projectileThreat ? 1 : 0;
    values[LOCAL_OPENNESS_RATIO] = openness;
    values[PLANAR_MODE_ACTIVE] = context.planarMode ? 1 : 0;
    values[18] = modeId;
    values[19] = clamp01(context.seed % 97 / 96);
    return values;
}

function resolveTerminalReason(rng) {
    const bucket = Math.floor(rng() * 3);
    if (bucket === 0) return 'match-win';
    if (bucket === 1) return 'match-loss';
    return 'player-dead';
}

function buildDeterministicAction(context) {
    if (context.runnerProfile === 'learn') {
        return buildLearnProfileAction(context);
    }
    const inventoryLength = context.inventoryLength;
    const forceInvalid = context.injectInvalidActions && (context.stepIndex % 4 === 0);
    const candidateItemIndex = forceInvalid
        ? inventoryLength + 1
        : Math.floor(context.rng() * Math.max(1, inventoryLength));
    const yawLeft = context.rng() >= 0.5;
    return {
        yawLeft,
        yawRight: !yawLeft && context.rng() > 0.35,
        boost: context.rng() > 0.72,
        shootMG: context.mode === 'hunt' && context.rng() > 0.6,
        shootItem: context.rng() > 0.55,
        shootItemIndex: candidateItemIndex,
        useItem: forceInvalid ? inventoryLength + 2 : candidateItemIndex,
    };
}

function buildDeterministicRewardSignals(context) {
    const won = context.done && context.terminalReason === 'match-win';
    const lost = context.done && !won;
    const crashed = context.done && context.terminalReason === 'player-dead';
    const observation = Array.isArray(context.observation) ? context.observation : [];
    const wallRisk = clamp01(1 - (Number(observation[WALL_DISTANCE_FRONT]) || 0));
    const pressureLevel = clamp01(observation[PRESSURE_LEVEL]);
    const openness = clamp01(observation[LOCAL_OPENNESS_RATIO], 1);
    const trailRisk = clamp01(Math.max(0, pressureLevel * 0.9 - openness * 0.22));
    const targetInFront = Number(observation[TARGET_IN_FRONT]) >= 0.5;
    const targetDistanceRatio = clamp01(observation[TARGET_DISTANCE_RATIO], 1);
    const opponentRisk = clamp01(targetInFront ? 1 - targetDistanceRatio : pressureLevel * 0.25);
    const healthRatio = clamp01(observation[HEALTH_RATIO], 1);
    const projectileThreat = Number(observation[PROJECTILE_THREAT]) >= 0.5 ? 1 : 0;
    return {
        survival: !lost,
        kills: won ? 1 : 0,
        crashes: crashed ? 1 : 0,
        itemUses: context.action?.shootItem ? 1 : 0,
        damageDealt: Math.floor(context.rng() * 7),
        damageTaken: Math.floor(context.rng() * 5),
        healthRatio,
        pressureLevel,
        projectileThreat,
        wallRisk,
        trailRisk,
        opponentRisk,
        riskProximity: {
            wall: wallRisk,
            trail: trailRisk,
            opponent: opponentRisk,
        },
        won,
        lost,
    };
}

function ensureWithinTimeout(deadlineMs, label) {
    if (nowMs() > deadlineMs) {
        throw new Error(`${label} timeout exceeded`);
    }
}

export class TrainingAutomationRunner {
    constructor(options = {}) {
        this._transportFactory = typeof options.transportFactory === 'function'
            ? options.transportFactory
            : (transportOptions) => new TrainingTransportFacade(transportOptions);
        this._bridge = options.bridge || null;
        this._createBridge = typeof options.createBridge === 'function' ? options.createBridge : null;
        this._defaultInventoryLength = toBoundedInt(options.inventoryLength, 3, 1, 20);
    }

    run(inputConfig = {}, options = {}) {
        const config = normalizeTrainingRunConfig(inputConfig);
        const generatedAt = new Date().toISOString();
        const startedAtMs = nowMs();
        const runDeadlineMs = startedAtMs + config.timeouts.runMs;
        const bridge = this._resolveBridge(config, options);
        const transport = this._transportFactory({
            bridge,
            episode: {
                defaultMaxSteps: config.maxSteps,
            },
        });
        const totals = {
            episodesTotal: 0,
            stepsTotal: 0,
            terminalCount: 0,
            truncationCount: 0,
            invalidActionStepCount: 0,
            invalidActionEventCount: 0,
            stepTimeoutRecoveryCount: 0,
            runtimeErrorCount: 0,
            deliveredPacketCount: 0,
            episodeReturnTotal: 0,
        };
        const episodes = [];
        const totalEpisodeBudget = config.modes.length * config.seeds.length * config.episodes;
        let episodeOrdinal = 0;

        for (let modeIndex = 0; modeIndex < config.modes.length; modeIndex++) {
            const modeConfig = config.modes[modeIndex];
            for (let seedIndex = 0; seedIndex < config.seeds.length; seedIndex++) {
                const seed = config.seeds[seedIndex];
                for (let episodeInSeed = 1; episodeInSeed <= config.episodes; episodeInSeed++) {
                    ensureWithinTimeout(runDeadlineMs, 'run');
                    episodeOrdinal += 1;
                    try {
                        const episodeResult = this._runSingleEpisode({
                            transport,
                            config,
                            modeConfig,
                            seed,
                            modeIndex,
                            seedIndex,
                            episodeInSeed,
                            episodeOrdinal,
                        });
                        episodes.push(episodeResult);
                        totals.episodesTotal += 1;
                        totals.stepsTotal += episodeResult.stepCount;
                        totals.terminalCount += episodeResult.done ? 1 : 0;
                        totals.truncationCount += episodeResult.truncated ? 1 : 0;
                        totals.invalidActionStepCount += episodeResult.invalidActionSteps;
                        totals.invalidActionEventCount += episodeResult.invalidActionEvents;
                        totals.stepTimeoutRecoveryCount += episodeResult.stepTimeoutRecoveries;
                        totals.deliveredPacketCount += episodeResult.deliveredPacketCount;
                        totals.episodeReturnTotal = roundMetric(totals.episodeReturnTotal + episodeResult.episodeReturn);
                        if (typeof options.onEpisodeComplete === 'function') {
                            options.onEpisodeComplete({
                                index: episodeOrdinal,
                                total: totalEpisodeBudget,
                                episode: episodeResult,
                            });
                        }
                    } catch (error) {
                        totals.runtimeErrorCount += 1;
                        episodes.push({
                            index: episodeOrdinal,
                            seed,
                            mode: modeConfig.mode,
                            planarMode: modeConfig.planarMode,
                            domainId: modeConfig.domainId,
                            episodeInSeed,
                            done: false,
                            truncated: false,
                            stepCount: 0,
                            episodeReturn: 0,
                            invalidActionSteps: 0,
                            invalidActionEvents: 0,
                            stepTimeoutRecoveries: 0,
                            deliveredPacketCount: 0,
                            terminalReason: null,
                            truncatedReason: null,
                            runtimeError: error?.message || String(error),
                        });
                    }
                }
            }
        }

        const finishedAtMs = nowMs();
        const kpis = buildTrainingKpiSnapshot({
            episodeCount: totals.episodesTotal,
            stepCount: totals.stepsTotal,
            terminalCount: totals.terminalCount,
            truncationCount: totals.truncationCount,
            invalidActionStepCount: totals.invalidActionStepCount,
            runtimeErrorCount: totals.runtimeErrorCount,
            episodeReturnTotal: totals.episodeReturnTotal,
        });
        return {
            contractVersion: TRAINING_AUTOMATION_RUN_CONTRACT_VERSION,
            generatedAt,
            startedAtMs: Math.trunc(startedAtMs),
            finishedAtMs: Math.trunc(finishedAtMs),
            elapsedMs: Math.max(0, Math.trunc(finishedAtMs - startedAtMs)),
            config,
            totals,
            kpis,
            episodes,
        };
    }

    _resolveBridge(config, options = {}) {
        if (config.bridgeMode !== 'bridge') {
            return null;
        }
        if (options.bridge) {
            return options.bridge;
        }
        if (this._createBridge) {
            return this._createBridge();
        }
        return this._bridge;
    }

    _runSingleEpisode(context) {
        const {
            transport,
            config,
            modeConfig,
            seed,
            modeIndex,
            seedIndex,
            episodeInSeed,
            episodeOrdinal,
        } = context;
        const episodeKey = `${modeConfig.domainId}:${seed}:${episodeInSeed}`;
        const rng = createDeterministicRng(episodeKey);
        const episodeStartedAtMs = nowMs();
        const episodeDeadlineMs = episodeStartedAtMs + config.timeouts.episodeMs;
        const inventoryLength = this._defaultInventoryLength;
        const shouldTerminate = (hashStringToUint32(`${episodeKey}:terminal`) % 5) !== 0;
        const terminalStep = Math.max(
            1,
            Math.min(
                config.maxSteps,
                toBoundedInt((rng() * config.maxSteps) + 1, 1, 1, config.maxSteps)
            )
        );

        const resetObservation = createDeterministicObservation({
            rng,
            stepIndex: 0,
            maxSteps: config.maxSteps,
            mode: modeConfig.mode,
            planarMode: modeConfig.planarMode,
            seed,
        });
        const resetMetadata = resolveEnvironmentStepMetadata({
            observation: resetObservation,
            environmentProfile: config.environmentProfile,
            mode: modeConfig.mode,
            seed,
            stepIndex: 0,
        });
        const resetPacket = transport.reset({
            mode: modeConfig.mode,
            planarMode: modeConfig.planarMode,
            maxSteps: config.maxSteps,
            seed,
            observation: resetObservation,
            player: buildSyntheticPlayerState(
                resetObservation,
                {
                    inventoryLength,
                }
            ),
            metadata: {
                runSeed: seed,
                modeIndex,
                seedIndex,
                episodeInSeed,
                ...resetMetadata,
            },
        });

        let deliveredPacketCount = resetPacket?.delivered ? 1 : 0;
        let episodeReturn = 0;
        let stepCount = 0;
        let invalidActionSteps = 0;
        let invalidActionEvents = 0;
        let stepTimeoutRecoveries = 0;
        let remainingStepTimeoutRecoveries = toBoundedInt(config.stepTimeoutRetries, 0, 0, 10);
        let finalTransition = resetPacket?.transition || null;

        for (let stepIndex = 1; stepIndex <= config.maxSteps; stepIndex++) {
            ensureWithinTimeout(episodeDeadlineMs, 'episode');
            const stepStartMs = nowMs();
            let invalidInStep = false;
            const done = shouldTerminate && stepIndex === terminalStep;
            const terminalReason = done ? resolveTerminalReason(rng) : null;
            const action = buildDeterministicAction({
                rng,
                mode: modeConfig.mode,
                inventoryLength,
                stepIndex,
                runnerProfile: config.runnerProfile,
                injectInvalidActions: config.injectInvalidActions,
            });
            const observation = createDeterministicObservation({
                rng,
                stepIndex,
                maxSteps: config.maxSteps,
                mode: modeConfig.mode,
                planarMode: modeConfig.planarMode,
                seed,
            });
            const metadata = resolveEnvironmentStepMetadata({
                observation,
                environmentProfile: config.environmentProfile,
                mode: modeConfig.mode,
                seed,
                stepIndex,
            });
            const rewardSignals = buildDeterministicRewardSignals({
                rng,
                done,
                terminalReason,
                action,
                observation,
            });
            const packet = transport.step({
                mode: modeConfig.mode,
                planarMode: modeConfig.planarMode,
                seed,
                maxSteps: config.maxSteps,
                inventoryLength,
                observation,
                player: buildSyntheticPlayerState(observation, {
                    inventoryLength,
                }),
                action,
                rewardSignals,
                done,
                terminalReason,
                metadata: {
                    runSeed: seed,
                    modeIndex,
                    seedIndex,
                    episodeInSeed,
                    episodeOrdinal,
                    ...metadata,
                },
                onInvalidAction() {
                    invalidInStep = true;
                    invalidActionEvents += 1;
                },
            });
            if ((nowMs() - stepStartMs) > config.timeouts.stepMs) {
                if (remainingStepTimeoutRecoveries > 0) {
                    remainingStepTimeoutRecoveries -= 1;
                    stepTimeoutRecoveries += 1;
                } else {
                    throw new Error('step timeout exceeded');
                }
            }
            if (invalidInStep) {
                invalidActionSteps += 1;
            }
            deliveredPacketCount += packet?.delivered ? 1 : 0;
            finalTransition = packet?.transition || finalTransition;
            stepCount += 1;
            episodeReturn = roundMetric(episodeReturn + Number(finalTransition?.reward || 0));
            if (finalTransition?.done || finalTransition?.truncated) {
                break;
            }
        }

        return {
            index: episodeOrdinal,
            seed,
            mode: modeConfig.mode,
            planarMode: modeConfig.planarMode,
            domainId: modeConfig.domainId,
            episodeInSeed,
            episodeId: finalTransition?.episodeId || null,
            episodeIndex: toBoundedInt(finalTransition?.episodeIndex, episodeOrdinal, 0, Number.MAX_SAFE_INTEGER),
            done: !!finalTransition?.done,
            truncated: !!finalTransition?.truncated,
            stepCount,
            episodeReturn,
            invalidActionSteps,
            invalidActionEvents,
            stepTimeoutRecoveries,
            deliveredPacketCount,
            terminalReason: finalTransition?.info?.terminalReason || null,
            truncatedReason: finalTransition?.info?.truncatedReason || null,
            runtimeError: null,
        };
    }
}
