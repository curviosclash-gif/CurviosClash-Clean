const { contextBridge, ipcRenderer } = require('electron');

// Ein Kanal statt fuenf. Die Aktion steht in der Nutzlast und wird im
// Hauptprozess gegen eine feste Liste geprueft.
const EDITOR_DISK_IPC_CHANNEL = 'editor-disk:request';

function request(action, payload = {}) {
    return ipcRenderer.invoke(EDITOR_DISK_IPC_CHANNEL, { action, payload });
}

const editorDisk = Object.freeze({
    contractName: 'editor-disk',
    contractVersion: 'preload.editor-disk.v1',
    saveVehicle: (payload) => request('save-vehicle', payload),
    listVehicles: () => request('list-vehicles'),
    getVehicle: (payload) => request('get-vehicle', payload),
    renameVehicle: (payload) => request('rename-vehicle', payload),
    deleteVehicle: (payload) => request('delete-vehicle', payload),
});

contextBridge.exposeInMainWorld('__CURVIOS_EDITOR_DISK__', editorDisk);
