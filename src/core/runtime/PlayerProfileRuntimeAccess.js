import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';

export function resolvePlayerRecordStorePortForIndex(manager, playerIndex, profileId) {
    const id = String(profileId || '').trim();
    const valid = manager?.getProfiles?.().some((profile) => profile.id === id);
    return Number.isInteger(playerIndex) && valid ? manager.getRecordStorePort(id) : null;
}

export function createPlayerRecordStorePortResolver(getManager) {
    return (playerIndex, profileId) => resolvePlayerRecordStorePortForIndex(getManager?.(), playerIndex, profileId);
}

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
        getPlayerProfiles: () => game?.playerProfileManager?.getProfiles?.() || [],
        arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(dynamicStore),
    });
}
