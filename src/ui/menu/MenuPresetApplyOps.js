import { normalizeString } from '../../shared/contracts/ContractNormalizeUtils.js';

import {
    getSettingsFieldDescriptor,
    SETTINGS_PRESET_VALUE_PATHS,
} from '../SettingsFieldRegistry.js';

export const MENU_PRESET_VALUE_PATHS = SETTINGS_PRESET_VALUE_PATHS;

function isPrimitiveEqual(left, right) {
    if (Number.isNaN(left) && Number.isNaN(right)) return true;
    return left === right;
}

function toPathSegments(path) {
    return String(path || '')
        .split('.')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

export function isMenuPresetValuePathAllowed(path) {
    const descriptor = getSettingsFieldDescriptor(path);
    return descriptor?.presetEligible === true;
}

function getValueAtPath(source, path) {
    if (!source || typeof source !== 'object') return undefined;
    const segments = toPathSegments(path);
    if (segments.length === 0) return undefined;
    let current = source;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function setValueAtPath(target, path, value) {
    if (!target || typeof target !== 'object' || !isMenuPresetValuePathAllowed(path)) return false;
    const segments = toPathSegments(path);
    if (segments.length === 0) return false;

    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!Object.prototype.hasOwnProperty.call(current, segment)
            || !current[segment]
            || typeof current[segment] !== 'object') {
            current[segment] = {};
        }
        current = current[segment];
    }
    current[segments[segments.length - 1]] = value;
    return true;
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return { ...value };
    return value;
}

export function normalizePresetValues(preset) {
    const sourceValues = preset?.values && typeof preset.values === 'object' ? preset.values : {};
    const out = {};
    for (const [path, value] of Object.entries(sourceValues)) {
        const normalizedPath = normalizeString(path);
        if (!isMenuPresetValuePathAllowed(normalizedPath)) continue;
        out[normalizedPath] = cloneValue(value);
    }
    return out;
}

function normalizePresetPathList(paths) {
    if (!Array.isArray(paths)) return [];
    return Array.from(new Set(
        paths
            .map((path) => normalizeString(path))
            .filter((path) => isMenuPresetValuePathAllowed(path))
    ));
}

export function applyPresetToSettings(options = {}) {
    const settings = options.settings;
    const preset = options.preset;
    if (!settings || typeof settings !== 'object' || !preset || typeof preset !== 'object') {
        return {
            applied: false,
            changedKeys: [],
            appliedPaths: [],
            blockedPaths: [],
            reason: 'invalid_payload',
        };
    }

    const values = normalizePresetValues(preset);
    const lockedFields = Array.isArray(preset?.metadata?.lockedFields) ? preset.metadata.lockedFields : [];
    const isOwner = options.accessContext?.isOwner !== false;
    const blockedByFixedPreset = preset?.metadata?.kind === 'fixed' && !isOwner;
    const changedKeys = new Set();
    const appliedPaths = [];
    const blockedPaths = [];

    for (const [path, nextValue] of Object.entries(values)) {
        if (blockedByFixedPreset && lockedFields.includes(path)) {
            blockedPaths.push(path);
            continue;
        }

        const previousValue = getValueAtPath(settings, path);
        if (isPrimitiveEqual(previousValue, nextValue)) continue;

        if (!setValueAtPath(settings, path, cloneValue(nextValue))) continue;
        appliedPaths.push(path);

        const changedKey = getSettingsFieldDescriptor(path)?.changeKey;
        if (changedKey) changedKeys.add(changedKey);
    }

    if (!settings.matchSettings || typeof settings.matchSettings !== 'object') {
        settings.matchSettings = {};
    }
    settings.matchSettings.activePresetId = normalizeString(preset.id);
    settings.matchSettings.activePresetKind = normalizeString(preset?.metadata?.kind, 'open');
    settings.matchSettings.activePresetSourceId = normalizeString(preset?.metadata?.sourcePresetId);

    return {
        applied: appliedPaths.length > 0,
        changedKeys: Array.from(changedKeys),
        appliedPaths,
        blockedPaths,
        reason: appliedPaths.length > 0 ? 'applied' : 'no_changes',
    };
}

export function capturePresetValuesFromSettings(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const values = {};
    for (const path of MENU_PRESET_VALUE_PATHS) {
        const value = getValueAtPath(source, path);
        if (typeof value === 'undefined') continue;
        values[path] = cloneValue(value);
    }
    return values;
}

export function createPresetMetadata(options = {}) {
    const presetId = normalizeString(options.id);
    const kind = normalizeString(options.kind, 'open');
    const ownerId = normalizeString(options.ownerId, 'owner');
    const sourcePresetId = normalizeString(options.sourcePresetId);
    const nowIso = new Date(options.timestamp || Date.now()).toISOString();
    const createdAt = normalizeString(options.createdAt, nowIso);
    const updatedAt = normalizeString(options.updatedAt, nowIso);
    return {
        id: presetId,
        kind,
        ownerId,
        lockedFields: normalizePresetPathList(options.lockedFields),
        sourcePresetId,
        createdAt,
        updatedAt,
    };
}
