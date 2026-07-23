import { SETTINGS_LIMITS } from './SettingsRuntimeContract.js';
import { cloneJsonValue } from '../utils/JsonClone.js';

const SETTINGS_OVERRIDE_SCHEMA_VERSIONS = new Set([
    'menu-defaults-override.v1',
    'menu-defaults-override.v2',
]);

function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function readPathValue(source, path) {
    if (!isPlainObject(source) && !Array.isArray(source)) return undefined;
    const tokens = String(path || '')
        .split('.')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (!tokens.length) return undefined;

    let cursor = source;
    for (const token of tokens) {
        if (!cursor || typeof cursor !== 'object' || !(token in cursor)) {
            return undefined;
        }
        cursor = cursor[token];
    }
    return cursor;
}

function writePathValue(target, path, value) {
    if (!isPlainObject(target)) return false;
    const tokens = String(path || '')
        .split('.')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (!tokens.length) return false;

    let cursor = target;
    for (let index = 0; index < tokens.length - 1; index += 1) {
        const token = tokens[index];
        if (!isPlainObject(cursor[token])) {
            cursor[token] = {};
        }
        cursor = cursor[token];
    }

    cursor[tokens[tokens.length - 1]] = value;
    return true;
}

function toRuntimeLimitPath(overridePath) {
    const normalizedPath = String(overridePath || '').trim();
    if (!normalizedPath.startsWith('baseSettings.')) return null;

    const runtimePath = normalizedPath.slice('baseSettings.'.length);
    if (runtimePath === 'numBots') return 'session.numBots';
    if (runtimePath === 'winsNeeded') return 'session.winsNeeded';
    if (runtimePath.startsWith('gameplay.')) return runtimePath;
    if (runtimePath.startsWith('botBridge.')) return runtimePath;
    return null;
}

function mergeLimitRule(baseRule, overrideRule) {
    const base = isPlainObject(baseRule) ? baseRule : {};
    const override = isPlainObject(overrideRule) ? overrideRule : {};
    const merged = { ...base };

    if (Number.isFinite(Number(override.min))) {
        merged.min = Number(override.min);
    }
    if (Number.isFinite(Number(override.max))) {
        merged.max = Number(override.max);
    }
    if (Number.isFinite(Number(override.step)) && Number(override.step) > 0) {
        merged.step = Number(override.step);
    }
    if (typeof override.integer === 'boolean') {
        merged.integer = override.integer;
    }

    if (Number.isFinite(Number(merged.min)) && Number.isFinite(Number(merged.max)) && Number(merged.min) > Number(merged.max)) {
        return base;
    }
    return merged;
}

function resolveLimitOverridesForRuntime(rawOverrideDraft) {
    if (!isPlainObject(rawOverrideDraft)) {
        return null;
    }
    const schemaVersion = String(rawOverrideDraft.schemaVersion || '').trim();
    if (!SETTINGS_OVERRIDE_SCHEMA_VERSIONS.has(schemaVersion)) {
        return null;
    }
    if (!isPlainObject(rawOverrideDraft.limitOverrides)) {
        return null;
    }
    return rawOverrideDraft.limitOverrides;
}

export function createSettingsDefaultsRuntimePort(source = globalThis) {
    const runtimeSource = source && typeof source === 'object' ? source : {};
    return Object.freeze({
        getOverrideSnapshot() {
            const contract = typeof runtimeSource.getOverrideSnapshot === 'function'
                ? runtimeSource
                : runtimeSource?.settingsDefaultsContract;
            if (!contract || typeof contract.getOverrideSnapshot !== 'function') {
                return null;
            }

            try {
                return contract.getOverrideSnapshot();
            } catch {
                return null;
            }
        },
    });
}

export function readSettingsOverrideDraftFromPort(settingsDefaultsPort = null) {
    if (!settingsDefaultsPort || typeof settingsDefaultsPort.getOverrideSnapshot !== 'function') {
        return null;
    }

    try {
        const snapshot = settingsDefaultsPort.getOverrideSnapshot();
        return isPlainObject(snapshot?.draft) ? snapshot.draft : null;
    } catch {
        return null;
    }
}

export function readSettingsOverrideDraftFromRuntime(runtimeGlobal = globalThis) {
    return readSettingsOverrideDraftFromPort(
        createSettingsDefaultsRuntimePort(runtimeGlobal)
    );
}

export function createRuntimeSettingsLimitsWithOverride(rawOverrideDraft) {
    const runtimeLimits = cloneJsonValue(SETTINGS_LIMITS);
    const limitOverrides = resolveLimitOverridesForRuntime(rawOverrideDraft);
    if (!isPlainObject(limitOverrides)) {
        return runtimeLimits;
    }

    for (const [overridePath, overrideRule] of Object.entries(limitOverrides)) {
        const runtimePath = toRuntimeLimitPath(overridePath);
        if (!runtimePath) continue;

        const baseRule = readPathValue(runtimeLimits, runtimePath);
        writePathValue(runtimeLimits, runtimePath, mergeLimitRule(baseRule, overrideRule));
    }

    return runtimeLimits;
}

export function createRuntimeSettingsLimitsForRuntime(runtimeSource = globalThis) {
    return createRuntimeSettingsLimitsWithOverride(
        readSettingsOverrideDraftFromPort(
            createSettingsDefaultsRuntimePort(runtimeSource)
        )
    );
}
