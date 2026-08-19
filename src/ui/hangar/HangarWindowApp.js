import { SettingsStore } from '../SettingsStore.js';
import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { setupArcadeHangarWorkshop } from './ArcadeHangarWorkshop.js';
import { PlayerProfileManager } from '../../application/player-profile/PlayerProfileManager.js';

const store = new SettingsStore();
const playerProfileManager = new PlayerProfileManager({ recordStore: Object.freeze({
    loadJsonRecord: (key, fallback = null) => store.loadJsonRecord(key, fallback),
    saveJsonRecord: (key, value) => store.saveJsonRecord(key, value),
    readJsonRecordResult: (key) => store.readJsonRecordResult(key),
    removeJsonRecord: (key) => store.removeJsonRecord(key),
}) });
playerProfileManager.bootstrap();
const playerStore = playerProfileManager.getActiveRecordStorePort();
const settings = store.loadSettings();
const requestedMode = new URLSearchParams(globalThis.location.search).get('mode');
const hangarMode = requestedMode === 'fight' ? 'fight' : 'arcade';
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
    mode: hangarMode,
    settings,
    ui: {},
    bind,
    emit() {},
    eventTypes: {},
    runtimeAccess: {
        getSettingsStore: () => playerStore,
        loadSettings: () => store.loadSettings(),
        saveSettings(nextSettings) { return store.saveSettings(nextSettings); },
    },
    onDirtyChange(dirty) {
        Promise.resolve(hangarWindow.setUnsavedChanges?.(dirty)).catch(() => {});
    },
});

document.body.dataset.hangarMode = hangarMode;
const title = document.querySelector('.hangar-window-titlebar strong');
if (title) title.textContent = hangarMode === 'fight' ? 'Kampf-Hangar' : 'Arcade-Hangar';

if (workshop?.container) mount?.appendChild(workshop.container);

bind(closeButton, 'click', async () => {
    if (hangarWindow.isAvailable() && typeof hangarWindow.closeWindow === 'function') {
        await hangarWindow.closeWindow();
        return;
    }
    globalThis.location.assign('/');
});

bind(globalThis, 'beforeunload', (event) => {
    if (!hangarWindow.isAvailable() && workshop?.hasUnsavedChanges?.()) {
        event.preventDefault();
        event.returnValue = '';
    }
});

bind(globalThis, 'unload', () => {
    workshop?.flushDraft?.();
    workshop?.dispose?.();
    cleanups.splice(0).forEach((cleanup) => cleanup());
}, { once: true });
