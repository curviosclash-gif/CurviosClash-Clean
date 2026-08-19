export const BLOOM_QUALITY_LEVELS = Object.freeze({
    OFF: 0,
    LOW: 1,
    HIGH: 2,
});

export const DEFAULT_BLOOM_QUALITY = BLOOM_QUALITY_LEVELS.OFF;

const BLOOM_QUALITY_PRESETS = Object.freeze({
    [BLOOM_QUALITY_LEVELS.OFF]: Object.freeze({
        id: 'off',
        label: 'Aus',
        enabled: false,
        strength: 0,
        radius: 0,
        threshold: 1,
    }),
    [BLOOM_QUALITY_LEVELS.LOW]: Object.freeze({
        id: 'low',
        label: 'Niedrig',
        enabled: true,
        strength: 0.45,
        radius: 0.18,
        threshold: 1,
    }),
    [BLOOM_QUALITY_LEVELS.HIGH]: Object.freeze({
        id: 'high',
        label: 'Hoch',
        enabled: true,
        strength: 0.72,
        radius: 0.3,
        threshold: 1,
    }),
});

export function normalizeBloomQuality(value, fallback = DEFAULT_BLOOM_QUALITY) {
    const normalizedFallback = BLOOM_QUALITY_PRESETS[fallback]
        ? fallback
        : DEFAULT_BLOOM_QUALITY;
    const numericValue = Number(value);
    const normalizedValue = Number.isFinite(numericValue)
        ? Math.trunc(numericValue)
        : normalizedFallback;
    return BLOOM_QUALITY_PRESETS[normalizedValue]
        ? normalizedValue
        : normalizedFallback;
}

export function resolveBloomQualityPreset(value, fallback = DEFAULT_BLOOM_QUALITY) {
    return BLOOM_QUALITY_PRESETS[normalizeBloomQuality(value, fallback)];
}

export function resolveBloomQualityLabel(value, fallback = DEFAULT_BLOOM_QUALITY) {
    return resolveBloomQualityPreset(value, fallback).label;
}
