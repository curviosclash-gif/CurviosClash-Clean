import { SETTINGS_CHANGE_PATH_ENTRIES } from '../../composition/core-ui/CoreSettingsPorts.js';

const PATH_CHANGE_KEY_MAP = new Map(SETTINGS_CHANGE_PATH_ENTRIES);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneComparableValue(value) {
    if (value === undefined) return null;
    if (!value || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

function isEqualValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function getChangeKeyForPath(path) {
    if (PATH_CHANGE_KEY_MAP.has(path)) {
        return PATH_CHANGE_KEY_MAP.get(path);
    }
    for (const [prefix, changeKey] of SETTINGS_CHANGE_PATH_ENTRIES) {
        if (path.startsWith(`${prefix}.`)) {
            return changeKey;
        }
    }
    return null;
}

function collectChanges(before, after, path, changes) {
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = Array.from(new Set([
            ...Object.keys(before),
            ...Object.keys(after),
        ])).sort();
        for (const key of keys) {
            collectChanges(before[key], after[key], path ? `${path}.${key}` : key, changes);
        }
        return;
    }

    if (isEqualValue(before, after)) return;
    changes.push({
        path,
        before: cloneComparableValue(before),
        after: cloneComparableValue(after),
        changeKey: getChangeKeyForPath(path),
    });
}

export function diffSettingsSnapshots(before, after) {
    const changes = [];
    collectChanges(
        before && typeof before === 'object' ? before : {},
        after && typeof after === 'object' ? after : {},
        '',
        changes
    );
    const changedKeys = Array.from(new Set(
        changes
            .map((change) => change.changeKey)
            .filter((changeKey) => typeof changeKey === 'string' && changeKey.trim())
    ));
    return {
        changed: changes.length > 0,
        changedKeys,
        changes,
    };
}
