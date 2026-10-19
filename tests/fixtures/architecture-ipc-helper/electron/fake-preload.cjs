const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_CHANNEL = 'x:update';
const REQUEST_CHANNEL = 'x:request';

function createInvokeBridge(channel) {
    return (...args) => ipcRenderer.invoke(channel, ...args);
}

const invoke = (c) => ipcRenderer.invoke(c);

// The literal here is an action inside the payload, not a channel.
function request(action, payload = {}) {
    return ipcRenderer.invoke(REQUEST_CHANNEL, { action, payload });
}

contextBridge.exposeInMainWorld('fake', {
    literal: () => ipcRenderer.invoke('x:literal'),
    start: createInvokeBridge('x:start'),
    stop: createInvokeBridge('x:stop'),
    get: () => invoke('x:y'),
    save: () => request('save-map'),
    onUpdate: (handler) => ipcRenderer.on(UPDATE_CHANNEL, handler),
});
