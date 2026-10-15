import { PlayerProfileManager } from '../../application/player-profile/PlayerProfileManager.js';
import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';
import { SettingsStore } from '../../shared/settings/SettingsStore.js';
import { startHangarWindowApp } from '../../ui/hangar/HangarWindowApp.js';
import { registerArcadeLabShipsFromStore } from '../../shared/contracts/ArcadeLabStoreContract.js';
import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { createBrowserHangarPagePort } from '../../platform/browser/BrowserHangarPagePort.js';
import { createBrowserAndroidBackPort } from '../../platform/browser/BrowserAndroidBackPort.js';
import { resolveHangarPlayerProfileContext } from '../../core/runtime/PlayerProfileRuntimeAccess.js';

const store = new SettingsStore();
const playerProfileManager = new PlayerProfileManager({ recordStore: Object.freeze({
    loadJsonRecord: (key, fallback = null) => store.loadJsonRecord(key, fallback),
    saveJsonRecord: (key, value) => store.saveJsonRecord(key, value),
    readJsonRecordResult: (key) => store.readJsonRecordResult(key),
    removeJsonRecord: (key) => store.removeJsonRecord(key),
}) });
playerProfileManager.bootstrap();
const page = createBrowserHangarPagePort(globalThis);
const context = resolveHangarPlayerProfileContext(playerProfileManager,
    page.getMode() === 'fight' ? '' : page.getPlayerProfileId());
if (!context) throw new Error('Das gewählte Spielerprofil ist nicht mehr vorhanden. Bitte den Hangar erneut öffnen.');
const playerStore = context.store;
registerArcadeLabShipsFromStore(playerStore);
const runtimeAccess = Object.freeze({
    getSettingsStore: () => playerStore,
    getActivePlayerProfile: () => context.profile,
    loadSettings: () => store.loadSettings(),
    saveSettings: (nextSettings) => store.saveSettings(nextSettings),
    arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(playerStore),
});

startHangarWindowApp({
    settings: store.loadSettings(), runtimeAccess,
    hangarWindow: createElectronPreloadHangarAdapter(globalThis),
    page,
    androidBack: createBrowserAndroidBackPort(globalThis),
});
