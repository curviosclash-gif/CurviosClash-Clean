import { cloneJsonValue } from '../../shared/utils/JsonClone.js';

let ACTIVE_RUNTIME_CONFIG = null;
let ACTIVE_RUNTIME_CONFIG_OWNER = null;

function cloneValue(value) {
    return cloneJsonValue(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object') return value;
    Object.freeze(value);
    for (const entry of Object.values(value)) {
        if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) {
            deepFreeze(entry);
        }
    }
    return value;
}

export function setActiveRuntimeConfig(config, options = undefined) {
    const nextOwner = options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'owner')
        ? options.owner
        : ACTIVE_RUNTIME_CONFIG_OWNER;
    ACTIVE_RUNTIME_CONFIG = config && typeof config === 'object'
        ? deepFreeze(cloneValue(config))
        : null;
    ACTIVE_RUNTIME_CONFIG_OWNER = ACTIVE_RUNTIME_CONFIG ? nextOwner ?? null : null;
    return ACTIVE_RUNTIME_CONFIG;
}

export function getActiveRuntimeConfig(fallback = null) {
    if (ACTIVE_RUNTIME_CONFIG && typeof ACTIVE_RUNTIME_CONFIG === 'object') {
        return ACTIVE_RUNTIME_CONFIG;
    }
    return fallback;
}

export function getActiveRuntimeConfigOwner() {
    return ACTIVE_RUNTIME_CONFIG_OWNER;
}

export function clearActiveRuntimeConfig(options = undefined) {
    if (options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'owner')) {
        const requestedOwner = options.owner;
        if (ACTIVE_RUNTIME_CONFIG_OWNER && requestedOwner && ACTIVE_RUNTIME_CONFIG_OWNER !== requestedOwner) {
            return false;
        }
        if (ACTIVE_RUNTIME_CONFIG_OWNER && requestedOwner == null) {
            return false;
        }
    }
    ACTIVE_RUNTIME_CONFIG = null;
    ACTIVE_RUNTIME_CONFIG_OWNER = null;
    return true;
}

export function refreshActiveRuntimeConfig(options = undefined) {
    if (!ACTIVE_RUNTIME_CONFIG || typeof ACTIVE_RUNTIME_CONFIG !== 'object') {
        return false;
    }
    return clearActiveRuntimeConfig(options);
}

export function createActiveRuntimeConfigReadPort(options = undefined) {
    const fallback = options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'fallback')
        ? options.fallback
        : null;
    return Object.freeze({
        kind: 'ActiveRuntimeConfigStoreReadPort',
        migration: 'session-runtime-config-transition',
        getConfig(nextFallback = fallback) {
            return getActiveRuntimeConfig(nextFallback);
        },
        getOwner() {
            return getActiveRuntimeConfigOwner();
        },
        refresh(refreshOptions = undefined) {
            return refreshActiveRuntimeConfig(refreshOptions);
        },
    });
}
