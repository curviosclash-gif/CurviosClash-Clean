import { createArcadeVehicleProfileWorkshopPort } from '../../state/arcade/ArcadeVehicleProfileWorkshopPort.js';
import { createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { createArcadeDailyProjection } from '../../state/arcade/ArcadeDailyState.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY, GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY, LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeRunSettingsContract.js';
import { isFourPlayerPlanarVariant, isThreePlayerSplitVariant } from '../../four-player-planar/FourPlayerPlanarContract.js';
import { initializeArcadeJourneyAccess } from '../../state/arcade/ArcadeJourneyAccessInitialization.js';

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

/** Freeze every local participant's Journey access before any profile receives run history. */
export function initializeLocalArcadeJourneyAccess(game) {
    const manager = game?.playerProfileManager;
    const profiles = manager?.getProfiles?.() || [];
    const settings = game?.settings;
    const split = settings?.localSettings?.sessionType === 'splitscreen';
    const count = !split ? 1 : isFourPlayerPlanarVariant(settings) ? 4
        : isThreePlayerSplitVariant(settings) ? 3 : 2;
    const setup = settings?.localSettings?.startSetup;
    const selected = setup?.arcadePlayerProfileIds?.some((id) => String(id || '').trim())
        ? setup.arcadePlayerProfileIds : setup?.demolitionProfileIds;
    const ids = split ? Array.from({ length: count }, (_, index) => String(selected?.[index] || '').trim())
        : [String(manager?.getActiveProfile?.()?.id || '').trim()];
    if (count > 3 || ids.some((id) => !profiles.some((profile) => profile.id === id))
        || new Set(ids).size !== ids.length) return { status: 'unavailable' };
    let stores;
    try { stores = ids.map((id) => manager.getRecordStorePort(id)); }
    catch { return { status: 'unavailable' }; }
    if (stores.some((store) => !store)) return { status: 'unavailable' };
    for (const store of stores) {
        const result = initializeArcadeJourneyAccess(store);
        if (result.status === 'unavailable') return result;
    }
    return { status: 'ok' };
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
    // Arcade vehicle progress belongs to the arcade primary profile (split-screen P1), like the arcade
    // menu store. A stale P1 refuses writes instead of falling back to the active profile.
    const getWorkshopStore = () => (game?.playerProfileManager ? getArcadeSettingsStore() : getSettingsStore());
    const dynamicStore = Object.freeze({
        loadJsonRecord: (key, fallback = null) => getWorkshopStore()?.loadJsonRecord?.(key, fallback) ?? fallback,
        saveJsonRecord: (key, value) => getWorkshopStore()?.saveJsonRecord?.(key, value) ?? false,
        readJsonRecordResult: (key) => getWorkshopStore()?.readJsonRecordResult?.(key),
        removeJsonRecord: (key) => getWorkshopStore()?.removeJsonRecord?.(key) ?? false,
    });
    return Object.freeze({
        getSettingsStore,
        getArcadeSettingsStore,
        initializeArcadeJourneyAccess,
        getArcadePrimaryPlayerProfile,
        getArcadePrimaryProfileRecords: () => {
            const store = getArcadeSettingsStore();
            const dailyChallenge = game?.settings?.arcade?.dailyChallenge === true;
            const key = dailyChallenge ? ARCADE_RUN_PROFILE_STORAGE_KEY : GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY;
            const records = createArcadeRunRecords(store?.loadJsonRecord?.(key, null));
            const dailyRecords = dailyChallenge ? records : createArcadeRunRecords(store?.loadJsonRecord?.(ARCADE_RUN_PROFILE_STORAGE_KEY, null));
            const previousRuleRecords = dailyChallenge ? null : dailyRecords;
            const legacy = store?.loadJsonRecord?.(LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, null);
            return { records, daily: createArcadeDailyProjection(dailyRecords),
                previousRuleRecords,
                legacyRecords: legacy?.scoreModel === 'arcade-score.v2' ? legacy : null };
        },
        getActivePlayerProfile: () => game?.playerProfileManager?.getActiveProfile?.() || null,
        getPlayerProfiles: () => game?.playerProfileManager?.getProfiles?.() || [],
        createPlayerProfile: (displayName) => game?.playerProfileManager?.createProfile?.(displayName)
            || { ok: false, reason: 'profile_manager_unavailable' },
        arcadeVehicleProfileWorkshop: createArcadeVehicleProfileWorkshopPort(dynamicStore),
    });
}
