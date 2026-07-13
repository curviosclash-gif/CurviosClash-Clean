import {
    HANGAR_CAPABILITY_IDS,
    assertHangarCapabilityId,
} from '../../shared/contracts/HangarModeContract.js';
import { resolveHangarWorkshopModule } from './HangarWorkshopModuleContract.js';

export const HANGAR_WORKSHOP_PERSISTENCE_FACADE_VERSION = 'hangar-workshop-persistence-facade.v1';

export const HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS = Object.freeze({
    LOAD: 'load',
    SAVE: 'save',
    RENAME: 'rename',
    DELETE: 'delete',
});

export const HANGAR_WORKSHOP_PERSISTENCE_CAPABILITY_MAP = Object.freeze({
    [HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.LOAD]: HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT,
    [HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.SAVE]: HANGAR_CAPABILITY_IDS.SAVE_CUSTOM_BLUEPRINT,
    [HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.RENAME]: HANGAR_CAPABILITY_IDS.RENAME_CUSTOM_BLUEPRINT,
    [HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.DELETE]: HANGAR_CAPABILITY_IDS.DELETE_CUSTOM_BLUEPRINT,
});

function normalizeWorkshopRecord(value) {
    if (!value || typeof value !== 'object') return {};
    return value;
}

function normalizeCapabilityFailure(result, fallbackCode = 'capability_failed') {
    const code = String(result?.code || fallbackCode).trim() || fallbackCode;
    const message = String(result?.message || result?.error || code).trim() || code;
    return { code, message };
}

function createUnavailableResult(operation, capabilityId) {
    return Object.freeze({
        ok: false,
        operation,
        capabilityId,
        code: 'capability_unavailable',
    });
}

async function invokeWorkshopCapability(invokeCapability, operation, payload = {}) {
    const capabilityId = HANGAR_WORKSHOP_PERSISTENCE_CAPABILITY_MAP[operation];
    const validatedCapabilityId = assertHangarCapabilityId(capabilityId);
    if (!validatedCapabilityId || typeof invokeCapability !== 'function') {
        return createUnavailableResult(operation, capabilityId);
    }
    try {
        const result = await invokeCapability(validatedCapabilityId, payload);
        const normalizedResult = normalizeWorkshopRecord(result);
        if (normalizedResult?.ok === false) {
            const failure = normalizeCapabilityFailure(normalizedResult, 'capability_rejected');
            return Object.freeze({
                ok: false,
                operation,
                capabilityId: validatedCapabilityId,
                code: failure.code,
                message: failure.message,
                result: normalizedResult,
            });
        }
        return Object.freeze({
            ok: true,
            operation,
            capabilityId: validatedCapabilityId,
            result: normalizedResult,
        });
    } catch (error) {
        const failure = normalizeCapabilityFailure(error, 'capability_failed');
        return Object.freeze({
            ok: false,
            operation,
            capabilityId: validatedCapabilityId,
            code: failure.code,
            message: failure.message,
        });
    }
}

export function resolveHangarWorkshopPersistenceCapabilities(rawMode) {
    const moduleBinding = resolveHangarWorkshopModule(rawMode);
    const capabilities = moduleBinding?.capabilities || {};
    return Object.freeze({
        loadCustom: assertHangarCapabilityId(capabilities.loadCustom),
        saveCustom: assertHangarCapabilityId(capabilities.saveCustom),
        renameCustom: assertHangarCapabilityId(capabilities.renameCustom),
        deleteCustom: assertHangarCapabilityId(capabilities.deleteCustom),
    });
}

export function createHangarWorkshopPersistenceFacade(options = {}) {
    const invokeCapability = typeof options.invokeCapability === 'function'
        ? options.invokeCapability
        : null;

    return Object.freeze({
        version: HANGAR_WORKSHOP_PERSISTENCE_FACADE_VERSION,
        capabilities: Object.freeze({ ...HANGAR_WORKSHOP_PERSISTENCE_CAPABILITY_MAP }),
        loadCustomVehicle: async (payload = {}) => invokeWorkshopCapability(
            invokeCapability,
            HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.LOAD,
            payload
        ),
        saveCustomVehicle: async (payload = {}) => invokeWorkshopCapability(
            invokeCapability,
            HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.SAVE,
            payload
        ),
        renameCustomVehicle: async (payload = {}) => invokeWorkshopCapability(
            invokeCapability,
            HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.RENAME,
            payload
        ),
        deleteCustomVehicle: async (payload = {}) => invokeWorkshopCapability(
            invokeCapability,
            HANGAR_WORKSHOP_PERSISTENCE_OPERATIONS.DELETE,
            payload
        ),
    });
}
