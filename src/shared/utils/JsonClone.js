export function cloneJsonValue(value) {
    if (typeof globalThis?.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

export function tryCloneJsonValue(value, fallback = null) {
    try {
        return cloneJsonValue(value);
    } catch {
        return fallback;
    }
}

export function cloneJsonCompatibleValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (Array.isArray(value)) return value.map((entry) => cloneJsonCompatibleValue(entry));
    if (!value || typeof value !== 'object') return undefined;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const clonedEntry = cloneJsonCompatibleValue(entry);
        if (clonedEntry !== undefined) result[key] = clonedEntry;
    }
    return result;
}
