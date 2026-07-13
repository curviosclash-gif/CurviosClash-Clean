import {
    CONFIG_BASE,
    refreshConfigRuntimeCache,
} from '../../core/Config.js';
import { cloneJsonValue } from '../../shared/utils/JsonClone.js';
import {
    getTuningParameterDescriptor,
    getTuningParameterDescriptors,
} from './TuningParameterRegistry.js';

function splitPath(path) {
    return String(path || '')
        .split('.')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function getPathValue(source, pathSegments) {
    let cursor = source;
    for (const segment of pathSegments) {
        if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
            return undefined;
        }
        cursor = cursor[segment];
    }
    return cursor;
}

function cloneMutable(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return { ...value };
}

function setPathValue(target, pathSegments, value) {
    if (!target || typeof target !== 'object' || pathSegments.length === 0) {
        return false;
    }
    let cursor = target;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
        const segment = pathSegments[index];
        let nextValue = cursor[segment];
        if (!nextValue || typeof nextValue !== 'object') {
            nextValue = {};
            cursor[segment] = nextValue;
        } else if (Object.isFrozen(nextValue)) {
            nextValue = cloneMutable(nextValue);
            cursor[segment] = nextValue;
        }
        cursor = nextValue;
    }
    const finalSegment = pathSegments[pathSegments.length - 1];
    if (Object.isFrozen(cursor)) {
        return false;
    }
    cursor[finalSegment] = value;
    return true;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return null;
}

function normalizeValueByDescriptor(value, descriptor) {
    if (!descriptor || typeof descriptor !== 'object') {
        return value;
    }
    if (descriptor.type === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        if (Number.isFinite(descriptor.min) && parsed < descriptor.min) return descriptor.min;
        if (Number.isFinite(descriptor.max) && parsed > descriptor.max) return descriptor.max;
        return parsed;
    }
    if (descriptor.type === 'boolean') {
        return normalizeBoolean(value);
    }
    if (descriptor.type === 'color' || descriptor.type === 'string') {
        return String(value ?? '');
    }
    return value;
}

function resolveRefreshFn(refreshFn) {
    if (typeof refreshFn === 'function') {
        return refreshFn;
    }
    return () => false;
}

export class TuningRuntimeBridge {
    constructor({
        configBase = CONFIG_BASE,
        refreshRuntimeConfig = refreshConfigRuntimeCache,
    } = {}) {
        this._configBase = configBase && typeof configBase === 'object' ? configBase : CONFIG_BASE;
        this._refreshRuntimeConfig = resolveRefreshFn(refreshRuntimeConfig);
        this._defaultsSnapshot = cloneJsonValue(this._configBase);
    }

    getValue(path) {
        const descriptor = getTuningParameterDescriptor(path);
        if (!descriptor) return undefined;
        return cloneJsonValue(getPathValue(this._configBase, splitPath(descriptor.path)));
    }

    getAllValues({ includeReadonly = true } = {}) {
        const values = {};
        for (const descriptor of getTuningParameterDescriptors()) {
            if (includeReadonly !== true && descriptor.readOnly === true) {
                continue;
            }
            values[descriptor.path] = this.getValue(descriptor.path);
        }
        return values;
    }

    setValue(path, value, options = undefined) {
        const descriptor = getTuningParameterDescriptor(path);
        if (!descriptor) {
            return { ok: false, reason: 'unknown_path' };
        }
        if (descriptor.readOnly) {
            return { ok: false, reason: 'readonly_path' };
        }
        const normalizedValue = normalizeValueByDescriptor(value, descriptor);
        if (normalizedValue == null && descriptor.type !== 'string' && descriptor.type !== 'color') {
            return { ok: false, reason: 'invalid_value' };
        }
        const pathSegments = splitPath(descriptor.path);
        const wrote = setPathValue(this._configBase, pathSegments, normalizedValue);
        if (!wrote) {
            return { ok: false, reason: 'frozen_target' };
        }
        if (options?.refreshRuntimeConfig !== false) {
            this._refreshRuntimeConfig();
        }
        return {
            ok: true,
            path: descriptor.path,
            value: cloneJsonValue(getPathValue(this._configBase, pathSegments)),
        };
    }

    resetToDefaults(paths = null, options = undefined) {
        const targetDescriptors = Array.isArray(paths) && paths.length > 0
            ? paths
                .map((path) => getTuningParameterDescriptor(path))
                .filter((descriptor) => descriptor && descriptor.readOnly !== true)
            : getTuningParameterDescriptors().filter((descriptor) => descriptor.readOnly !== true);
        for (const descriptor of targetDescriptors) {
            const pathSegments = splitPath(descriptor.path);
            const defaultValue = cloneJsonValue(getPathValue(this._defaultsSnapshot, pathSegments));
            setPathValue(this._configBase, pathSegments, defaultValue);
        }
        if (options?.refreshRuntimeConfig !== false) {
            this._refreshRuntimeConfig();
        }
        return {
            ok: true,
            resetCount: targetDescriptors.length,
        };
    }
}

export function createTuningRuntimeBridge(options = undefined) {
    return new TuningRuntimeBridge(options);
}
