import { normalizeSettingsChangeKeys } from './SettingsChangeKeys.js';

export function addChangedKeys(targetSet, changedKeys) {
    if (!(targetSet instanceof Set)) return targetSet;
    const normalized = normalizeSettingsChangeKeys(changedKeys);
    for (const key of normalized) {
        targetSet.add(key);
    }
    return targetSet;
}

export function changedKeySetToArray(sourceSet) {
    if (!(sourceSet instanceof Set) || sourceSet.size === 0) {
        return [];
    }
    return Array.from(sourceSet);
}
