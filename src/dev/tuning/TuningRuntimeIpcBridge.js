import { createTuningRuntimeBridge } from './TuningRuntimeBridge.js';
import { getTuningParameterRegistry } from './TuningParameterRegistry.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';

const ACTIONS = Object.freeze({
    getAll: 'tuning:get-all',
    setValue: 'tuning:set-value',
    resetAll: 'tuning:reset-all',
    getRegistry: 'tuning:get-registry',
});

function createError(reason, detail = '') {
    return { reason, message: String(detail || reason) };
}

function executeAction(bridge, action, payload = null) {
    const requestPayload = payload && typeof payload === 'object' ? payload : {};
    if (action === ACTIONS.getRegistry) return { ok: true, reason: 'ok', value: getTuningParameterRegistry() };
    if (action === ACTIONS.getAll) return { ok: true, reason: 'ok', value: bridge.getAllValues() };
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
        try {
            const result = executeAction(bridge, String(request?.action || '').trim(), request?.payload);
            const ok = result.ok === true;
            transport.sendResponse({
                requestId,
                ok,
                reason: String(result.reason || (ok ? 'ok' : 'runtime_error')),
                detail: '',
                error: ok ? null : createError(String(result.reason || 'runtime_error')),
                value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : null,
            });
        } catch (error) {
            transport.sendResponse({
                requestId,
                ok: false,
                reason: 'handler_threw',
                detail: error instanceof Error ? error.message : String(error || 'handler_threw'),
                error: createError('handler_threw', error instanceof Error ? error.message : error),
                value: null,
            });
        }
    });
}
