// Explicitly approved snapshots, scoped to one map and mode. Draft changes never alter
// these values. The same document works in local user data and in a later game release.
import {
    MAP_BALANCING_FIELDS,
    MAP_BALANCING_MODE_IDS,
    isValidMapBalancingMapKey,
    validateMapBalancingMapDocument,
} from './MapBalancingContract.js';

export const APPLIED_MAP_BALANCING_VERSION = 1;
export const APPLIED_MAP_BALANCING_FIELDS = Object.freeze(
    MAP_BALANCING_FIELDS.filter((field) => field.group !== 'arcadeStage')
);
const MODES = new Set(Object.values(MAP_BALANCING_MODE_IDS));

/** @param {{ mapKey?: unknown, modePath?: unknown }} [target] */
export function appliedMapBalancingKey({ mapKey, modePath } = {}) {
    return `${modePath}:${mapKey}`;
}

export function validateAppliedMapBalancingDocument(document) {
    const errors = [];
    if (document?.version !== APPLIED_MAP_BALANCING_VERSION || !Array.isArray(document?.entries)
        || document.entries.length > 512) return { ok: false, errors: ['Invalid applied map balancing document.'] };
    const seen = new Set();
    for (const entry of document.entries) {
        if (!entry || !isValidMapBalancingMapKey(entry.mapKey) || !MODES.has(entry.modePath)
            || typeof entry.enabled !== 'boolean') {
            errors.push('Invalid map, mode or activation state.');
            continue;
        }
        const key = appliedMapBalancingKey(entry);
        if (entry.version !== undefined && entry.version !== APPLIED_MAP_BALANCING_VERSION) errors.push(`${key}: unsupported version.`);
        if (seen.has(key)) errors.push(`Duplicate map/mode: ${key}`);
        seen.add(key);
        if (!entry.enabled) {
            if (entry.values !== undefined) errors.push(`${key}: disabled snapshot must not carry values.`);
            continue;
        }
        const validation = validateMapBalancingMapDocument({ version: 1, mapKey: entry.mapKey, values: entry.values });
        errors.push(...validation.errors);
        for (const field of APPLIED_MAP_BALANCING_FIELDS) {
            if (!Object.hasOwn(entry.values || {}, field.key)) errors.push(`${key}: missing ${field.key}`);
        }
        if (Object.keys(entry.values || {}).some((name) => !APPLIED_MAP_BALANCING_FIELDS.some((field) => field.key === name))) {
            errors.push(`${key}: unsupported applied value.`);
        }
    }
    return { ok: errors.length === 0, errors };
}

export function normalizeAppliedMapBalancingDocument(document) {
    if (!validateAppliedMapBalancingDocument(document).ok) return { version: APPLIED_MAP_BALANCING_VERSION, entries: [] };
    return {
        version: APPLIED_MAP_BALANCING_VERSION,
        entries: document.entries.map((entry) => ({
            mapKey: entry.mapKey, modePath: entry.modePath, enabled: entry.enabled,
            ...(entry.enabled ? { values: Object.fromEntries(APPLIED_MAP_BALANCING_FIELDS.map(({ key }) => [key, entry.values[key]])) } : {}),
        })).sort((a, b) => appliedMapBalancingKey(a).localeCompare(appliedMapBalancingKey(b))),
    };
}
