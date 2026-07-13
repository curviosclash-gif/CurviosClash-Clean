function resolveRuntimeScope(explicitScope = null) {
    if (explicitScope && typeof explicitScope === 'object') {
        return explicitScope;
    }
    try {
        return globalThis || null;
    } catch {
        return null;
    }
}

function resolveStorageByName(storageName, explicitStorage = null, runtimeScope = null) {
    if (explicitStorage && typeof explicitStorage.getItem === 'function') {
        return explicitStorage;
    }
    const scope = resolveRuntimeScope(runtimeScope);
    try {
        return scope?.[storageName] || null;
    } catch {
        return null;
    }
}

export function resolveLocalStorage(explicitStorage = null, runtimeScope = null) {
    return resolveStorageByName('localStorage', explicitStorage, runtimeScope);
}

export function resolveSessionStorage(explicitStorage = null, runtimeScope = null) {
    return resolveStorageByName('sessionStorage', explicitStorage, runtimeScope);
}
