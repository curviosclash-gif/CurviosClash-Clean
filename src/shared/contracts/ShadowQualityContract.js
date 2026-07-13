export const SHADOW_QUALITY_LEVELS = Object.freeze({
    OFF: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
});

export const DEFAULT_SHADOW_QUALITY = SHADOW_QUALITY_LEVELS.HIGH;

const SHADOW_QUALITY_PRESETS = Object.freeze({
    [SHADOW_QUALITY_LEVELS.OFF]: Object.freeze({
        id: 'off',
        label: 'Aus',
        enabled: false,
        mapSize: 0,
    }),
    [SHADOW_QUALITY_LEVELS.LOW]: Object.freeze({
        id: 'low',
        label: 'Niedrig',
        enabled: true,
        mapSize: 256,
    }),
    [SHADOW_QUALITY_LEVELS.MEDIUM]: Object.freeze({
        id: 'medium',
        label: 'Mittel',
        enabled: true,
        mapSize: 512,
    }),
    [SHADOW_QUALITY_LEVELS.HIGH]: Object.freeze({
        id: 'high',
        label: 'Hoch',
        enabled: true,
        mapSize: 1024,
    }),
});

export function normalizeShadowQuality(value, fallback = DEFAULT_SHADOW_QUALITY) {
    const normalizedFallback = SHADOW_QUALITY_PRESETS[fallback]
        ? fallback
        : DEFAULT_SHADOW_QUALITY;
    const numericValue = Number(value);
    const normalizedValue = Number.isFinite(numericValue)
        ? Math.trunc(numericValue)
        : normalizedFallback;
    return SHADOW_QUALITY_PRESETS[normalizedValue]
        ? normalizedValue
        : normalizedFallback;
}

export function resolveShadowQualityPreset(value, fallback = DEFAULT_SHADOW_QUALITY) {
    return SHADOW_QUALITY_PRESETS[normalizeShadowQuality(value, fallback)];
}

export function resolveShadowQualityLabel(value, fallback = DEFAULT_SHADOW_QUALITY) {
    return resolveShadowQualityPreset(value, fallback).label;
}
