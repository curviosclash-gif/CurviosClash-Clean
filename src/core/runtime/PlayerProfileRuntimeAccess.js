import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';
import { createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { createArcadeDailyProjection } from '../../state/arcade/ArcadeDailyState.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY, LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeRunSettingsContract.js';

export function resolvePlayerRecordStorePortForIndex(manager, playerIndex, profileId) {
    const id = String(profileId || '').trim();
    const valid = manager?.getProfiles?.().some((profile) => profile.id === id);
    return Number.isInteger(playerIndex) && valid ? manager.getRecordStorePort(id) : null;
}

export function createPlayerRecordStorePortResolver(getManager) {
    return (playerIndex, profileId) => resolvePlayerRecordStorePortForIndex(getManager?.(), playerIndex, profileId);
}

export function resolveHangarPlayerProfileContext(manager, requestedId = '') {
    const id = String(requestedId || '').trim();
    const profile = id ? manager?.getProfiles?.().find(entry => entry.id === id) : manager?.getActiveProfile?.();
    return profile ? { profile, store: manager.getRecordStorePort(profile.id) } : null;
}

export function createPlayerProfileMenuRuntimeAccess(game) {
    const getSettingsStore = () => game?.settingsManager?.getPlayerRecordStorePort?.()
        || game?.settingsManager?.getSettingsRecordStorePort?.()
        || null;
    const getArcadePrimaryPlayerProfile = () => {
        const manager = game?.playerProfileManager;
        const setup = game?.settings?.localSettings?.startSetup;
        const ids = setup?.arcadePlayerProfileIds?.some(id => String(id || '').trim())
            ? setup.arcadePlayerProfileIds : setup?.demolitionProfileIds;
        const id = String(ids?.[0] || '').trim();
        return id && game?.settings?.localSettings?.sessionType === 'splitscreen'
            ? manager?.getProfiles?.().find(profile => profile.id === id) || null
            : manager?.getActiveProfile?.() || null;
    };
    const getArcadeSettingsStore = () => {
        const profile = getArcadePrimaryPlayerProfile();
        return profile ? resolvePlayerRecordStorePortForIndex(game?.playerProfileManager, 0, profile.id) : null;
    };
    const dynamicStore = Object.freeze({
        loadJsonRecord: (key, fallback = null) => getSettingsStore()?.loadJsonRecord?.(key, fallback) ?? fallback,
        saveJsonRecord: (key, value) => getSettingsStore()?.saveJsonRecord?.(key, value),
        readJsonRecordResult: (key) => getSettingsStore()?.readJsonRecordResult?.(key),
        removeJsonRecord: (key) => getSettingsStore()?.removeJsonRecord?.(key),
    });
    return Object.freeze({
        getSettingsStore,
        getArcadeSettingsStore,
        getArcadePrimaryPlayerProfile,
        getArcadePrimaryProfileRecords: () => {
            const store = getArcadeSettingsStore();
            const records = createArcadeRunRecords(store?.loadJsonRecord?.(ARCADE_RUN_PROFILE_STORAGE_KEY, null));
            const legacy = store?.loadJsonRecord?.(LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, null);
            return { records, daily: createArcadeDailyProjection(records),
                legacyRecords: legacy?.scoreModel === 'arcade-score.v2' ? legacy : null };
        },
        getActivePlayerProfile: () => game?.playerProfileManager?.getActiveProfile?.() || null,
        getPlayerProfiles: () => game?.playerProfileManager?.getProfiles?.() || [],
        createPlayerProfile: (displayName) => game?.playerProfileManager?.createProfile?.(displayName)
            || { ok: false, reason: 'profile_manager_unavailable' },
        arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(dynamicStore),
    });
}
