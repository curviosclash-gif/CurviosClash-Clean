// ============================================
// DeveloperTrainingController.js - modular developer-facing training session controller
// ============================================

import { OBSERVATION_LENGTH_V1 } from '../entities/ai/observation/ObservationSchemaV1.js';
import { TrainingTransportFacade } from '../entities/ai/training/TrainingTransportFacade.js';
import { encodeModeId } from '../shared/contracts/EntityModeContract.js';
import { toFiniteNumber } from '../utils/MathOps.js';

const DEFAULT_TRAINING_MODE = 'classic';
const DEFAULT_MATCH_ID = 'developer-training';
const DEFAULT_MAX_STEPS = 180;
const DEFAULT_INVENTORY_LENGTH = 2;
const MAX_INVENTORY_LENGTH = 20;
const DEFAULT_AUTO_STEPS = 20;
const MAX_AUTO_STEPS = 5000;

function toTrimmedString(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function toInt(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const intValue = Math.trunc(numeric);
    const clampedMin = Number.isFinite(Number(min)) ? Number(min) : intValue;
    const clampedMax = Number.isFinite(Number(max)) ? Number(max) : intValue;
    return Math.max(clampedMin, Math.min(clampedMax, intValue));
}

function normalizeMode(mode) {
    const raw = toTrimmedString(mode, DEFAULT_TRAINING_MODE).toLowerCase();
    if (raw === 'fight') return 'hunt';
    return raw === 'hunt' ? 'hunt' : 'classic';
}

function normalizeMatchId(value) {
    const normalized = toTrimmedString(value, DEFAULT_MATCH_ID);
    return normalized || DEFAULT_MATCH_ID;
}

function deterministicValue(seed, index) {
    const value = Math.sin((seed + 1) * (index + 1) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
}

function createObservationVector(seed, mode, planarMode, inventoryLength) {
    const vector = new Array(OBSERVATION_LENGTH_V1).fill(0);
    for (let index = 0; index < OBSERVATION_LENGTH_V1; index++) {
        vector[index] = Number(deterministicValue(seed, index).toFixed(6));
    }
    vector[0] = Number((0.2 + deterministicValue(seed + 5, 0) * 0.8).toFixed(6));
    vector[1] = Number((0.2 + deterministicValue(seed + 7, 1) * 0.8).toFixed(6));
    vector[15] = Number(Math.max(0, Math.min(1, inventoryLength / MAX_INVENTORY_LENGTH)).toFixed(6));
    vector[16] = inventoryLength > 0 ? 0 : -1;
    vector[17] = planarMode ? 1 : 0;
    vector[18] = encodeModeId(mode);
    return vector;
}

function normalizeTransitionSummary(transition) {
    if (!transition || typeof transition !== 'object') return null;
    return {
        contractVersion: transition.contractVersion || null,
        operation: transition.operation || null,
        episodeId: transition.episodeId || null,
        episodeIndex: toInt(transition.episodeIndex, 0, 0, Number.MAX_SAFE_INTEGER),
        stepIndex: toInt(transition.stepIndex, 0, 0, Number.MAX_SAFE_INTEGER),
        reward: toFiniteNumber(transition.reward, 0),
        done: !!transition.done,
        truncated: !!transition.truncated,
        domainId: transition.info?.domain?.domainId || null,
        terminalReason: transition.info?.terminalReason || null,
        truncatedReason: transition.info?.truncatedReason || null,
        action: transition.action && typeof transition.action === 'object'
            ? { ...transition.action }
            : null,
        rewardBreakdown: transition.info?.rewardBreakdown && typeof transition.info.rewardBreakdown === 'object'
            ? { ...transition.info.rewardBreakdown }
            : null,
    };
}

export class DeveloperTrainingController {
    constructor(options = {}) {
        this.transportFacade = options.transportFacade instanceof TrainingTransportFacade
            ? options.transportFacade
            : new TrainingTransportFacade(options);
        this._session = {
            mode: DEFAULT_TRAINING_MODE,
            planarMode: false,
            maxSteps: DEFAULT_MAX_STEPS,
            seed: 0,
            inventoryLength: DEFAULT_INVENTORY_LENGTH,
            matchId: DEFAULT_MATCH_ID,
            active: false,
            latestPacketType: null,
            latestDelivered: false,
            latestTransition: null,
        };
    }

    getSnapshot() {
        return {
            mode: this._session.mode,
            planarMode: this._session.planarMode,
            maxSteps: this._session.maxSteps,
            seed: this._session.seed,
            inventoryLength: this._session.inventoryLength,
            matchId: this._session.matchId,
            active: this._session.active,
            latestPacketType: this._session.latestPacketType,
            latestDelivered: this._session.latestDelivered,
            latestTransition: this._session.latestTransition ? { ...this._session.latestTransition } : null,
        };
    }

    reset(input = {}) {
        const nextSession = this._resolveSessionInput(input, {
            fallbackSeed: this._session.seed,
        });
        const observation = Array.isArray(input.observation)
            ? input.observation
            : createObservationVector(nextSession.seed, nextSession.mode, nextSession.planarMode, nextSession.inventoryLength);
        const packet = this.transportFacade.reset({
            mode: nextSession.mode,
            planarMode: nextSession.planarMode,
            maxSteps: nextSession.maxSteps,
            matchId: nextSession.matchId,
            observation,
            metadata: {
                source: 'developer-panel',
            },
        });
        return this._commitPacket(packet, nextSession);
    }

    step(input = {}) {
        if (!this._session.active) {
            this.reset(input);
        }
        const nextSession = this._resolveSessionInput(input, {
            fallbackSeed: this._session.seed + 1,
        });
        const observation = Array.isArray(input.observation)
            ? input.observation
            : createObservationVector(nextSession.seed, nextSession.mode, nextSession.planarMode, nextSession.inventoryLength);
        const packet = this.transportFacade.step({
            mode: nextSession.mode,
            planarMode: nextSession.planarMode,
            matchId: nextSession.matchId,
            maxSteps: nextSession.maxSteps,
            observation,
            action: input.action && typeof input.action === 'object' ? input.action : null,
            inventoryLength: nextSession.inventoryLength,
            rewardSignals: input.rewardSignals && typeof input.rewardSignals === 'object' ? input.rewardSignals : {},
            done: !!input.done,
            truncated: !!input.truncated,
            terminalReason: toTrimmedString(input.terminalReason, ''),
            truncatedReason: toTrimmedString(input.truncatedReason, ''),
            metadata: {
                source: 'developer-panel',
            },
        });
        return this._commitPacket(packet, nextSession);
    }

    autoStep(input = {}) {
        const requestedSteps = toInt(input.steps, DEFAULT_AUTO_STEPS, 1, MAX_AUTO_STEPS);
        if (!this._session.active) {
            this.reset(input);
        }

        const firstStepIndex = toInt(this._session.latestTransition?.stepIndex, 0, 0, Number.MAX_SAFE_INTEGER);
        const baseSeed = Object.prototype.hasOwnProperty.call(input, 'seed')
            ? toInt(input.seed, this._session.seed + 1, 0, Number.MAX_SAFE_INTEGER)
            : toInt(this._session.seed + 1, 0, 0, Number.MAX_SAFE_INTEGER);

        let executedSteps = 0;
        let snapshot = this.getSnapshot();
        let stoppedReason = 'count-reached';

        for (let index = 0; index < requestedSteps; index++) {
            snapshot = this.step({
                ...input,
                seed: baseSeed + index,
            });
            executedSteps += 1;
            if (snapshot?.latestTransition?.done || snapshot?.latestTransition?.truncated) {
                stoppedReason = 'terminal';
                break;
            }
        }

        return {
            ...snapshot,
            autoStep: {
                requestedSteps,
                executedSteps,
                startedAtStepIndex: firstStepIndex,
                endedAtStepIndex: toInt(snapshot?.latestTransition?.stepIndex, firstStepIndex, 0, Number.MAX_SAFE_INTEGER),
                stoppedReason,
            },
        };
    }

    _resolveSessionInput(input = {}, options = {}) {
        const fallbackSeed = toInt(options.fallbackSeed, 0, 0, Number.MAX_SAFE_INTEGER);
        return {
            mode: normalizeMode(input.mode ?? this._session.mode),
            planarMode: Object.prototype.hasOwnProperty.call(input, 'planarMode')
                ? !!input.planarMode
                : !!this._session.planarMode,
            maxSteps: toInt(input.maxSteps, this._session.maxSteps || DEFAULT_MAX_STEPS, 1, 1_000_000),
            seed: toInt(input.seed, fallbackSeed, 0, Number.MAX_SAFE_INTEGER),
            inventoryLength: toInt(input.inventoryLength, this._session.inventoryLength || DEFAULT_INVENTORY_LENGTH, 0, MAX_INVENTORY_LENGTH),
            matchId: normalizeMatchId(input.matchId || this._session.matchId),
        };
    }

    _commitPacket(packet, nextSession) {
        const transition = packet?.transition && typeof packet.transition === 'object'
            ? packet.transition
            : null;
        const transitionSummary = normalizeTransitionSummary(transition);
        this._session = {
            ...nextSession,
            active: !(transitionSummary?.done || transitionSummary?.truncated),
            latestPacketType: toTrimmedString(packet?.type, ''),
            latestDelivered: !!packet?.delivered,
            latestTransition: transitionSummary,
        };
        return this.getSnapshot();
    }
}
