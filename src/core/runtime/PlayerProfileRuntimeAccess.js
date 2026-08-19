import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';

export function createPlayerProfileMenuRuntimeAccess(game) {
    const getSettingsStore = () => game?.settingsManager?.getPlayerRecordStorePort?.()
        || game?.settingsManager?.getSettingsRecordStorePort?.()
        || null;
    const dynamicStore = Object.freeze({
        loadJsonRecord: (key, fallback = null) => getSettingsStore()?.loadJsonRecord?.(key, fallback) ?? fallback,
        saveJsonRecord: (key, value) => getSettingsStore()?.saveJsonRecord?.(key, value),
        readJsonRecordResult: (key) => getSettingsStore()?.readJsonRecordResult?.(key),
        removeJsonRecord: (key) => getSettingsStore()?.removeJsonRecord?.(key),
    });
    return Object.freeze({
        getSettingsStore,
        getActivePlayerProfile: () => game?.playerProfileManager?.getActiveProfile?.() || null,
        arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(dynamicStore),
    });
}
