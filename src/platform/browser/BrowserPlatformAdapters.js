import {
    PLATFORM_CAPABILITY_IDS,
} from '../../shared/contracts/PlatformCapabilityContract.js';
import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    resolveCapabilityProviderKind,
} from '../../shared/contracts/PlatformCapabilityRegistry.js';
import {
    createCapabilityAdapterDescriptor,
    resolveCapabilityAvailability,
} from '../PlatformCapabilityAdapterSupport.js';

const BROWSER_DEMO_PROVIDER_OPTIONS = Object.freeze({
    productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeSaveResult(result, defaultSaved = true) {
    if (result && typeof result === 'object') {
        return {
            saved: result.saved !== false,
            ...result,
        };
    }
    if (result === false) {
        return { saved: false };
    }
    return { saved: defaultSaved };
}

async function invokeSaveImpl(saveImpl, args, defaultSaved = true) {
    if (typeof saveImpl !== 'function') {
        return { saved: false };
    }
    try {
        const result = await saveImpl(...args);
        return normalizeSaveResult(result, defaultSaved);
    } catch (error) {
        return {
            saved: false,
            error,
        };
    }
}

export function createBrowserDiscoveryAdapter() {
    const startDiscovery = null;
    const stopDiscovery = null;
    const getDiscoveredHosts = null;
    const onDiscoveredHosts = null;
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.DISCOVERY,
        null,
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
                ...BROWSER_DEMO_PROVIDER_OPTIONS,
                available: false,
            }),
            contractVersion: 'browser.discovery.v1',
            degradedReason: 'desktop_only',
        },
        {
            available: false,
            resolvedFlags: {
                supportsSubscribe: false,
            },
        }
    );

    return Object.freeze({
        adapterName: 'browser.discovery.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        startDiscovery,
        stopDiscovery,
        getDiscoveredHosts,
        onDiscoveredHosts,
    });
}

export function createBrowserHostAdapter() {
    const getLanServerStatus = null;
    const startLanServer = null;
    const stopLanServer = null;
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.HOST,
        null,
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.HOST, {
                ...BROWSER_DEMO_PROVIDER_OPTIONS,
                available: false,
            }),
            contractVersion: 'browser.host.v1',
            degradedReason: 'desktop_only',
        },
        {
            available: false,
            resolvedFlags: {
                supportsSessionOwnership: false,
            },
        }
    );

    return Object.freeze({
        adapterName: 'browser.host.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        getLanServerStatus,
        startLanServer,
        stopLanServer,
        getStatus: getLanServerStatus,
        start: startLanServer,
        stop: stopLanServer,
    });
}

export function createBrowserSaveAdapter(options = {}) {
    const saveReplayImpl = typeof options.saveReplay === 'function' ? options.saveReplay : null;
    const saveVideoImpl = typeof options.saveVideo === 'function' ? options.saveVideo : null;
    const saveReplay = typeof saveReplayImpl === 'function'
        ? (payload, fileName) => invokeSaveImpl(saveReplayImpl, [payload, fileName], true)
        : null;
    const saveVideo = typeof saveVideoImpl === 'function'
        ? (payload, fileName, mimeType) => invokeSaveImpl(saveVideoImpl, [payload, fileName, mimeType], true)
        : null;
    const available = resolveCapabilityAvailability([saveReplay, saveVideo], 'any');
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.SAVE,
        options,
        {
            providerKind: normalizeString(options.providerKind, resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.SAVE, {
                ...BROWSER_DEMO_PROVIDER_OPTIONS,
                available,
            })),
            contractVersion: normalizeString(options.contractVersion, 'browser.save.v1'),
            degradedReason: normalizeString(options.degradedReason, available ? '' : 'save_unavailable'),
        },
        {
            available,
            resolvedFlags: {
                supportsBinaryExport: typeof saveVideo === 'function',
            },
        }
    );

    return Object.freeze({
        adapterName: 'browser.save.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        saveReplay,
        saveVideo,
    });
}

export function createBrowserRecordingAdapter(options = {}) {
    const available = options.available === true;
    const supportsCapture = options.supportsCapture === true || available;
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.RECORDING,
        options,
        {
            providerKind: normalizeString(options.providerKind, resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.RECORDING, {
                ...BROWSER_DEMO_PROVIDER_OPTIONS,
                available,
            })),
            contractVersion: normalizeString(options.contractVersion, 'browser.recording.v1'),
            degradedReason: normalizeString(options.degradedReason, available ? '' : 'recording_unavailable'),
        },
        {
            available,
            resolvedFlags: {
                supportsCapture,
            },
        }
    );

    return Object.freeze({
        adapterName: 'browser.recording.v1',
        contractVersion: capability.contractVersion,
        capability,
        support: options.support && typeof options.support === 'object'
            ? { ...options.support }
            : null,
        isAvailable: () => capability.available === true,
    });
}
