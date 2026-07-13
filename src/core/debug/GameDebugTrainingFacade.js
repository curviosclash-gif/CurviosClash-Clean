import { toFiniteNumber } from '../../utils/MathOps.js';

const TRAINING_ARTIFACT_ROOT = 'data/training/runs';

export const DEFAULT_AUTOMATION_CONFIG = Object.freeze({
    episodes: 3,
    seeds: Object.freeze([3, 7, 11]),
    modes: Object.freeze(['classic-3d', 'hunt-3d']),
    maxSteps: 180,
    inventoryLength: 2,
    bridgeMode: 'local',
    timeoutMs: 800,
});

export const DEFAULT_GATE_THRESHOLDS = Object.freeze({
    minEpisodeReturnMean: 0.1,
    minTerminalRate: 0.5,
    maxTruncationRate: 0.75,
    maxInvalidActionRate: 0.05,
    maxRuntimeErrorCount: 0,
});

export function toInt(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const intValue = Math.trunc(numeric);
    const minValue = Number.isFinite(Number(min)) ? Number(min) : intValue;
    const maxValue = Number.isFinite(Number(max)) ? Number(max) : intValue;
    return Math.max(minValue, Math.min(maxValue, intValue));
}

export function toRate(value, fallback) {
    const numeric = toFiniteNumber(value, fallback);
    return Math.max(0, Math.min(1, numeric));
}

export function roundMetric(value, decimals = 6) {
    const numeric = toFiniteNumber(value, 0);
    const factor = 10 ** decimals;
    return Math.round(numeric * factor) / factor;
}

export function cloneSerializable(value) {
    if (value === null || value === undefined) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function normalizeBridgeMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_AUTOMATION_CONFIG.bridgeMode;
    return normalized;
}

function normalizeDomainMode(modeToken) {
    const normalized = String(modeToken || '').trim().toLowerCase();
    if (normalized === 'classic' || normalized === 'classic-3d' || normalized === 'classic3d') {
        return { mode: 'classic', planarMode: false, domainId: 'classic-3d' };
    }
    if (normalized === 'classic-2d' || normalized === 'classic2d' || normalized === 'planar') {
        return { mode: 'classic', planarMode: true, domainId: 'classic-2d' };
    }
    if (normalized === 'hunt' || normalized === 'fight' || normalized === 'hunt-3d' || normalized === 'hunt3d' || normalized === 'fight-3d' || normalized === 'fight3d') {
        return { mode: 'hunt', planarMode: false, domainId: 'hunt-3d' };
    }
    if (normalized === 'hunt-2d' || normalized === 'hunt2d' || normalized === 'fight-2d' || normalized === 'fight2d') {
        return { mode: 'hunt', planarMode: true, domainId: 'hunt-2d' };
    }
    return null;
}

function normalizeModeList(value) {
    const fallback = [...DEFAULT_AUTOMATION_CONFIG.modes];
    const rawList = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,\s;]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
    const normalized = rawList
        .map((token) => normalizeDomainMode(token))
        .filter((entry) => !!entry)
        .map((entry) => entry.domainId);
    if (normalized.length === 0) return fallback;
    return Array.from(new Set(normalized));
}

function normalizeSeedList(value) {
    const fallback = [...DEFAULT_AUTOMATION_CONFIG.seeds];
    const rawList = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,\s;]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
    const normalized = rawList
        .map((token) => toInt(token, Number.NaN, 0, 1_000_000))
        .filter((seed) => Number.isFinite(seed));
    if (normalized.length === 0) return fallback;
    return Array.from(new Set(normalized));
}

export function normalizeAutomationConfig(input = {}) {
    const resolvedInput = input && typeof input === 'object' ? input : {};
    return {
        episodes: toInt(resolvedInput.episodes, DEFAULT_AUTOMATION_CONFIG.episodes, 1, 500),
        seeds: normalizeSeedList(resolvedInput.seeds),
        modes: normalizeModeList(resolvedInput.modes),
        maxSteps: toInt(resolvedInput.maxSteps, DEFAULT_AUTOMATION_CONFIG.maxSteps, 1, 10_000),
        inventoryLength: toInt(resolvedInput.inventoryLength, DEFAULT_AUTOMATION_CONFIG.inventoryLength, 0, 20),
        bridgeMode: normalizeBridgeMode(resolvedInput.bridgeMode),
        timeoutMs: toInt(resolvedInput.timeoutMs, DEFAULT_AUTOMATION_CONFIG.timeoutMs, 10, 120_000),
    };
}

export function normalizeGateThresholds(input = {}) {
    const resolvedInput = input && typeof input === 'object' ? input : {};
    return {
        minEpisodeReturnMean: toFiniteNumber(
            resolvedInput.minEpisodeReturnMean,
            DEFAULT_GATE_THRESHOLDS.minEpisodeReturnMean
        ),
        minTerminalRate: toRate(
            resolvedInput.minTerminalRate,
            DEFAULT_GATE_THRESHOLDS.minTerminalRate
        ),
        maxTruncationRate: toRate(
            resolvedInput.maxTruncationRate,
            DEFAULT_GATE_THRESHOLDS.maxTruncationRate
        ),
        maxInvalidActionRate: toRate(
            resolvedInput.maxInvalidActionRate,
            DEFAULT_GATE_THRESHOLDS.maxInvalidActionRate
        ),
        maxRuntimeErrorCount: toInt(
            resolvedInput.maxRuntimeErrorCount,
            DEFAULT_GATE_THRESHOLDS.maxRuntimeErrorCount,
            0,
            1000
        ),
    };
}

function createRunStamp() {
    const now = new Date();
    const iso = now.toISOString().replace(/[-:.]/g, '').replace('T', '_').replace('Z', '');
    return `${iso}_${Math.trunc(Math.random() * 10_000)}`;
}

export function createArtifactPaths(stamp) {
    const resolvedStamp = String(stamp || '').trim() || createRunStamp();
    const root = `${TRAINING_ARTIFACT_ROOT}/${resolvedStamp}`;
    return {
        root,
        run: `${root}/run.json`,
        eval: `${root}/eval.json`,
        gate: `${root}/gate.json`,
    };
}

function deterministicValue(seed, index) {
    const value = Math.sin((seed + 1) * (index + 1) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
}

export function buildDeterministicStepPayload({ mode, planarMode, seed, stepIndex, maxSteps, inventoryLength }) {
    const modeOffset = mode === 'hunt' ? 17 : 0;
    const planarOffset = planarMode ? 7 : 3;
    const baseSeed = seed + stepIndex * 31 + modeOffset + planarOffset;
    const yawRoll = deterministicValue(baseSeed, 1);
    const pitchRoll = deterministicValue(baseSeed, 2);
    const boostRoll = deterministicValue(baseSeed, 3);
    const shootMgRoll = deterministicValue(baseSeed, 4);
    const shootItemRoll = deterministicValue(baseSeed, 5);
    const itemIndexRoll = deterministicValue(baseSeed, 6);
    const terminalRoll = deterministicValue(baseSeed, 7);
    const killRoll = deterministicValue(baseSeed, 8);
    const damageDealtRoll = deterministicValue(baseSeed, 9);
    const damageTakenRoll = deterministicValue(baseSeed, 10);

    const shootItem = shootItemRoll > 0.72;
    const maxInventoryIndex = inventoryLength > 0 ? inventoryLength - 1 : -1;
    const rawShootItemIndex = shootItem
        ? Math.trunc(itemIndexRoll * (inventoryLength + 4)) - 1
        : -1;
    const normalizedShootItemIndex = shootItem
        ? Math.max(-1, Math.min(maxInventoryIndex, rawShootItemIndex))
        : -1;
    const invalidAction = shootItem && rawShootItemIndex !== normalizedShootItemIndex;
    const canFinish = stepIndex >= Math.max(1, Math.floor(maxSteps * 0.55));
    const done = canFinish && terminalRoll > 0.87;
    const won = done && deterministicValue(baseSeed, 11) > 0.52;
    const lost = done && !won;

    return {
        action: {
            yawLeft: yawRoll < 0.3,
            yawRight: yawRoll > 0.7,
            pitchDown: pitchRoll < 0.3,
            pitchUp: pitchRoll > 0.7,
            boost: boostRoll > 0.56,
            shootMG: shootMgRoll > 0.61,
            shootItem,
            shootItemIndex: rawShootItemIndex,
        },
        rewardSignals: {
            survival: true,
            kills: killRoll > 0.95 ? 1 : 0,
            damageDealt: Number((damageDealtRoll * 7).toFixed(3)),
            damageTaken: Number((damageTakenRoll * 4).toFixed(3)),
            itemUses: shootItem ? 1 : 0,
            crashed: done && mode === 'hunt' && !won,
            stuck: false,
            won,
            lost,
        },
        done,
        terminalReason: done
            ? (won ? 'match-win' : 'match-loss')
            : '',
        invalidAction,
    };
}

export function buildTrainingKpis(episodeResults, runtimeErrorCount = 0) {
    const episodesTotal = episodeResults.length;
    const stepsTotal = episodeResults.reduce((sum, episode) => sum + toInt(episode?.stepsExecuted, 0, 0, Number.MAX_SAFE_INTEGER), 0);
    const episodeReturnTotal = episodeResults.reduce((sum, episode) => sum + toFiniteNumber(episode?.episodeReturn, 0), 0);
    const terminalEpisodes = episodeResults.reduce((sum, episode) => sum + (episode?.done ? 1 : 0), 0);
    const truncatedEpisodes = episodeResults.reduce((sum, episode) => sum + (episode?.truncated ? 1 : 0), 0);
    const invalidActionCount = episodeResults.reduce((sum, episode) => sum + toInt(episode?.invalidActionCount, 0, 0, Number.MAX_SAFE_INTEGER), 0);
    return {
        episodeReturnMean: roundMetric(episodesTotal > 0 ? (episodeReturnTotal / episodesTotal) : 0),
        terminalRate: roundMetric(episodesTotal > 0 ? (terminalEpisodes / episodesTotal) : 0),
        truncationRate: roundMetric(episodesTotal > 0 ? (truncatedEpisodes / episodesTotal) : 0),
        invalidActionRate: roundMetric(stepsTotal > 0 ? (invalidActionCount / stepsTotal) : 0),
        runtimeErrorCount: toInt(runtimeErrorCount, 0, 0, Number.MAX_SAFE_INTEGER),
        episodesTotal,
        stepsTotal,
    };
}
