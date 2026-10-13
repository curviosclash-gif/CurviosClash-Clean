import { createTuningRuntimeBridge } from './TuningRuntimeBridge.js';
import { getTuningParameterRegistry } from './TuningParameterRegistry.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';
import { createMapBalancingLiveApi } from '../../core/balancing/MapBalancingLive.js';
import { createTelemetryDevApi } from '../../core/telemetry/TelemetryDevApi.js';

const ACTIONS = Object.freeze({
    getAll: 'tuning:get-all',
    setValue: 'tuning:set-value',
    resetAll: 'tuning:reset-all',
    getRegistry: 'tuning:get-registry',
    balancing: 'tuning:balancing',
    telemetry: 'tuning:telemetry',
});

// Round telemetry of the F7 console; the main process writes export files and asks no dialog
// for clearing (the console arms its button twice instead).
async function executeTelemetryAction(payload) {
    const api = createTelemetryDevApi();
    const op = String(payload.op || '');
    if (op === 'overview') return { ok: true, reason: 'ok', value: await api.overview(payload.filters) };
    if (op === 'export') return { ok: true, reason: 'ok', value: await api.exportData(payload.filters, payload.format) };
    if (op === 'clear') return { ok: true, reason: 'ok', value: await api.clear() };
    return { ok: false, reason: 'unknown_telemetry_op', value: null };
}

// Map balancing operations of the F7 console; saving happens in the main process.
function executeBalancingAction(payload) {
    const api = createMapBalancingLiveApi();
    const options = { mapKey: typeof payload.mapKey === 'string' ? payload.mapKey : '' };
    switch (String(payload.op || '')) {
        case 'describe': return api.describe({ ...options, modePath: payload.modePath });
        case 'set-value': return api.setValue(payload.key, payload.value, options);
        case 'reset-value': return api.resetValue(payload.key, options);
        case 'discard': return api.discard(options);
        case 'mark-saved': return api.markSaved(options.mapKey, payload.layer);
        case 'set-authoritative': return api.setAuthoritative(payload.enabled);
        default: return { ok: false, reason: 'unknown_balancing_op', value: null };
    }
}

function createError(reason, detail = '') {
    return { reason, message: String(detail || reason) };
}

function executeAction(bridge, action, payload = null) {
    const requestPayload = payload && typeof payload === 'object' ? payload : {};
    if (action === ACTIONS.getRegistry) return { ok: true, reason: 'ok', value: getTuningParameterRegistry() };
    if (action === ACTIONS.getAll) return { ok: true, reason: 'ok', value: bridge.getAllValues() };
    if (action === ACTIONS.balancing) {
        const result = executeBalancingAction(requestPayload);
        const value = result.value ? { ...result.value, liveApplied: result.liveApplied === true } : null;
        return { ok: result.ok === true, reason: String(result.reason || 'ok'), value, detail: String(result.detail || '') };
    }
    if (action === ACTIONS.telemetry) return executeTelemetryAction(requestPayload);
    if (action === ACTIONS.setValue) {
        const result = bridge.setValue(String(requestPayload.path || ''), requestPayload.value);
        return { ok: result.ok === true, reason: String(result.reason || 'ok'), value: result };
    }
    if (action === ACTIONS.resetAll) {
        const paths = Array.isArray(requestPayload.paths)
            ? requestPayload.paths.map((value) => String(value || '').trim()).filter(Boolean)
            : null;
        const result = bridge.resetToDefaults(paths);
        return { ok: result.ok === true, reason: String(result.reason || 'ok'), value: result };
    }
    return { ok: false, reason: 'unknown_action', value: null };
}

export function installDesktopTuningRuntimeBridge(runtimeGlobal = globalThis) {
    const transport = resolveElectronRuntimeSnapshot(runtimeGlobal).tuningRuntimeContract;
    if (!transport || typeof transport.subscribeRequests !== 'function' || typeof transport.sendResponse !== 'function') {
        return () => {};
    }
    const bridge = createTuningRuntimeBridge();
    return transport.subscribeRequests((request = null) => {
        const requestId = String(request?.requestId || '').trim();
        if (!requestId) return;
        const sendResult = (result) => {
            const ok = result.ok === true;
            transport.sendResponse({
                requestId,
                ok,
                reason: String(result.reason || (ok ? 'ok' : 'runtime_error')),
                detail: String(result.detail || ''),
                error: ok ? null : createError(String(result.reason || 'runtime_error')),
                value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : null,
            });
        };
        const sendError = (error) => transport.sendResponse({
            requestId,
            ok: false,
            reason: String(error?.reason || 'handler_threw'),
            detail: error instanceof Error ? error.message : String(error || 'handler_threw'),
            error: createError(String(error?.reason || 'handler_threw'), error instanceof Error ? error.message : error),
            value: null,
        });
        try {
            const result = executeAction(bridge, String(request?.action || '').trim(), request?.payload);
            // Telemetry reads IndexedDB and answers later; every other action answers at once.
            if (typeof result?.then === 'function') result.then(sendResult, sendError);
            else sendResult(result);
        } catch (error) {
            sendError(error);
        }
    });
}
