const { contextBridge, ipcRenderer } = require('electron');

const TUNING_PRELOAD_CONTRACT_VERSION = 'tuning-console-preload.v1';
const TUNING_UPDATE_CHANNEL = 'tuning:update';

function invoke(channel, payload = undefined) {
    return ipcRenderer.invoke(channel, payload);
}

function createTuningApi() {
    return Object.freeze({
        contractName: 'tuning-console',
        contractVersion: TUNING_PRELOAD_CONTRACT_VERSION,
        getCapability: () => invoke('tuning:get-capability'),
        getRegistry: () => invoke('tuning:get-registry'),
        getAll: () => invoke('tuning:get-all'),
        setValue: (path, value) => invoke('tuning:set-value', { path, value }),
        resetAll: (paths = null) => invoke('tuning:reset-all', { paths }),
        exportPresetJson: (presetData, fileName = 'tuning-preset.json') => (
            invoke('tuning:export-preset-json', { presetData, fileName })
        ),
        importPresetJson: () => invoke('tuning:import-preset-json'),
        onUpdate: (callback) => {
            if (typeof callback !== 'function') {
                return () => {};
            }
            const handler = (_event, payload) => callback(payload);
            ipcRenderer.on(TUNING_UPDATE_CHANNEL, handler);
            return () => ipcRenderer.removeListener(TUNING_UPDATE_CHANNEL, handler);
        },
    });
}

const tuningApi = createTuningApi();

contextBridge.exposeInMainWorld('__CURVIOS_TUNING__', true);
contextBridge.exposeInMainWorld('tuningApi', tuningApi);
