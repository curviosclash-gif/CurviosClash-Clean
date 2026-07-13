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
    save: (draft, browserDemoPolicyDraft = null) => invoke('settings-studio:save', draft, browserDemoPolicyDraft),
    listBackups: (options = {}) => invoke('settings-studio:list-backups', options),
    restoreBackup: (backupFileName) => invoke('settings-studio:restore-backup', backupFileName),
    getSchema: () => invoke('settings-studio:get-schema'),
    setLanguage: (language) => invoke('settings-studio:set-language', language),
    setDirtyState: (isDirty) => ipcRenderer.send('settings-studio:set-dirty-state', isDirty === true),
});

contextBridge.exposeInMainWorld('__CURVIOS_SETTINGS_STUDIO__', true);
contextBridge.exposeInMainWorld('settingsStudioApi', settingsStudioApi);
