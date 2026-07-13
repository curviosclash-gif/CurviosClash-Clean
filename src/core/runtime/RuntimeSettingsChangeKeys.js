import {
    isSettingsChangeKey,
    normalizeSettingsChangeKeys,
} from '../../composition/core-ui/CoreUiMenuPorts.js';

export function normalizeRuntimeChangedKeyList(changedKeys) {
    if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
        return [];
    }

    const normalized = [];
    const seen = new Set();
    for (const key of changedKeys) {
        if (typeof key !== 'string') continue;
        const value = key.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        normalized.push(value);
    }
    return normalized;
}

export function hasInvalidSettingsChangeKeys(changedKeys) {
    const normalized = normalizeRuntimeChangedKeyList(changedKeys);
    if (Array.isArray(changedKeys) && normalized.length !== changedKeys.length) {
        return true;
    }
    return normalized.some((key) => !isSettingsChangeKey(key));
}

export function filterKnownSettingsChangeKeys(changedKeys) {
    return normalizeSettingsChangeKeys(normalizeRuntimeChangedKeyList(changedKeys));
}

export function resolveMutationChangedKeys(result, fallbackKeys = []) {
    const resultKeys = normalizeRuntimeChangedKeyList(result?.changedKeys);
    return resultKeys.length > 0
        ? resultKeys
        : normalizeRuntimeChangedKeyList(fallbackKeys);
}

export function appendMutationChangedKeys(target, result, fallbackKeys = []) {
    if (!Array.isArray(target)) return target;
    target.push(...resolveMutationChangedKeys(result, fallbackKeys));
    return target;
}
