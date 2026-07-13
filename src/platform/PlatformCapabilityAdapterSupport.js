import { createPlatformCapabilityDescriptor } from '../shared/contracts/PlatformCapabilityContract.js';

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function toDescriptor(source = null) {
    return source && typeof source === 'object' ? source : {};
}

export function bindCapabilityIntent(intentContext, intentFn) {
    if (typeof intentFn !== 'function') {
        return null;
    }
    return (...args) => intentFn.call(intentContext, ...args);
}

export function createCapabilityIntent(primaryContext, primaryFn, fallbackContext, fallbackFn) {
    return bindCapabilityIntent(primaryContext, primaryFn)
        || bindCapabilityIntent(fallbackContext, fallbackFn);
}

export function resolveCapabilityAvailability(intents = [], mode = 'all') {
    const intentList = Array.isArray(intents) ? intents : [intents];
    const callableCount = intentList.filter((intent) => typeof intent === 'function').length;
    if (callableCount === 0) {
        return false;
    }
    if (normalizeString(mode, 'all') === 'any') {
        return true;
    }
    return callableCount === intentList.length;
}

export function createCapabilityAdapterDescriptor(
    capabilityId,
    descriptor,
    fallbackDescriptor = {},
    options = {}
) {
    const source = toDescriptor(descriptor);
    const fallback = toDescriptor(fallbackDescriptor);
    const resolvedFlags = toDescriptor(options.resolvedFlags);
    const available = options.available === true || fallback.available === true;
    const payload = {
        ...fallback,
        ...source,
        available,
        contractVersion: normalizeString(
            source.contractVersion,
            normalizeString(fallback.contractVersion, '')
        ),
        providerKind: normalizeString(
            source.providerKind,
            normalizeString(fallback.providerKind, 'unavailable')
        ),
        degradedReason: available
            ? normalizeString(source.degradedReason, '')
            : normalizeString(
                source.degradedReason,
                normalizeString(fallback.degradedReason, '')
            ),
    };

    for (const [flagName, flagValue] of Object.entries(resolvedFlags)) {
        payload[flagName] = flagValue === true;
    }

    return Object.freeze(createPlatformCapabilityDescriptor(capabilityId, payload));
}
