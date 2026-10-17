const { contextBridge, ipcRenderer } = require('electron');

const SETTINGS_STUDIO_PRELOAD_CONTRACT_VERSION = 'settings-studio-preload.v1';

function invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
}

const settingsStudioApi = Object.freeze({
    contractName: 'settings-studio',
    contractVersion: SETTINGS_STUDIO_PRELOAD_CONTRACT_VERSION,
    load: () => invoke('settings-studio:load'),
    validate: (draft) => invoke('settings-studio:validate', draft),
    save: (draft, browserDemoPolicyDraft = null, options = {}) => invoke('settings-studio:save', draft, browserDemoPolicyDraft, options),
    listBackups: (options = {}) => invoke('settings-studio:list-backups', options),
    restoreBackup: (backupFileName, options = {}) => invoke('settings-studio:restore-backup', backupFileName, options),
    getSchema: () => invoke('settings-studio:get-schema'),
    setLanguage: (language) => invoke('settings-studio:set-language', language),
    listMenuTextOverrides: () => invoke('settings-studio:menu-text-overrides:list'),
    setMenuTextOverride: (textId, value) => invoke('settings-studio:menu-text-overrides:set', textId, value),
    clearMenuTextOverride: (textId) => invoke('settings-studio:menu-text-overrides:clear', textId),
    resetMenuTextOverrides: () => invoke('settings-studio:menu-text-overrides:reset'),
    // Karten-Balancing: list-maps, describe, validate, save, apply, retract.
    mapBalancing: (op, payload = {}) => invoke('settings-studio:map-balancing', { ...payload, op }),
    setDirtyState: (isDirty) => ipcRenderer.send('settings-studio:set-dirty-state', isDirty === true),
    onCloseRequested: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = () => callback();
        ipcRenderer.on('settings-studio:close-request', listener);
        return () => ipcRenderer.removeListener('settings-studio:close-request', listener);
    },
    respondToClose: (discard) => ipcRenderer.send('settings-studio:close-request', discard === true),
});

contextBridge.exposeInMainWorld('__CURVIOS_SETTINGS_STUDIO__', true);
contextBridge.exposeInMainWorld('settingsStudioApi', settingsStudioApi);
