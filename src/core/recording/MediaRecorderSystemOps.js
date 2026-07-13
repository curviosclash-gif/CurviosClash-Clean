import { toFiniteNumber } from '../../utils/MathOps.js';

export const ENCODE_QUEUE_SOFT_LIMIT = 2;
export const ENCODE_QUEUE_DROP_LIMIT = 10;
export const CAPTURE_LOAD_LEVELS = Object.freeze([
    Object.freeze({ fpsScale: 1.0, resolutionScale: 1.0 }),
    Object.freeze({ fpsScale: 0.95, resolutionScale: 0.9 }),
    Object.freeze({ fpsScale: 0.9, resolutionScale: 0.78 }),
    Object.freeze({ fpsScale: 0.8, resolutionScale: 0.65 }),
    Object.freeze({ fpsScale: 0.7, resolutionScale: 0.5 }),
    Object.freeze({ fpsScale: 0.6, resolutionScale: 0.42 }),
]);
export const MAX_CAPTURE_TIMESTAMPS = 4096;
export const MAX_CAPTURE_STEPS_PER_RENDER = 1;
export const MAX_CAPTURE_BACKLOG_STEPS = 2;
export const MEDIARECORDER_SYNTHETIC_QUEUE_SOFT_MS = 22;
export const MEDIARECORDER_SYNTHETIC_QUEUE_HARD_MS = 38;

export function toPositiveInt(value, fallback, min = 1, max = 1_000_000) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

export function computePercentile(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * clamped) - 1));
    return toFiniteNumber(values[index], 0);
}
