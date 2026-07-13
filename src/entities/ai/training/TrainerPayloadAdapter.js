// ============================================
// TrainerPayloadAdapter.js - payload adapters for runtime/transport training integration
// ============================================

import {
    DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
    liftObservationWithRuntimeNearContext,
} from '../observation/RuntimeNearObservationAdapter.js';
import { OBSERVATION_SCHEMA_VERSION_V2 } from '../observation/ObservationSchemaV2.js';
import { deriveTrainingDomain } from '../../../state/training/TrainingDomain.js';
import { TRAINING_CONTRACT_VERSION } from '../../../shared/contracts/TrainingRuntimeContract.js';
import { toFiniteNumber } from '../../../utils/MathOps.js';

function cloneObservation(observation) {
    if (!observation || typeof observation.length !== 'number') return null;
    const length = Math.max(0, Math.trunc(observation.length));
    const cloned = new Array(length);
    for (let i = 0; i < length; i++) {
        cloned[i] = toFiniteNumber(observation[i], 0);
    }
    return cloned;
}

function resolvePlanarMode(runtimeContext = {}) {
    if (runtimeContext?.rules && typeof runtimeContext.rules === 'object') {
        return !!runtimeContext.rules.planarMode;
    }
    return !!runtimeContext.planarMode;
}

function resolveControlProfileId(runtimeContext = {}, mode = 'classic', planarMode = false) {
    const directControlProfileId = typeof runtimeContext?.controlProfileId === 'string'
        ? runtimeContext.controlProfileId.trim()
        : '';
    if (directControlProfileId) {
        return directControlProfileId;
    }
    const rulesControlProfileId = typeof runtimeContext?.rules?.controlProfileId === 'string'
        ? runtimeContext.rules.controlProfileId.trim()
        : '';
    if (rulesControlProfileId) {
        return rulesControlProfileId;
    }
    const fallbackDomain = deriveTrainingDomain({ mode, planarMode });
    return fallbackDomain.controlProfileId;
}

function buildPlayerPayload(player) {
    if (!player || typeof player !== 'object') return null;
    return {
        index: Number.isInteger(player.index) ? player.index : -1,
        hp: toFiniteNumber(player.hp, 0),
        maxHp: toFiniteNumber(player.maxHp, 0),
        shieldHp: toFiniteNumber(player.shieldHP, 0),
        maxShieldHp: toFiniteNumber(player.maxShieldHp, 0),
        inventoryLength: Array.isArray(player.inventory)
            ? player.inventory.length
            : Math.max(0, Math.trunc(toFiniteNumber(player.inventoryLength, 0))),
    };
}

export function buildTrainerRuntimeObservationPayload(runtimeContext = {}, player = null) {
    const rawMode = typeof runtimeContext?.mode === 'string'
        ? runtimeContext.mode
        : '';
    const planarMode = resolvePlanarMode(runtimeContext);
    const controlProfileId = resolveControlProfileId(runtimeContext, rawMode, planarMode);
    const domain = deriveTrainingDomain({
        mode: rawMode,
        planarMode,
        controlProfileId,
    });

    const lifted = liftObservationWithRuntimeNearContext(runtimeContext?.observation, {
        expectedLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        environmentProfile: runtimeContext?.environmentProfile || runtimeContext?.trainingEnvironmentProfile || undefined,
        metadata: runtimeContext?.observationContext,
        player,
    });
    return {
        mode: rawMode,
        planarMode,
        controlProfileId: domain.controlProfileId,
        domainId: domain.domainId,
        domainVersion: domain.version,
        dt: toFiniteNumber(runtimeContext?.dt, 0),
        observationSchemaVersion: OBSERVATION_SCHEMA_VERSION_V2,
        observationLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        observation: cloneObservation(lifted.observation),
        observationContext: lifted.details,
        player: buildPlayerPayload(player),
    };
}

function cloneSerializable(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        return value.map((entry) => cloneSerializable(entry));
    }
    if (typeof value !== 'object') {
        return value;
    }
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined || typeof entry === 'function') {
            continue;
        }
        clone[key] = cloneSerializable(entry);
    }
    return clone;
}

export function buildTrainerTransitionPayload(transition = {}, options = {}) {
    const info = transition?.info && typeof transition.info === 'object'
        ? transition.info
        : {};
    const domainSource = info.domain && typeof info.domain === 'object'
        ? info.domain
        : options;
    const domain = deriveTrainingDomain({
        ...domainSource,
        controlProfileId: domainSource?.controlProfileId ?? options.controlProfileId,
    });

    const metadata = info.metadata && typeof info.metadata === 'object'
        ? info.metadata
        : {};
    const lifted = liftObservationWithRuntimeNearContext(transition.observation, {
        expectedLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        environmentProfile: metadata.environmentProfile
            || options?.environmentProfile
            || undefined,
        metadata,
        intent: metadata?.hybridDecision?.intent?.applied
            || metadata?.hybridDecision?.intent?.requested
            || null,
    });
    return {
        contractVersion: TRAINING_CONTRACT_VERSION,
        observationSchemaVersion: OBSERVATION_SCHEMA_VERSION_V2,
        observationLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        operation: typeof transition.operation === 'string' ? transition.operation : 'step',
        episodeId: typeof transition.episodeId === 'string' ? transition.episodeId : null,
        episodeIndex: Number.isInteger(transition.episodeIndex) ? transition.episodeIndex : 0,
        stepIndex: Number.isInteger(transition.stepIndex) ? transition.stepIndex : 0,
        reward: toFiniteNumber(transition.reward, 0),
        done: !!transition.done,
        truncated: !!transition.truncated,
        observation: cloneObservation(lifted.observation),
        action: transition.action && typeof transition.action === 'object'
            ? { ...transition.action }
            : null,
        info: {
            domain,
            terminalReason: typeof info.terminalReason === 'string' ? info.terminalReason : null,
            truncatedReason: typeof info.truncatedReason === 'string' ? info.truncatedReason : null,
            rewardBreakdown: info.rewardBreakdown && typeof info.rewardBreakdown === 'object'
                ? { ...info.rewardBreakdown }
                : null,
            match: info.match && typeof info.match === 'object'
                ? { ...info.match }
                : null,
            observationContext: lifted.details,
            hybridDecision: metadata.hybridDecision && typeof metadata.hybridDecision === 'object'
                ? { ...metadata.hybridDecision }
                : null,
            metadata: cloneSerializable(metadata) || {},
            effectiveEnvironment: metadata.effectiveEnvironment && typeof metadata.effectiveEnvironment === 'object'
                ? cloneSerializable(metadata.effectiveEnvironment)
                : null,
            episodeSemantics: metadata.episodeSemantics && typeof metadata.episodeSemantics === 'object'
                ? cloneSerializable(metadata.episodeSemantics)
                : null,
        },
        kernelRuntime: options.kernelRuntime && typeof options.kernelRuntime === 'object'
            ? cloneSerializable(options.kernelRuntime)
            : null,
    };
}

export function createTrainerTransportEnvelope(type, id, payload, options = {}) {
    const envelope = {
        type: typeof type === 'string' && type.trim() ? type.trim() : 'training-step',
        id: Number.isInteger(id) ? id : 0,
        payload,
    };
    if (typeof options.contractVersion === 'string' && options.contractVersion.trim()) {
        envelope.contractVersion = options.contractVersion.trim();
    }
    const sentAtMs = toFiniteNumber(options.sentAtMs, -1);
    if (sentAtMs >= 0) {
        envelope.sentAtMs = Math.trunc(sentAtMs);
    }
    return envelope;
}
