import { PlayerProfileManager } from '../../application/player-profile/PlayerProfileManager.js';
import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';
import { SettingsStore } from '../../shared/settings/SettingsStore.js';
import { startHangarWindowApp } from '../../ui/hangar/HangarWindowApp.js';

const store = new SettingsStore();
const playerProfileManager = new PlayerProfileManager({ recordStore: Object.freeze({
    loadJsonRecord: (key, fallback = null) => store.loadJsonRecord(key, fallback),
    saveJsonRecord: (key, value) => store.saveJsonRecord(key, value),
    readJsonRecordResult: (key) => store.readJsonRecordResult(key),
    removeJsonRecord: (key) => store.removeJsonRecord(key),
}) });
playerProfileManager.bootstrap();
const playerStore = playerProfileManager.getActiveRecordStorePort();
const runtimeAccess = Object.freeze({
    getSettingsStore: () => playerStore,
    getActivePlayerProfile: () => playerProfileManager.getActiveProfile(),
    loadSettings: () => store.loadSettings(),
    saveSettings: (nextSettings) => store.saveSettings(nextSettings),
    arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(playerStore),
});

startHangarWindowApp({ settings: store.loadSettings(), runtimeAccess });
