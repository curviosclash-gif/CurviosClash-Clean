import { isPlainObject } from './SettingsOverrideMergeOps.js';

function toFiniteNumber(value, fallback = null) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
}

function createLimitRule(rule, fallbackLimits = null) {
    const fallback = isPlainObject(fallbackLimits) ? fallbackLimits : {};
    const source = isPlainObject(rule) ? rule : {};
    return {
        min: toFiniteNumber(source.min, toFiniteNumber(fallback.min, null)),
        max: toFiniteNumber(source.max, toFiniteNumber(fallback.max, null)),
        step: toFiniteNumber(source.step, toFiniteNumber(fallback.step, null)),
        integer: source.integer === true || fallback.integer === true,
    };
}

export function validateLimitRule(path, limits, errors, field, createError) {
    if (!Number.isFinite(limits.min)) {
        errors.push(createError(path, 'LIMIT_MIN_INVALID', `Limit min ist ungültig für ${path}.`));
    }
    if (!Number.isFinite(limits.max)) {
        errors.push(createError(path, 'LIMIT_MAX_INVALID', `Limit max ist ungültig für ${path}.`));
    }
    if (!Number.isFinite(limits.step)) {
        errors.push(createError(path, 'LIMIT_STEP_INVALID', `Limit step ist ungültig für ${path}.`));
    }
    if (Number.isFinite(limits.step) && limits.step <= 0) {
        errors.push(createError(path, 'LIMIT_STEP_NON_POSITIVE', `Limit step muss größer als 0 sein für ${path}.`));
    }
    if (Number.isFinite(limits.min) && Number.isFinite(limits.max) && limits.min > limits.max) {
        errors.push(createError(path, 'LIMIT_RANGE_INVALID', `Limit min darf nicht größer als max sein für ${path}.`));
    }
    if (field?.limits?.integer === true) {
        for (const key of ['min', 'max', 'step']) {
            if (Number.isFinite(limits[key]) && !Number.isInteger(limits[key])) {
                errors.push(createError(
                    `${path}.${key}`,
                    'LIMIT_INTEGER_REQUIRED',
                    `${path}.${key} erwartet eine ganze Zahl.`
                ));
            }
        }
    }
}

export function normalizeLimitOverrides(rawLimitOverrides, fieldsByPath, errors, createError) {
    const overrides = {};
    const source = isPlainObject(rawLimitOverrides) ? rawLimitOverrides : {};
    for (const [path, rawRule] of Object.entries(source)) {
        const field = fieldsByPath.get(path);
        if (!field || field.type !== 'number') {
            errors.push(createError(path, 'LIMIT_FIELD_UNKNOWN', `Limit-Override verweist auf unbekanntes Feld: ${path}.`));
            continue;
        }
        if (!isPlainObject(rawRule)) {
            errors.push(createError(path, 'LIMIT_RULE_INVALID', `Limit-Override muss ein Objekt sein: ${path}.`));
            continue;
        }
        const override = {};
        for (const key of Object.keys(rawRule)) {
            if (!['min', 'max', 'step'].includes(key)) {
                errors.push(createError(
                    `${path}.${key}`,
                    'LIMIT_KEY_UNKNOWN',
                    `Unbekannter Limit-Schlüssel für ${path}: ${key}.`
                ));
                continue;
            }
            const value = toFiniteNumber(rawRule[key], null);
            if (!Number.isFinite(value)) {
                errors.push(createError(
                    `${path}.${key}`,
                    `LIMIT_${key.toUpperCase()}_INVALID`,
                    `Limit ${key} ist ungültig für ${path}.`
                ));
                continue;
            }
            override[key] = value;
        }
        const limits = createLimitRule(override, field.limits || null);
        validateLimitRule(path, limits, errors, field, createError);
        if (Object.keys(override).length) overrides[path] = override;
    }
    return overrides;
}

export function resolveEffectiveLimits(field, limitOverrides) {
    if (!field || field.type !== 'number') return null;
    const fallback = field.limits || null;
    const override = limitOverrides[field.path] || null;
    if (!fallback && !override) return null;
    return createLimitRule(override, fallback);
}
