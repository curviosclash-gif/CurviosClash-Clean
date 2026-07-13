import { normalizeString } from './ContractNormalizeUtils.js';

export const PLATFORM_CAPABILITY_SNAPSHOT_CONTRACT_VERSION = 'platform-capability-snapshot.v1';

export const PLATFORM_CAPABILITY_IDS = Object.freeze({
    DISCOVERY: 'discovery',
    HOST: 'host',
    SAVE: 'save',
    RECORDING: 'recording',
});

export function createPlatformCapabilityDescriptor(capabilityId, descriptor = {}) {
    const source = /** @type {Record<string, any>} */ (
        descriptor && typeof descriptor === 'object' ? descriptor : {}
    );
    return {
        capabilityId: normalizeString(capabilityId, 'unknown'),
        available: source.available === true,
        providerKind: normalizeString(source.providerKind, 'unavailable'),
        contractVersion: normalizeString(source.contractVersion, ''),
        degradedReason: normalizeString(source.degradedReason, ''),
        supportsSubscribe: source.supportsSubscribe === true,
        supportsSessionOwnership: source.supportsSessionOwnership === true,
        supportsBinaryExport: source.supportsBinaryExport === true,
        supportsCapture: source.supportsCapture === true,
    };
}

export function createPlatformCapabilitySnapshot(source = {}) {
    const payload = /** @type {Record<string, any>} */ (
        source && typeof source === 'object' ? source : {}
    );
    return {
        contractVersion: PLATFORM_CAPABILITY_SNAPSHOT_CONTRACT_VERSION,
        runtimeKind: normalizeString(payload.runtimeKind, 'web'),
        discovery: createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.DISCOVERY, payload.discovery),
        host: createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.HOST, payload.host),
        save: createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.SAVE, payload.save),
        recording: createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.RECORDING, payload.recording),
    };
}
