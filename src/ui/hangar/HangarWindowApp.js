import { SettingsStore } from '../SettingsStore.js';
import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { setupArcadeHangarWorkshop } from './ArcadeHangarWorkshop.js';

const store = new SettingsStore();
const settings = store.loadSettings();
const hangarWindow = createElectronPreloadHangarAdapter(globalThis);
const mount = document.getElementById('hangar-window-mount');
const closeButton = document.getElementById('hangar-window-close');
const cleanups = [];

function bind(element, eventName, handler, options) {
    element?.addEventListener?.(eventName, handler, options);
    const cleanup = () => element?.removeEventListener?.(eventName, handler, options);
    cleanups.push(cleanup);
    return cleanup;
}

const workshop = setupArcadeHangarWorkshop({
    settings,
    ui: {},
    bind,
    emit() {},
    eventTypes: {},
    runtimeAccess: {
        getSettingsStore: () => store,
        saveSettings(nextSettings) { return store.saveSettings(nextSettings); },
    },
});

if (workshop?.container) mount?.appendChild(workshop.container);

bind(closeButton, 'click', async () => {
    if (hangarWindow.isAvailable() && typeof hangarWindow.closeWindow === 'function') {
        await hangarWindow.closeWindow();
        return;
    }
    globalThis.location.assign('/');
});

bind(globalThis, 'beforeunload', () => {
    workshop?.dispose?.();
    cleanups.splice(0).forEach((cleanup) => cleanup());
}, { once: true });
