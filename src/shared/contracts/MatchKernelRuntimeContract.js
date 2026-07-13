import { createRuntimeClock, RUNTIME_CLOCK_CONTRACT_VERSION } from './RuntimeClockContract.js';
import { RUNTIME_RNG_CONTRACT_VERSION } from './RuntimeRngContract.js';
import { createSessionRuntimeSnapshot, SESSION_RUNTIME_SNAPSHOT_CONTRACT_VERSION } from './SessionRuntimeSnapshotContract.js';
import { normalizeString } from './ContractNormalizeUtils.js';

export const MATCH_KERNEL_RUN_PROFILE_CONTRACT_VERSION = 'match-kernel-run-profile.v1';
export const MATCH_KERNEL_CLOCK_PORT_CONTRACT_VERSION = 'match-kernel-clock-port.v1';
export const MATCH_KERNEL_TICK_ENVELOPE_CONTRACT_VERSION = 'match-kernel-tick-envelope.v1';
export const MATCH_KERNEL_SEED_ENVELOPE_CONTRACT_VERSION = 'match-kernel-seed-envelope.v1';
export const MATCH_KERNEL_INPUT_FRAME_CONTRACT_VERSION = 'match-kernel-input-frame.v1';
export const MATCH_KERNEL_SNAPSHOT_ENVELOPE_CONTRACT_VERSION = 'match-kernel-snapshot-envelope.v1';
export const MATCH_KERNEL_FIXED_STEP_SECONDS = 1 / 60;

export const MATCH_KERNEL_SURFACES = Object.freeze({
    INTERACTIVE: 'interactive',
    HEADLESS: 'headless',
});

export const MATCH_KERNEL_TICK_DRIVERS = Object.freeze({
    RAF: 'raf',
    MANUAL: 'manual',
});

export const MATCH_KERNEL_CLOCK_MODES = Object.freeze({
    REALTIME: 'realtime',
    SYNTHETIC: 'synthetic',
});

export const MATCH_KERNEL_INPUT_SOURCES = Object.freeze({
    LIVE: 'live',
    BUFFERED: 'buffered',
    REPLAY: 'replay',
    NETWORK: 'network',
    TRAINING: 'training',
});

export const MATCH_KERNEL_SNAPSHOT_TARGETS = Object.freeze({
    PROJECTION: 'projection',
    CHECKPOINT: 'checkpoint',
    TRANSPORT: 'transport',
    OBSERVABILITY: 'observability',
});

export const MATCH_KERNEL_INPUT_ACTION_KEYS = Object.freeze([
    'pitchUp',
    'pitchDown',
    'yawLeft',
    'yawRight',
    'rollLeft',
    'rollRight',
    'boost',
    'boostPressed',
    'cameraSwitch',
    'dropItem',
    'useItem',
    'shootItem',
    'shootMG',
    'nextItem',
]);

const VALID_SURFACE_SET = new Set(Object.values(MATCH_KERNEL_SURFACES));
const VALID_TICK_DRIVER_SET = new Set(Object.values(MATCH_KERNEL_TICK_DRIVERS));
const VALID_CLOCK_MODE_SET = new Set(Object.values(MATCH_KERNEL_CLOCK_MODES));
const VALID_INPUT_SOURCE_SET = new Set(Object.values(MATCH_KERNEL_INPUT_SOURCES));
const VALID_SNAPSHOT_TARGET_SET = new Set(Object.values(MATCH_KERNEL_SNAPSHOT_TARGETS));

function normalizeNullableString(value) {
    const normalized = normalizeString(value, '');
    return normalized || null;
}

function normalizeEnum(value, validSet, fallback) {
    const normalized = normalizeString(value, '').toLowerCase();
    return validSet.has(normalized) ? normalized : fallback;
}

function normalizeNonNegativeInt(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.floor(numeric));
}

function normalizeNonNegativeNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, numeric);
}

function normalizePositiveNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return numeric;
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined) return fallback;
    return value === true;
}

function normalizeStringArray(values) {
    if (!Array.isArray(values)) return [];
    return values
        .map((value) => normalizeString(value, ''))
        .filter(Boolean);
}

function cloneSerializableValue(value) {
    if (value === null) return null;
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => cloneSerializableValue(entry))
            .filter((entry) => entry !== undefined);
    }
    if (typeof value !== 'object') {
        return value;
    }

    const cloned = {};
    for (const [key, entry] of Object.entries(value)) {
        const nextValue = cloneSerializableValue(entry);
        if (nextValue !== undefined) {
            cloned[key] = nextValue;
        }
    }
    return cloned;
}

function resolveDefaultRunShape(surface) {
    if (surface === MATCH_KERNEL_SURFACES.HEADLESS) {
        return {
            tickDriver: MATCH_KERNEL_TICK_DRIVERS.MANUAL,
            clockMode: MATCH_KERNEL_CLOCK_MODES.SYNTHETIC,
            inputSource: MATCH_KERNEL_INPUT_SOURCES.BUFFERED,
            snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.CHECKPOINT,
            supportsRenderInterpolation: false,
        };
    }

    return {
        tickDriver: MATCH_KERNEL_TICK_DRIVERS.RAF,
        clockMode: MATCH_KERNEL_CLOCK_MODES.REALTIME,
        inputSource: MATCH_KERNEL_INPUT_SOURCES.LIVE,
        snapshotTarget: MATCH_KERNEL_SNAPSHOT_TARGETS.PROJECTION,
        supportsRenderInterpolation: true,
    };
}

function resolveRunProfileInput(payload = {}) {
    return payload && typeof payload === 'object' ? payload : {};
}

function normalizePlayerInputActions(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const actions = {};
    for (const key of MATCH_KERNEL_INPUT_ACTION_KEYS) {
        actions[key] = source[key] === true;
    }
    return actions;
}

export function createMatchKernelRunProfile(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const surface = normalizeEnum(
        source.surface,
        VALID_SURFACE_SET,
        MATCH_KERNEL_SURFACES.INTERACTIVE
    );
    const defaults = resolveDefaultRunShape(surface);

    return {
        contractVersion: MATCH_KERNEL_RUN_PROFILE_CONTRACT_VERSION,
        surface,
        tickDriver: normalizeEnum(source.tickDriver, VALID_TICK_DRIVER_SET, defaults.tickDriver),
        clockMode: normalizeEnum(source.clockMode, VALID_CLOCK_MODE_SET, defaults.clockMode),
        fixedStepSeconds: normalizePositiveNumber(source.fixedStepSeconds, MATCH_KERNEL_FIXED_STEP_SECONDS),
        inputSource: normalizeEnum(source.inputSource, VALID_INPUT_SOURCE_SET, defaults.inputSource),
        snapshotTarget: normalizeEnum(source.snapshotTarget, VALID_SNAPSHOT_TARGET_SET, defaults.snapshotTarget),
        supportsRenderInterpolation: normalizeBoolean(
            source.supportsRenderInterpolation,
            defaults.supportsRenderInterpolation
        ),
        deterministic: normalizeBoolean(source.deterministic, true),
        sessionId: normalizeNullableString(source.sessionId),
        matchId: normalizeNullableString(source.matchId),
        modeId: normalizeNullableString(source.modeId),
    };
}

export function createInteractiveMatchKernelRunProfile(payload = {}) {
    return createMatchKernelRunProfile({
        ...(payload && typeof payload === 'object' ? payload : {}),
        surface: MATCH_KERNEL_SURFACES.INTERACTIVE,
    });
}

export function createHeadlessMatchKernelRunProfile(payload = {}) {
    return createMatchKernelRunProfile({
        ...(payload && typeof payload === 'object' ? payload : {}),
        surface: MATCH_KERNEL_SURFACES.HEADLESS,
    });
}

export function createMatchKernelClockPort(options = {}) {
    const source = resolveRunProfileInput(options);
    const profile = createMatchKernelRunProfile(source.profile || source);
    return {
        contractVersion: MATCH_KERNEL_CLOCK_PORT_CONTRACT_VERSION,
        surface: profile.surface,
        clockMode: profile.clockMode,
        fixedStepSeconds: profile.fixedStepSeconds,
        monotonic: normalizeBoolean(source.monotonic, true),
        wallClockOwnedByDriver: normalizeBoolean(
            source.wallClockOwnedByDriver,
            profile.surface === MATCH_KERNEL_SURFACES.INTERACTIVE
        ),
        runtimeClockContractVersion: RUNTIME_CLOCK_CONTRACT_VERSION,
        clock: createRuntimeClock({
            runtime: source.runtimeClockRuntime || source.runtime || null,
            nowMs: source.nowMs,
            nowHighRes: source.nowHighRes,
        }),
    };
}

export function createMatchKernelTickEnvelope(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const profile = createMatchKernelRunProfile(source.profile || source);
    const fixedStepSeconds = normalizePositiveNumber(source.fixedStepSeconds, profile.fixedStepSeconds);
    const tickIndex = normalizeNonNegativeInt(source.tickIndex);
    const elapsedSeconds = Object.prototype.hasOwnProperty.call(source, 'elapsedSeconds')
        ? normalizeNonNegativeNumber(source.elapsedSeconds, tickIndex * fixedStepSeconds)
        : (tickIndex * fixedStepSeconds);

    return {
        contractVersion: MATCH_KERNEL_TICK_ENVELOPE_CONTRACT_VERSION,
        surface: profile.surface,
        tickDriver: normalizeEnum(source.tickDriver, VALID_TICK_DRIVER_SET, profile.tickDriver),
        tickIndex,
        fixedStepSeconds,
        elapsedSeconds,
        wallClockMs: normalizeNonNegativeInt(source.wallClockMs),
        highResTimestampMs: normalizeNonNegativeNumber(source.highResTimestampMs),
        frameId: normalizeNonNegativeInt(source.frameId),
        timeScale: normalizePositiveNumber(source.timeScale, 1),
        reset: normalizeBoolean(source.reset, false),
        resetReason: normalizeString(source.resetReason, ''),
        tags: normalizeStringArray(source.tags),
    };
}

export function createMatchKernelSeedEnvelope(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const profile = createMatchKernelRunProfile(source.profile || source);
    const matchSeed = normalizeNonNegativeInt(source.matchSeed);
    const roundSeed = Object.prototype.hasOwnProperty.call(source, 'roundSeed')
        ? normalizeNonNegativeInt(source.roundSeed, matchSeed)
        : matchSeed;
    const tickSeed = Object.prototype.hasOwnProperty.call(source, 'tickSeed')
        ? normalizeNonNegativeInt(source.tickSeed, roundSeed)
        : roundSeed;

    return {
        contractVersion: MATCH_KERNEL_SEED_ENVELOPE_CONTRACT_VERSION,
        surface: profile.surface,
        deterministic: normalizeBoolean(source.deterministic, profile.deterministic),
        matchSeed,
        roundSeed,
        tickSeed,
        streamId: normalizeString(source.streamId, 'match'),
        rngContractVersion: RUNTIME_RNG_CONTRACT_VERSION,
        tags: normalizeStringArray(source.tags),
    };
}

export function createMatchKernelPlayerInputState(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const actionSource = source.actions && typeof source.actions === 'object'
        ? source.actions
        : source;

    return {
        playerIndex: normalizeNonNegativeInt(source.playerIndex),
        playerId: normalizeNullableString(source.playerId),
        deviceId: normalizeNullableString(source.deviceId),
        sourceType: normalizeString(source.sourceType, ''),
        actions: normalizePlayerInputActions(actionSource),
    };
}

export function createMatchKernelInputFrame(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const profile = createMatchKernelRunProfile(source.profile || source);
    const tickIndex = normalizeNonNegativeInt(source.tickIndex);
    const sequence = Object.prototype.hasOwnProperty.call(source, 'sequence')
        ? normalizeNonNegativeInt(source.sequence, tickIndex)
        : tickIndex;
    const fallbackCapturedAtMs = normalizeNonNegativeInt(source.wallClockMs);
    const players = Array.isArray(source.players)
        ? source.players.map((player) => createMatchKernelPlayerInputState(player))
        : [];

    return {
        contractVersion: MATCH_KERNEL_INPUT_FRAME_CONTRACT_VERSION,
        surface: profile.surface,
        inputSource: normalizeEnum(source.inputSource, VALID_INPUT_SOURCE_SET, profile.inputSource),
        tickIndex,
        sequence,
        capturedAtMs: normalizeNonNegativeInt(source.capturedAtMs, fallbackCapturedAtMs),
        deterministic: normalizeBoolean(source.deterministic, profile.deterministic),
        players,
        commands: normalizeStringArray(source.commands),
        tags: normalizeStringArray(source.tags),
    };
}

export function createMatchKernelSnapshotEnvelope(payload = {}) {
    const source = resolveRunProfileInput(payload);
    const profile = createMatchKernelRunProfile(source.profile || source);
    const tickIndex = normalizeNonNegativeInt(source.tickIndex);
    const sequence = Object.prototype.hasOwnProperty.call(source, 'sequence')
        ? normalizeNonNegativeInt(source.sequence, tickIndex)
        : tickIndex;
    const fallbackCapturedAtMs = normalizeNonNegativeInt(source.wallClockMs);

    return {
        contractVersion: MATCH_KERNEL_SNAPSHOT_ENVELOPE_CONTRACT_VERSION,
        surface: profile.surface,
        snapshotTarget: normalizeEnum(
            source.snapshotTarget,
            VALID_SNAPSHOT_TARGET_SET,
            profile.snapshotTarget
        ),
        tickIndex,
        sequence,
        capturedAtMs: normalizeNonNegativeInt(source.capturedAtMs, fallbackCapturedAtMs),
        sessionRuntimeSnapshot: createSessionRuntimeSnapshot(source.sessionRuntimeSnapshot),
        gameStateSnapshot: cloneSerializableValue(source.gameStateSnapshot) || null,
        simStateSnapshot: cloneSerializableValue(source.simStateSnapshot) || null,
        runtimeProjection: cloneSerializableValue(source.runtimeProjection) || null,
        checksum: normalizeString(source.checksum, ''),
        sessionSnapshotContractVersion: SESSION_RUNTIME_SNAPSHOT_CONTRACT_VERSION,
        tags: normalizeStringArray(source.tags),
    };
}
