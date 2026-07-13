const path = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');

const TUNING_IPC_CONTRACT_VERSION = 'tuning-ipc.v1';
const TUNING_UPDATE_CONTRACT_VERSION = 'tuning-update.v1';
const TUNING_RUNTIME_REQUEST_CHANNEL = 'tuning-runtime:request';
const TUNING_RUNTIME_RESPONSE_CHANNEL = 'tuning-runtime:response';
const TUNING_UPDATE_CHANNEL = 'tuning:update';

const TUNING_CHANNELS = Object.freeze({
    getAll: 'tuning:get-all',
    setValue: 'tuning:set-value',
    resetAll: 'tuning:reset-all',
    getRegistry: 'tuning:get-registry',
    getCapability: 'tuning:get-capability',
    exportPresetJson: 'tuning:export-preset-json',
    importPresetJson: 'tuning:import-preset-json',
});

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

function isWindowAlive(windowRef) {
    return !!windowRef && !windowRef.isDestroyed();
}

function resolveCapabilityStateSnapshot(resolveCapabilityState) {
    const sourceState = typeof resolveCapabilityState === 'function'
        ? resolveCapabilityState()
        : null;
    const available = sourceState?.available === true;
    return Object.freeze({
        contractVersion: String(sourceState?.contractVersion || 'tuning-desktop-capability.v1'),
        capabilityId: String(sourceState?.capabilityId || 'developer-tuning-console'),
        available,
        accessMode: String(sourceState?.accessMode || (available ? 'desktop-capability' : 'blocked')),
        reason: String(sourceState?.reason || (available ? 'desktop_capability_enabled' : 'desktop_capability_blocked')),
        message: String(sourceState?.message || (
            available
                ? 'Developer Tuning Console ist auf dieser Desktop-Surface verfuegbar.'
                : 'Developer Tuning Console ist auf dieser Surface nicht verfuegbar.'
        )),
        passwordGate: String(sourceState?.passwordGate || 'local-ux-only'),
    });
}

function createForwardError(reason, capability = null, detail = '') {
    return {
        ok: false,
        reason: String(reason || 'runtime_error'),
        detail: String(detail || ''),
        capability,
        value: null,
    };
}

function createRequestId(counterRef) {
    counterRef.value += 1;
    return `tuning:${Date.now()}:${counterRef.value}`;
}

function resolveDialogParentWindow(resolveTuningWindow, resolveGameWindow) {
    const tuningWindow = typeof resolveTuningWindow === 'function' ? resolveTuningWindow() : null;
    if (isWindowAlive(tuningWindow)) {
        return tuningWindow;
    }
    const gameWindow = typeof resolveGameWindow === 'function' ? resolveGameWindow() : null;
    return isWindowAlive(gameWindow) ? gameWindow : null;
}

function normalizeExportFileName(fileName) {
    const normalized = String(fileName || '').trim();
    if (!normalized) {
        return 'tuning-preset.json';
    }
    return normalized.toLowerCase().endsWith('.json')
        ? normalized
        : `${normalized}.json`;
}

function registerTuningIpc({
    ipcMain,
    dialog,
    resolveGameWindow = () => null,
    resolveTuningWindow = () => null,
    resolveCapabilityState = () => ({ available: true }),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') {
        throw new TypeError('registerTuningIpc erwartet ipcMain mit handle().');
    }

    const pendingResponses = new Map();
    const requestCounterRef = { value: 0 };

    const onRuntimeResponse = (_event, payload) => {
        const response = payload && typeof payload === 'object' ? payload : {};
        const requestId = String(response.requestId || '').trim();
        if (!requestId || !pendingResponses.has(requestId)) {
            return;
        }
        const pending = pendingResponses.get(requestId);
        pendingResponses.delete(requestId);
        clearTimeout(pending.timeoutId);
        const ok = response.ok === true;
        pending.resolve({
            ok,
            reason: ok ? 'ok' : String(response.reason || 'runtime_error'),
            detail: ok ? '' : String(response.detail || ''),
            error: ok ? null : (response.error && typeof response.error === 'object' ? response.error : null),
            value: Object.prototype.hasOwnProperty.call(response, 'value') ? response.value : null,
            capability: pending.capability,
        });
    };

    ipcMain.on(TUNING_RUNTIME_RESPONSE_CHANNEL, onRuntimeResponse);

    async function forwardToGameWindow(action, payload = null) {
        const capability = resolveCapabilityStateSnapshot(resolveCapabilityState);
        if (capability.available !== true) {
            return createForwardError('capability_blocked', capability, capability.message);
        }
        const gameWindow = resolveGameWindow();
        if (!isWindowAlive(gameWindow)) {
            return createForwardError('game_window_unavailable', capability, 'Game-Window ist nicht verfuegbar.');
        }

        const requestId = createRequestId(requestCounterRef);
        const timeoutMs = Math.max(200, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                if (!pendingResponses.has(requestId)) {
                    return;
                }
                pendingResponses.delete(requestId);
                resolve(createForwardError(
                    'runtime_timeout',
                    capability,
                    `Tuning-Request ${action} wurde nach ${timeoutMs}ms nicht beantwortet.`
                ));
            }, timeoutMs);

            pendingResponses.set(requestId, {
                resolve,
                timeoutId,
                capability,
            });

            try {
                gameWindow.webContents.send(TUNING_RUNTIME_REQUEST_CHANNEL, {
                    requestId,
                    action: String(action || ''),
                    payload,
                });
            } catch (error) {
                clearTimeout(timeoutId);
                pendingResponses.delete(requestId);
                resolve(createForwardError(
                    'runtime_send_failed',
                    capability,
                    error instanceof Error ? error.message : String(error || 'runtime_send_failed')
                ));
            }
        });
    }

    async function emitTuningUpdate(trigger = 'unknown', metadata = null) {
        const tuningWindow = resolveTuningWindow();
        if (!isWindowAlive(tuningWindow)) {
            return false;
        }
        const snapshot = await forwardToGameWindow(TUNING_CHANNELS.getAll, null);
        try {
            tuningWindow.webContents.send(TUNING_UPDATE_CHANNEL, {
                contractVersion: TUNING_UPDATE_CONTRACT_VERSION,
                trigger: String(trigger || 'unknown'),
                emittedAt: Date.now(),
                metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
                snapshot,
            });
            return true;
        } catch {
            return false;
        }
    }

    ipcMain.handle(TUNING_CHANNELS.getCapability, async () => ({
        ok: true,
        capability: resolveCapabilityStateSnapshot(resolveCapabilityState),
    }));

    ipcMain.handle(TUNING_CHANNELS.getRegistry, async () => (
        forwardToGameWindow(TUNING_CHANNELS.getRegistry, null)
    ));

    ipcMain.handle(TUNING_CHANNELS.getAll, async () => (
        forwardToGameWindow(TUNING_CHANNELS.getAll, null)
    ));

    ipcMain.handle(TUNING_CHANNELS.setValue, async (_event, payload = null) => {
        const requestPayload = payload && typeof payload === 'object'
            ? payload
            : {};
        const result = await forwardToGameWindow(TUNING_CHANNELS.setValue, {
            path: String(requestPayload.path || ''),
            value: requestPayload.value,
        });
        if (result.ok === true) {
            await emitTuningUpdate('set-value', { path: String(requestPayload.path || '') });
        }
        return result;
    });

    ipcMain.handle(TUNING_CHANNELS.resetAll, async (_event, payload = null) => {
        const requestPayload = payload && typeof payload === 'object'
            ? payload
            : {};
        const normalizedPaths = Array.isArray(requestPayload.paths)
            ? requestPayload.paths.map((value) => String(value || '').trim()).filter(Boolean)
            : null;
        const result = await forwardToGameWindow(TUNING_CHANNELS.resetAll, {
            paths: normalizedPaths,
        });
        if (result.ok === true) {
            await emitTuningUpdate('reset-all', {
                pathCount: Array.isArray(normalizedPaths) ? normalizedPaths.length : 0,
            });
        }
        return result;
    });

    ipcMain.handle(TUNING_CHANNELS.exportPresetJson, async (_event, payload = null) => {
        const capability = resolveCapabilityStateSnapshot(resolveCapabilityState);
        if (capability.available !== true) {
            return createForwardError('capability_blocked', capability, capability.message);
        }
        if (!dialog || typeof dialog.showSaveDialog !== 'function') {
            return createForwardError('dialog_unavailable', capability, 'Save-Dialog ist nicht verfuegbar.');
        }
        const requestPayload = payload && typeof payload === 'object'
            ? payload
            : {};
        const fileName = normalizeExportFileName(requestPayload.fileName);
        const presetData = requestPayload.presetData;
        if (!presetData || typeof presetData !== 'object') {
            return createForwardError('invalid_preset_payload', capability, 'Preset-Daten fehlen oder sind ungueltig.');
        }

        const dialogResult = await dialog.showSaveDialog(
            resolveDialogParentWindow(resolveTuningWindow, resolveGameWindow),
            {
                title: 'Tuning-Preset exportieren',
                defaultPath: fileName,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            }
        );

        if (dialogResult.canceled || !dialogResult.filePath) {
            return createForwardError('dialog_cancelled', capability, 'Preset-Export abgebrochen.');
        }

        const targetPath = path.resolve(dialogResult.filePath);
        try {
            writeFileSync(targetPath, `${JSON.stringify(presetData, null, 2)}\n`, 'utf-8');
            return {
                ok: true,
                reason: 'ok',
                detail: '',
                capability,
                value: {
                    filePath: targetPath,
                    bytes: Buffer.byteLength(JSON.stringify(presetData), 'utf-8'),
                },
            };
        } catch (error) {
            return createForwardError(
                'export_write_failed',
                capability,
                error instanceof Error ? error.message : String(error || 'export_write_failed')
            );
        }
    });

    ipcMain.handle(TUNING_CHANNELS.importPresetJson, async () => {
        const capability = resolveCapabilityStateSnapshot(resolveCapabilityState);
        if (capability.available !== true) {
            return createForwardError('capability_blocked', capability, capability.message);
        }
        if (!dialog || typeof dialog.showOpenDialog !== 'function') {
            return createForwardError('dialog_unavailable', capability, 'Open-Dialog ist nicht verfuegbar.');
        }

        const dialogResult = await dialog.showOpenDialog(
            resolveDialogParentWindow(resolveTuningWindow, resolveGameWindow),
            {
                title: 'Tuning-Preset importieren',
                properties: ['openFile'],
                filters: [{ name: 'JSON', extensions: ['json'] }],
            }
        );
        if (dialogResult.canceled || !Array.isArray(dialogResult.filePaths) || dialogResult.filePaths.length === 0) {
            return createForwardError('dialog_cancelled', capability, 'Preset-Import abgebrochen.');
        }

        const sourcePath = path.resolve(dialogResult.filePaths[0]);
        try {
            const raw = readFileSync(sourcePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return createForwardError('import_invalid_payload', capability, 'Preset-Datei enthaelt kein Objekt.');
            }
            return {
                ok: true,
                reason: 'ok',
                detail: '',
                capability,
                value: {
                    filePath: sourcePath,
                    presetData: parsed,
                },
            };
        } catch (error) {
            return createForwardError(
                'import_parse_failed',
                capability,
                error instanceof Error ? error.message : String(error || 'import_parse_failed')
            );
        }
    });

    return () => {
        for (const channel of Object.values(TUNING_CHANNELS)) {
            ipcMain.removeHandler(channel);
        }
        ipcMain.removeListener(TUNING_RUNTIME_RESPONSE_CHANNEL, onRuntimeResponse);
        for (const pending of pendingResponses.values()) {
            clearTimeout(pending.timeoutId);
            pending.resolve(createForwardError('ipc_disposed', pending.capability, 'Tuning-IPC wurde beendet.'));
        }
        pendingResponses.clear();
    };
}

module.exports = {
    TUNING_CHANNELS,
    TUNING_IPC_CONTRACT_VERSION,
    TUNING_UPDATE_CHANNEL,
    registerTuningIpc,
};
