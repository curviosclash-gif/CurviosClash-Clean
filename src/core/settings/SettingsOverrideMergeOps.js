import { cloneJsonValue } from '../../shared/utils/JsonClone.js';

export function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function deepCloneJson(value) {
    return cloneJsonValue(value);
}

export function readPathValue(source, path) {
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

export function writePathValue(target, path, value) {
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

export function deepMergeKnownShape(baseValue, candidateValue) {
    if (Array.isArray(baseValue)) {
        return Array.isArray(candidateValue)
            ? deepCloneJson(candidateValue)
            : deepCloneJson(baseValue);
    }

    if (!isPlainObject(baseValue)) {
        return candidateValue === undefined
            ? deepCloneJson(baseValue)
            : deepCloneJson(candidateValue);
    }

    const result = deepCloneJson(baseValue);
    if (!isPlainObject(candidateValue)) {
        return result;
    }

    const baseKeys = Object.keys(baseValue);
    const mergeKeys = baseKeys.length ? baseKeys : Object.keys(candidateValue);
    for (const key of mergeKeys) {
        if (!(key in candidateValue)) continue;
        if (key in baseValue) {
            result[key] = deepMergeKnownShape(baseValue[key], candidateValue[key]);
            continue;
        }
        result[key] = deepCloneJson(candidateValue[key]);
    }
    return result;
}

function collectPrimitiveLeafPathsInternal(value, prefix, entries) {
    if (Array.isArray(value)) {
        entries.push(prefix);
        return;
    }

    if (!isPlainObject(value)) {
        entries.push(prefix);
        return;
    }

    const keys = Object.keys(value);
    if (!keys.length) {
        entries.push(prefix);
        return;
    }

    for (const key of keys) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        collectPrimitiveLeafPathsInternal(value[key], nextPrefix, entries);
    }
}

export function collectPrimitiveLeafPaths(value, prefix = '') {
    const entries = [];
    collectPrimitiveLeafPathsInternal(value, prefix, entries);
    return entries.filter(Boolean);
}
