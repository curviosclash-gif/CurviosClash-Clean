// ============================================
// SessionSettingsRestorePlan.js - which settings a match borrowed, and how to hand them back
// ============================================

import { tryCloneJsonValue } from '../../shared/utils/JsonClone.js';

// Settings nest a few levels (localSettings, gameplay, arcade, controls). The guard keeps a
// broken/cyclic snapshot from turning the diff into an endless walk.
const MAX_PLAN_DEPTH = 8;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSameLeafValue(left, right) {
    if (left === right) return true;
    if (left === null || right === null) return false;
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function joinPath(segments) {
    return segments.join('.');
}

// Leaves that are objects (lists, and objects the walk stopped at) must not stay references
// into the live settings: a player editing such a value in place - pushing to a list, setting
// a field - would change the remembered value with it, so the restore would still read it as
// "untouched preset value" and overwrite his edit on the way back to the menu.
function cloneLeafValue(value) {
    if (!value || typeof value !== 'object') return value;
    return tryCloneJsonValue(value, value);
}

function collectPlanEntries(baselineValue, liveValue, segments, depth, entries) {
    if (isPlainObject(baselineValue) && isPlainObject(liveValue) && depth < MAX_PLAN_DEPTH) {
        const keys = new Set([...Object.keys(baselineValue), ...Object.keys(liveValue)]);
        for (const key of keys) {
            collectPlanEntries(baselineValue[key], liveValue[key], [...segments, key], depth + 1, entries);
        }
        return entries;
    }
    if (isSameLeafValue(baselineValue, liveValue)) return entries;
    entries.push({
        path: joinPath(segments),
        segments,
        baselineValue: cloneLeafValue(baselineValue),
        // What the preset left behind: the restore only reverts a value that still looks like this.
        presetValue: cloneLeafValue(liveValue),
        hadBaselineValue: baselineValue !== undefined,
    });
    return entries;
}

function isIgnoredPath(path, ignoredPaths) {
    for (const ignoredPath of ignoredPaths) {
        if (path === ignoredPath || path.startsWith(`${ignoredPath}.`)) return true;
    }
    return false;
}

function readValueAtSegments(target, segments) {
    let current = target;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function writeValueAtSegments(target, segments, value, hasValue) {
    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!isPlainObject(current[segment])) {
            current[segment] = {};
        }
        current = current[segment];
    }
    const lastSegment = segments[segments.length - 1];
    if (!hasValue) {
        delete current[lastSegment];
        return;
    }
    current[lastSegment] = value;
}

/**
 * Lists every leaf the live settings gained over the baseline snapshot. Callers take the
 * snapshot before a preset is applied and build the plan right after, so the plan names
 * exactly the values the preset borrowed - not the whole settings tree.
 */
export function createSessionSettingsRestorePlan(baselineSnapshot, liveSettings, options = {}) {
    if (!isPlainObject(baselineSnapshot) || !isPlainObject(liveSettings)) {
        return { entries: [] };
    }
    const ignoredPaths = Array.isArray(options.ignoredPaths)
        ? options.ignoredPaths.map((path) => String(path || '').trim()).filter(Boolean)
        : [];
    const entries = collectPlanEntries(baselineSnapshot, liveSettings, [], 0, [])
        .filter((entry) => !isIgnoredPath(entry.path, ignoredPaths));
    return { entries };
}

/**
 * Keeps the older baseline when two presets follow each other without a restore in between:
 * the value to hand back stays the player's, only the value to compare against moves on.
 */
export function mergeSessionSettingsRestorePlans(currentPlan, nextPlan) {
    const currentEntries = Array.isArray(currentPlan?.entries) ? currentPlan.entries : [];
    const nextEntries = Array.isArray(nextPlan?.entries) ? nextPlan.entries : [];
    if (currentEntries.length === 0) return { entries: [...nextEntries] };
    const mergedByPath = new Map(currentEntries.map((entry) => [entry.path, entry]));
    for (const entry of nextEntries) {
        const existing = mergedByPath.get(entry.path);
        mergedByPath.set(entry.path, existing
            ? { ...existing, presetValue: entry.presetValue }
            : entry);
    }
    return { entries: Array.from(mergedByPath.values()) };
}

/**
 * Hands the baseline values back, but only where the live value is still the one the preset
 * wrote. A value the player changed during the session is his decision and stays.
 */
export function applySessionSettingsRestorePlan(plan, liveSettings) {
    const restoredPaths = [];
    const keptPaths = [];
    const entries = Array.isArray(plan?.entries) ? plan.entries : [];
    if (!isPlainObject(liveSettings)) {
        return { restoredPaths, keptPaths };
    }
    for (const entry of entries) {
        if (!Array.isArray(entry?.segments) || entry.segments.length === 0) continue;
        const liveValue = readValueAtSegments(liveSettings, entry.segments);
        if (!isSameLeafValue(liveValue, entry.presetValue)) {
            keptPaths.push(entry.path);
            continue;
        }
        writeValueAtSegments(liveSettings, entry.segments, entry.baselineValue, entry.hadBaselineValue === true);
        restoredPaths.push(entry.path);
    }
    return { restoredPaths, keptPaths };
}
