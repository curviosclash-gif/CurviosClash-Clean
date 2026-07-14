import { createMatchKernelConsumerAdapter } from '../../../../src/state/MatchKernelConsumerAdapters.js';
import {
    MATCH_KERNEL_INPUT_SOURCES,
    MATCH_KERNEL_SNAPSHOT_TARGETS,
} from '../../../../src/shared/contracts/MatchKernelRuntimeContract.js';

export const MATCH_KERNEL_TRAINING_CONSUMER_ID = 'training';

function cloneSerializable(value) {
    if (!value || typeof value !== 'object') return value ?? null;
    if (Array.isArray(value)) return value.map((entry) => cloneSerializable(entry));
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined || typeof entry === 'function') continue;
        clone[key] = cloneSerializable(entry);
    }
    return clone;
}

export function createMatchKernelTrainingConsumerAdapter(options = {}) {
    const profile = options.profile && typeof options.profile === 'object'
        ? options.profile
        : {};
    return createMatchKernelConsumerAdapter({
        ...options,
        consumerId: MATCH_KERNEL_TRAINING_CONSUMER_ID,
        profile: {
            ...profile,
            inputSource: MATCH_KERNEL_INPUT_SOURCES.TRAINING,
            snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.OBSERVABILITY,
            supportsRenderInterpolation: false,
        },
    });
}

export function createMatchKernelTrainingPayload({
    type = 'training-step',
    transition = null,
    input = {},
    profile = null,
} = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const descriptorAdapter = createMatchKernelTrainingConsumerAdapter({
        profile: {
            ...(profile && typeof profile === 'object' ? profile : {}),
            matchId: profile?.matchId ?? source.matchId ?? transition?.info?.match?.matchId ?? null,
            modeId: profile?.modeId ?? transition?.info?.domain?.mode ?? source.mode ?? null,
        },
    });
    const transitionStepIndex = Number.isInteger(transition?.stepIndex) ? transition.stepIndex : 0;
    const seedBase = Number.isFinite(Number(source.seed))
        ? Math.max(0, Math.trunc(Number(source.seed)))
        : 0;
    const actionSource = transition?.action && typeof transition.action === 'object'
        ? transition.action
        : (source.action && typeof source.action === 'object' ? source.action : null);
    const players = actionSource
        ? [{
            playerIndex: 0,
            playerId: 'training-agent',
            sourceType: type,
            actions: actionSource,
        }]
        : [];
    const kernelRuntime = {
        consumer: descriptorAdapter.getDescriptor(),
        seedEnvelope: descriptorAdapter.createSeedEnvelope({
            matchSeed: seedBase,
            roundSeed: seedBase,
            tickSeed: seedBase + transitionStepIndex,
            streamId: 'training',
            tags: [type],
        }),
        inputFrame: descriptorAdapter.createInputFrame({
            tickIndex: transitionStepIndex,
            sequence: transitionStepIndex,
            capturedAtMs: transitionStepIndex,
            players,
            tags: [type],
        }),
    };
    descriptorAdapter.dispose();
    return cloneSerializable(kernelRuntime);
}
