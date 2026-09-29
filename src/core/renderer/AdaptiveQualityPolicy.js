import {
    GRAPHICS_AUTO_VERDICTS,
    GRAPHICS_QUALITY_AUTO,
    GRAPHICS_QUALITY_LEVELS,
    normalizeGraphicsAutoProfile,
} from '../../shared/contracts/GraphicsQualityContract.js';
import { GPU_TIERS } from './GpuCapabilityProbe.js';

const { LOW, MEDIUM, HIGH, ULTRA } = GRAPHICS_QUALITY_LEVELS;

// Wide hysteresis: a step changes the frame rate itself by 20-40%.
export const ADAPTIVE_FPS_THRESHOLDS = Object.freeze({
    HIGH_TO_MEDIUM: 45,
    MEDIUM_TO_LOW: 25,
    LOW_TO_MEDIUM: 50,
    MEDIUM_TO_HIGH: 58,
});

// ULTRA is decided on GPU time, not frame rate: the frame rate stops at the monitor's refresh rate
// and shows no headroom. 6 ms at HIGH leaves room for the doubled shadow map and the finer pixels
// inside a 16.7 ms frame; the guard only steps back once ULTRA eats most of that frame.
export const ULTRA_THRESHOLDS = Object.freeze({
    PROMOTE_MAX_GPU_MS: 6,
    SUPERSAMPLE_MAX_GPU_MS: 4,
    PROMOTE_MIN_FPS: 55,
    DEMOTE_MAX_GPU_MS: 12,
    DEMOTE_MIN_FPS: 50,
    MIN_GPU_SAMPLES: 120,
    // Loading hitches and shader compiles cluster in the first seconds of a round.
    MIN_PLAYING_SECONDS: 10,
    MAX_DOWNGRADES: 2,
});

const QUALITY_RANK = Object.freeze({ [LOW]: 0, [MEDIUM]: 1, [HIGH]: 2, [ULTRA]: 3 });

export function compareQualityLevels(a, b) {
    return (QUALITY_RANK[a] ?? QUALITY_RANK[HIGH]) - (QUALITY_RANK[b] ?? QUALITY_RANK[HIGH]);
}

export function isUltraCapableGpu(capabilities) {
    return capabilities?.tier === GPU_TIERS.DISCRETE && capabilities?.timerQuery === true;
}

/**
 * May the automatic regulator step up to ULTRA at all?
 * @param {{setting?: string, capabilities?: any, profile?: any, automation?: boolean}} input
 */
export function isUltraAllowed({ setting, capabilities, profile, automation = false } = {}) {
    if (setting !== GRAPHICS_QUALITY_AUTO || automation === true) return false;
    if (!isUltraCapableGpu(capabilities)) return false;
    const stored = normalizeGraphicsAutoProfile(profile);
    return !(stored.gpuKey === capabilities.gpuKey && stored.verdict === GRAPHICS_AUTO_VERDICTS.BLOCKED);
}

/** The level an automatic session starts with: ULTRA only if this very GPU earned it before. */
export function resolveAutoStartQuality({ capabilities, profile, ultraAllowed }) {
    const stored = normalizeGraphicsAutoProfile(profile);
    const earned = ultraAllowed === true
        && stored.gpuKey === capabilities?.gpuKey
        && stored.verdict === GRAPHICS_AUTO_VERDICTS.ULTRA;
    return earned ? { quality: ULTRA, supersample: stored.supersample } : { quality: HIGH, supersample: false };
}

/**
 * One regulator step. Returns the level to switch to (or the current one).
 * @param {{quality: string, autoLowActive?: boolean, avgFps: number,
 *          gpu?: {samples: number, medianMs: number} | null, ultraAllowed?: boolean,
 *          playingSeconds?: number}} input
 */
export function resolveAdaptiveQualityStep({
    quality,
    autoLowActive = false,
    avgFps,
    gpu = null,
    ultraAllowed = false,
    playingSeconds = 0,
}) {
    const settled = playingSeconds >= ULTRA_THRESHOLDS.MIN_PLAYING_SECONDS;
    const gpuMs = gpu && gpu.samples >= ULTRA_THRESHOLDS.MIN_GPU_SAMPLES ? gpu.medianMs : Number.NaN;
    if (quality === ULTRA) {
        if (!settled) return ULTRA;
        const overloaded = avgFps < ULTRA_THRESHOLDS.DEMOTE_MIN_FPS || gpuMs > ULTRA_THRESHOLDS.DEMOTE_MAX_GPU_MS;
        return overloaded ? HIGH : ULTRA;
    }
    if (quality === HIGH) {
        if (avgFps < ADAPTIVE_FPS_THRESHOLDS.HIGH_TO_MEDIUM) return MEDIUM;
        const headroom = ultraAllowed === true && settled
            && avgFps >= ULTRA_THRESHOLDS.PROMOTE_MIN_FPS
            && gpuMs <= ULTRA_THRESHOLDS.PROMOTE_MAX_GPU_MS;
        return headroom ? ULTRA : HIGH;
    }
    if (quality === MEDIUM) {
        if (avgFps < ADAPTIVE_FPS_THRESHOLDS.MEDIUM_TO_LOW) return LOW;
        if (autoLowActive && avgFps > ADAPTIVE_FPS_THRESHOLDS.MEDIUM_TO_HIGH) return HIGH;
        return MEDIUM;
    }
    if (autoLowActive && avgFps > ADAPTIVE_FPS_THRESHOLDS.LOW_TO_MEDIUM) return MEDIUM;
    return quality;
}

/** Only a card with plenty to spare also renders more pixels than the screen has. */
export function shouldSupersample(gpu) {
    return !!gpu && gpu.samples >= ULTRA_THRESHOLDS.MIN_GPU_SAMPLES
        && gpu.medianMs <= ULTRA_THRESHOLDS.SUPERSAMPLE_MAX_GPU_MS;
}

/**
 * The profile after ULTRA was earned ('promote') or had to be given back ('demote'). A demote sends
 * the GPU back to measuring; the second one blocks automatic ULTRA on this GPU for good.
 */
export function recordUltraOutcome(profile, gpuKey, outcome, { supersample = false } = {}) {
    const stored = normalizeGraphicsAutoProfile(profile);
    const base = stored.gpuKey === gpuKey ? stored : normalizeGraphicsAutoProfile({ gpuKey });
    if (outcome === 'promote') {
        return { ...base, gpuKey, verdict: GRAPHICS_AUTO_VERDICTS.ULTRA, supersample: supersample === true };
    }
    const downgrades = base.downgrades + 1;
    return {
        ...base,
        gpuKey,
        downgrades,
        verdict: downgrades >= ULTRA_THRESHOLDS.MAX_DOWNGRADES
            ? GRAPHICS_AUTO_VERDICTS.BLOCKED
            : GRAPHICS_AUTO_VERDICTS.UNKNOWN,
        supersample: false,
    };
}
