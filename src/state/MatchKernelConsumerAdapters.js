import {
    MATCH_KERNEL_CLOCK_MODES,
    MATCH_KERNEL_INPUT_SOURCES,
    MATCH_KERNEL_SNAPSHOT_TARGETS,
    MATCH_KERNEL_SURFACES,
    MATCH_KERNEL_TICK_DRIVERS,
    createHeadlessMatchKernelRunProfile,
    createInteractiveMatchKernelRunProfile,
    createMatchKernelInputFrame,
    createMatchKernelSeedEnvelope,
    createMatchKernelSnapshotEnvelope,
    createMatchKernelTickEnvelope,
} from '../shared/contracts/MatchKernelRuntimeContract.js';
import { createHeadlessInputAdapter } from './MatchKernel.js';

export const MATCH_KERNEL_CONSUMER_ADAPTER_CONTRACT_VERSION = 'match-kernel-consumer-adapter.v1';
export const MATCH_KERNEL_CONSUMER_REGISTRY_CONTRACT_VERSION = 'match-kernel-consumer-registry.v1';

export const MATCH_KERNEL_CONSUMER_IDS = Object.freeze({
    INTERACTIVE: 'interactive',
    REPLAY: 'replay',
    TRAINING: 'training',
    NETWORK: 'network',
});

function toProvider(value) {
    if (typeof value === 'function') {
        return value;
    }
    return () => value || null;
}

function resolveConsumerId(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === MATCH_KERNEL_CONSUMER_IDS.REPLAY) return MATCH_KERNEL_CONSUMER_IDS.REPLAY;
    if (normalized === MATCH_KERNEL_CONSUMER_IDS.TRAINING) return MATCH_KERNEL_CONSUMER_IDS.TRAINING;
    if (normalized === MATCH_KERNEL_CONSUMER_IDS.NETWORK) return MATCH_KERNEL_CONSUMER_IDS.NETWORK;
    return MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE;
}

function resolveSessionSimPorts(session = null) {
    return {
        entityManager: session?.entityManager || null,
        powerupManager: session?.powerupManager || null,
        particles: session?.particles || null,
        arena: session?.arena || null,
    };
}

function resolveSerializableClone(value) {
    if (!value || typeof value !== 'object') {
        return value ?? null;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => resolveSerializableClone(entry));
    }
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined || typeof entry === 'function') {
            continue;
        }
        clone[key] = resolveSerializableClone(entry);
    }
    return clone;
}

function resolveProfileFactory(consumerId) {
    if (consumerId === MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE) {
        return createInteractiveMatchKernelRunProfile;
    }
    return createHeadlessMatchKernelRunProfile;
}

function createProfileByConsumerId(consumerId, payload = {}) {
    const profileFactory = resolveProfileFactory(consumerId);
    const source = payload && typeof payload === 'object' ? payload : {};
    if (consumerId === MATCH_KERNEL_CONSUMER_IDS.REPLAY) {
        return profileFactory({
            ...source,
            surface: MATCH_KERNEL_SURFACES.HEADLESS,
            tickDriver: MATCH_KERNEL_TICK_DRIVERS.MANUAL,
            clockMode: MATCH_KERNEL_CLOCK_MODES.SYNTHETIC,
            inputSource: MATCH_KERNEL_INPUT_SOURCES.REPLAY,
            snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.CHECKPOINT,
            supportsRenderInterpolation: false,
            deterministic: source.deterministic !== false,
        });
    }
    if (consumerId === MATCH_KERNEL_CONSUMER_IDS.TRAINING) {
        return profileFactory({
            ...source,
            surface: MATCH_KERNEL_SURFACES.HEADLESS,
            tickDriver: MATCH_KERNEL_TICK_DRIVERS.MANUAL,
            clockMode: MATCH_KERNEL_CLOCK_MODES.SYNTHETIC,
            inputSource: MATCH_KERNEL_INPUT_SOURCES.TRAINING,
            snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.OBSERVABILITY,
            supportsRenderInterpolation: false,
            deterministic: source.deterministic !== false,
        });
    }
    if (consumerId === MATCH_KERNEL_CONSUMER_IDS.NETWORK) {
        return profileFactory({
            ...source,
            surface: MATCH_KERNEL_SURFACES.HEADLESS,
            tickDriver: MATCH_KERNEL_TICK_DRIVERS.MANUAL,
            clockMode: MATCH_KERNEL_CLOCK_MODES.SYNTHETIC,
            inputSource: MATCH_KERNEL_INPUT_SOURCES.NETWORK,
            snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.TRANSPORT,
            supportsRenderInterpolation: false,
            deterministic: source.deterministic !== false,
        });
    }
    return profileFactory({
        ...source,
        surface: MATCH_KERNEL_SURFACES.INTERACTIVE,
        tickDriver: MATCH_KERNEL_TICK_DRIVERS.RAF,
        clockMode: MATCH_KERNEL_CLOCK_MODES.REALTIME,
        inputSource: MATCH_KERNEL_INPUT_SOURCES.LIVE,
        snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.PROJECTION,
        supportsRenderInterpolation: source.supportsRenderInterpolation !== false,
        deterministic: source.deterministic !== false,
    });
}

function resolveKernelProfile(kernel = null, profile = null, session = null, consumerId = MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE) {
    const kernelProfile = kernel?.profile && typeof kernel.profile === 'object'
        ? kernel.profile
        : {};
    const profileSource = profile && typeof profile === 'object'
        ? profile
        : {};
    return createProfileByConsumerId(consumerId, {
        ...kernelProfile,
        ...profileSource,
        matchId: profileSource.matchId ?? kernelProfile.matchId ?? session?.effectiveMapKey ?? null,
        modeId: profileSource.modeId ?? kernelProfile.modeId ?? session?.entityManager?.activeGameMode ?? null,
        sessionId: profileSource.sessionId ?? kernelProfile.sessionId ?? null,
        fixedStepSeconds: profileSource.fixedStepSeconds ?? kernelProfile.fixedStepSeconds,
    });
}

function resolveGameStateSnapshot(gameStateSnapshotProvider, explicitSnapshot) {
    if (explicitSnapshot !== undefined) {
        return explicitSnapshot ?? null;
    }
    return gameStateSnapshotProvider() || null;
}

function resolveSessionRuntimeSnapshot(sessionRuntimeProvider, explicitSnapshot) {
    if (explicitSnapshot !== undefined) {
        return explicitSnapshot ?? null;
    }
    return sessionRuntimeProvider() || null;
}

export class MatchKernelConsumerAdapter {
    constructor(options = {}) {
        this._consumerId = resolveConsumerId(options.consumerId);
        this._kernel = options.kernel || null;
        this._allowKernelTick = options.allowKernelTick === true;
        this._sessionProvider = toProvider(options.sessionProvider);
        this._sessionRuntimeProvider = toProvider(options.sessionRuntimeProvider);
        this._gameStateSnapshotProvider = toProvider(options.gameStateSnapshotProvider);
        this._profile = resolveKernelProfile(
            this._kernel,
            options.profile,
            this._sessionProvider(),
            this._consumerId
        );
    }

    get contractVersion() {
        return MATCH_KERNEL_CONSUMER_ADAPTER_CONTRACT_VERSION;
    }

    get consumerId() {
        return this._consumerId;
    }

    get kernel() {
        return this._kernel;
    }

    get profile() {
        return this._profile ? { ...this._profile } : null;
    }

    get allowKernelTick() {
        return this._allowKernelTick;
    }

    getDescriptor() {
        return {
            contractVersion: this.contractVersion,
            consumerId: this.consumerId,
            allowKernelTick: this.allowKernelTick,
            profile: this.profile,
        };
    }

    createTickEnvelope(payload = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        return createMatchKernelTickEnvelope({
            ...source,
            profile: this._profile,
            tickIndex: source.tickIndex ?? this._kernel?.tickIndex ?? 0,
            fixedStepSeconds: source.fixedStepSeconds ?? this._profile?.fixedStepSeconds,
        });
    }

    createSeedEnvelope(payload = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        return createMatchKernelSeedEnvelope({
            ...source,
            profile: this._profile,
        });
    }

    createInputFrame(payload = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        return createMatchKernelInputFrame({
            ...source,
            profile: this._profile,
            inputSource: source.inputSource ?? this._profile?.inputSource,
            tickIndex: source.tickIndex ?? this._kernel?.tickIndex ?? 0,
        });
    }

    createSnapshotEnvelope(payload = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        return createMatchKernelSnapshotEnvelope({
            ...source,
            profile: this._profile,
            snapshotTarget: source.snapshotTarget ?? this._profile?.snapshotTarget,
            tickIndex: source.tickIndex ?? this._kernel?.tickIndex ?? 0,
            sessionRuntimeSnapshot: resolveSessionRuntimeSnapshot(
                this._sessionRuntimeProvider,
                source.sessionRuntimeSnapshot
            ),
            gameStateSnapshot: resolveGameStateSnapshot(
                this._gameStateSnapshotProvider,
                source.gameStateSnapshot
            ),
            simStateSnapshot: source.simStateSnapshot === undefined
                ? null
                : source.simStateSnapshot,
            runtimeProjection: source.runtimeProjection === undefined
                ? null
                : source.runtimeProjection,
        });
    }

    updateSimPortsFromSession(session = undefined) {
        if (!this._kernel?.updateSimPorts) {
            return null;
        }
        const nextSession = session === undefined ? this._sessionProvider() : session;
        this._kernel.updateSimPorts(resolveSessionSimPorts(nextSession));
        return this._kernel;
    }

    step(inputFrame = null, tickOptions = {}) {
        if (!this._allowKernelTick || !this._kernel) {
            return null;
        }
        const normalizedInputFrame = this.createInputFrame(inputFrame || {
            tickIndex: tickOptions?.tickIndex ?? this._kernel.tickIndex,
            players: [],
        });
        const tickEnvelope = this.createTickEnvelope(tickOptions);
        return this._kernel.tick(tickEnvelope, createHeadlessInputAdapter(normalizedInputFrame));
    }

    dispose() {
        this._kernel = null;
        this._profile = null;
        this._sessionProvider = () => null;
        this._sessionRuntimeProvider = () => null;
        this._gameStateSnapshotProvider = () => null;
    }
}

export function createMatchKernelConsumerAdapter(options = {}) {
    return new MatchKernelConsumerAdapter(options);
}

export function createMatchKernelConsumerRegistry(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const buildAdapter = (consumerId) => createMatchKernelConsumerAdapter({
        ...source,
        consumerId,
    });
    const registry = {
        contractVersion: MATCH_KERNEL_CONSUMER_REGISTRY_CONTRACT_VERSION,
        interactive: buildAdapter(MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE),
        replay: buildAdapter(MATCH_KERNEL_CONSUMER_IDS.REPLAY),
        training: buildAdapter(MATCH_KERNEL_CONSUMER_IDS.TRAINING),
        network: buildAdapter(MATCH_KERNEL_CONSUMER_IDS.NETWORK),
        getAdapter(consumerId) {
            const normalized = resolveConsumerId(consumerId);
            if (normalized === MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE) return this.interactive;
            if (normalized === MATCH_KERNEL_CONSUMER_IDS.REPLAY) return this.replay;
            if (normalized === MATCH_KERNEL_CONSUMER_IDS.TRAINING) return this.training;
            if (normalized === MATCH_KERNEL_CONSUMER_IDS.NETWORK) return this.network;
            return null;
        },
        getDescriptor(consumerId) {
            return this.getAdapter(consumerId)?.getDescriptor?.() || null;
        },
        getDescriptors() {
            return {
                interactive: this.interactive?.getDescriptor?.() || null,
                replay: this.replay?.getDescriptor?.() || null,
                training: this.training?.getDescriptor?.() || null,
                network: this.network?.getDescriptor?.() || null,
            };
        },
        dispose() {
            this.interactive?.dispose?.();
            this.replay?.dispose?.();
            this.training?.dispose?.();
            this.network?.dispose?.();
        },
    };
    return registry;
}

export function createMatchKernelTrainingPayload({
    type = 'training-step',
    transition = null,
    input = {},
    profile = null,
} = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const descriptorAdapter = createMatchKernelConsumerAdapter({
        consumerId: MATCH_KERNEL_CONSUMER_IDS.TRAINING,
        profile: {
            ...(profile && typeof profile === 'object' ? profile : {}),
            matchId: profile?.matchId ?? source.matchId ?? transition?.info?.match?.matchId ?? null,
            modeId: profile?.modeId ?? transition?.info?.domain?.mode ?? source.mode ?? null,
        },
    });
    const transitionStepIndex = Number.isInteger(transition?.stepIndex) ? transition.stepIndex : 0;
    const seedBase = Number.isFinite(Number(source.seed)) ? Math.max(0, Math.trunc(Number(source.seed))) : 0;
    const actionSource = transition?.action && typeof transition.action === 'object'
        ? transition.action
        : (source.action && typeof source.action === 'object' ? source.action : null);
    const playerPayload = actionSource
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
            players: playerPayload,
            tags: [type],
        }),
    };
    descriptorAdapter.dispose();
    return resolveSerializableClone(kernelRuntime);
}
