const { contextBridge, ipcRenderer } = require('electron');

const hangar = Object.freeze({
    contractName: 'hangar-window',
    contractVersion: 'preload.hangar-window.v1',
    openWindow: (options = {}) => ipcRenderer.invoke('hangar-window:open', options),
    closeWindow: () => ipcRenderer.invoke('hangar-window:close'),
});

contextBridge.exposeInMainWorld('__CURVIOS_HANGAR_WINDOW__', hangar);
