import {
    resolveLocalStorage,
    resolveSessionStorage,
} from '../../../shared/runtime/BrowserStoragePorts.js';
const DEFAULT_CHANNEL_NAME = 'cuviosclash.multiplayer.v1';

export function toCallable(value, fallback = null) {
    return typeof value === 'function' ? value : fallback;
}

export function resolveGlobalObject(explicitGlobal = null) {
    if (explicitGlobal && typeof explicitGlobal === 'object') {
        return explicitGlobal;
    }
    try {
        return globalThis || null;
    } catch {
        return null;
    }
}

export function resolveRuntimeTimer(runtimeTimer, runtimeGlobal, methodName) {
    const directTimer = toCallable(runtimeTimer, null);
    if (directTimer) return directTimer;
    const globalTimer = toCallable(runtimeGlobal?.[methodName], null);
    if (!globalTimer) return null;
    return (...args) => globalTimer.apply(runtimeGlobal, args);
}

export function resolveEventTarget(candidate) {
    if (
        candidate
        && typeof candidate.addEventListener === 'function'
        && typeof candidate.removeEventListener === 'function'
    ) {
        return candidate;
    }
    return null;
}

export function resolveStorage(providedStorage, storageName, runtimeGlobal) {
    if (storageName === 'localStorage') {
        return resolveLocalStorage(providedStorage, runtimeGlobal);
    }
    if (storageName === 'sessionStorage') {
        return resolveSessionStorage(providedStorage, runtimeGlobal);
    }
    if (providedStorage && typeof providedStorage.getItem === 'function') return providedStorage;
    try {
        return runtimeGlobal?.[storageName] || null;
    } catch {
        return null;
    }
}

export function createBroadcastChannelHandle(createBroadcastChannel, runtimeGlobal, channelName = DEFAULT_CHANNEL_NAME) {
    if (typeof createBroadcastChannel === 'function') {
        try {
            return createBroadcastChannel(channelName) || null;
        } catch {
            return null;
        }
    }
    if (typeof runtimeGlobal?.BroadcastChannel !== 'function') return null;
    try {
        return new runtimeGlobal.BroadcastChannel(channelName);
    } catch {
        return null;
    }
}
