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
