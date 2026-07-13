// ============================================
// MenuDeveloperTrainingEventPayload.js - builders for developer training menu events
// ============================================

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

function toNonNegativeNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, numeric);
}

function toFloat(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const clampedMin = Number.isFinite(Number(min)) ? Number(min) : numeric;
    const clampedMax = Number.isFinite(Number(max)) ? Number(max) : numeric;
    return Math.max(clampedMin, Math.min(clampedMax, numeric));
}

function parseCsvIntegers(rawValue, fallbackList = [0], min = 0, max = Number.MAX_SAFE_INTEGER) {
    const raw = typeof rawValue === 'string' ? rawValue : '';
    const values = raw
        .split(/[,\s;]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((token) => Number(token))
        .filter((numeric) => Number.isFinite(numeric))
        .map((numeric) => Math.max(min, Math.min(max, Math.trunc(numeric))));
    if (values.length === 0) return [...fallbackList];
    return Array.from(new Set(values));
}

function normalizeDomainToken(token) {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'classic' || normalized === 'classic-3d' || normalized === 'classic3d') return 'classic-3d';
    if (normalized === 'classic-2d' || normalized === 'classic2d' || normalized === 'planar') return 'classic-2d';
    if (normalized === 'hunt' || normalized === 'fight' || normalized === 'hunt-3d' || normalized === 'hunt3d' || normalized === 'fight-3d' || normalized === 'fight3d') return 'hunt-3d';
    if (normalized === 'hunt-2d' || normalized === 'hunt2d' || normalized === 'fight-2d' || normalized === 'fight2d') return 'hunt-2d';
    return null;
}

function parseCsvDomains(rawValue, fallbackList = ['classic-3d']) {
    const raw = typeof rawValue === 'string' ? rawValue : '';
    const values = raw
        .split(/[,\s;]+/)
        .map((token) => normalizeDomainToken(token))
        .filter((token) => !!token);
    if (values.length === 0) return [...fallbackList];
    return Array.from(new Set(values));
}

function resolveCommonTrainingConfig(ui) {
    return {
        mode: toTrimmedString(ui?.developerTrainingModeSelect?.value, 'classic'),
        planarMode: !!ui?.developerTrainingPlanarToggle?.checked,
        maxSteps: toInt(ui?.developerTrainingMaxStepsInput?.value, 180, 1, 1000000),
        seed: toInt(ui?.developerTrainingSeedInput?.value, 0, 0, 1000000),
        inventoryLength: toInt(ui?.developerTrainingInventoryInput?.value, 2, 0, 20),
    };
}

function resolveAction(ui) {
    const yawIntent = toInt(ui?.developerTrainingYawSelect?.value, 0, -1, 1);
    const pitchIntent = toInt(ui?.developerTrainingPitchSelect?.value, 0, -1, 1);
    return {
        yawLeft: yawIntent < 0,
        yawRight: yawIntent > 0,
        pitchDown: pitchIntent < 0,
        pitchUp: pitchIntent > 0,
        boost: !!ui?.developerTrainingBoostToggle?.checked,
        shootMG: !!ui?.developerTrainingShootMgToggle?.checked,
        shootItem: !!ui?.developerTrainingShootItemToggle?.checked,
        shootItemIndex: toInt(ui?.developerTrainingShootItemIndexInput?.value, -1, -1, 20),
    };
}

function resolveRewardSignals(ui) {
    return {
        survival: true,
        kills: toInt(ui?.developerTrainingKillsInput?.value, 0, 0, 10000),
        damageDealt: toNonNegativeNumber(ui?.developerTrainingDamageDealtInput?.value, 0),
        damageTaken: toNonNegativeNumber(ui?.developerTrainingDamageTakenInput?.value, 0),
        itemUses: toInt(ui?.developerTrainingItemUsesInput?.value, 0, 0, 10000),
        crashed: !!ui?.developerTrainingCrashedToggle?.checked,
        stuck: !!ui?.developerTrainingStuckToggle?.checked,
        won: !!ui?.developerTrainingWonToggle?.checked,
        lost: !!ui?.developerTrainingLostToggle?.checked,
    };
}

function resolveAutomationConfig(ui) {
    const common = resolveCommonTrainingConfig(ui);
    return {
        episodes: toInt(ui?.developerTrainingBatchEpisodesInput?.value, 3, 1, 500),
        seeds: parseCsvIntegers(ui?.developerTrainingBatchSeedsInput?.value, [3, 7, 11], 0, 1_000_000),
        modes: parseCsvDomains(ui?.developerTrainingBatchModesInput?.value, ['classic-3d', 'hunt-3d']),
        maxSteps: common.maxSteps,
        bridgeMode: toTrimmedString(ui?.developerTrainingBridgeModeSelect?.value, 'local').toLowerCase(),
        timeoutMs: toInt(ui?.developerTrainingTimeoutMsInput?.value, 800, 10, 120_000),
    };
}

function resolveGateThresholds(ui) {
    return {
        minEpisodeReturnMean: toFloat(ui?.developerTrainingGateMinReturnInput?.value, 0.1, -1000, 1000),
        minTerminalRate: toFloat(ui?.developerTrainingGateMinTerminalRateInput?.value, 0.5, 0, 1),
        maxTruncationRate: toFloat(ui?.developerTrainingGateMaxTruncationRateInput?.value, 0.75, 0, 1),
        maxInvalidActionRate: toFloat(ui?.developerTrainingGateMaxInvalidRateInput?.value, 0.05, 0, 1),
        maxRuntimeErrorCount: toInt(ui?.developerTrainingGateMaxRuntimeErrorsInput?.value, 0, 0, 1000),
    };
}

export function buildDeveloperTrainingResetPayload(ui) {
    return resolveCommonTrainingConfig(ui);
}

export function buildDeveloperTrainingStepPayload(ui) {
    const common = resolveCommonTrainingConfig(ui);
    const done = !!ui?.developerTrainingDoneToggle?.checked;
    const terminalReason = done
        ? toTrimmedString(ui?.developerTrainingTerminalReasonInput?.value, 'external-terminal')
        : null;
    return {
        ...common,
        action: resolveAction(ui),
        rewardSignals: resolveRewardSignals(ui),
        done,
        terminalReason,
    };
}

export function buildDeveloperTrainingAutoStepPayload(ui) {
    return {
        ...buildDeveloperTrainingStepPayload(ui),
        steps: toInt(ui?.developerTrainingAutoStepsInput?.value, 20, 1, 5000),
    };
}

export function buildDeveloperTrainingRunBatchPayload(ui) {
    return resolveAutomationConfig(ui);
}

export function buildDeveloperTrainingRunEvalPayload(ui) {
    return resolveAutomationConfig(ui);
}

export function buildDeveloperTrainingRunGatePayload(ui) {
    return {
        ...resolveAutomationConfig(ui),
        gateThresholds: resolveGateThresholds(ui),
    };
}
