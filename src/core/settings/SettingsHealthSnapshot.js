function safeCount(callback) {
    try {
        const value = callback();
        if (Array.isArray(value)) return value.length;
        if (value && typeof value === 'object') return Object.keys(value).length;
    } catch {
        return 0;
    }
    return 0;
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePersistenceStatus(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        settings: normalizeString(source?.settings?.status) || 'unknown',
        profiles: normalizeString(source?.profiles?.status) || 'unknown',
        records: normalizeString(source?.records?.status) || 'unknown',
        presets: normalizeString(source?.presets?.status) || 'unknown',
        drafts: normalizeString(source?.drafts?.status) || 'unknown',
        textOverrides: normalizeString(source?.textOverrides?.status) || 'unknown',
        telemetry: normalizeString(source?.telemetry?.status) || 'unknown',
    };
}

function normalizePersistenceReasons(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        settings: normalizeString(source?.settings?.reason),
        profiles: normalizeString(source?.profiles?.reason),
        records: normalizeString(source?.records?.reason),
        presets: normalizeString(source?.presets?.reason),
        drafts: normalizeString(source?.drafts?.reason),
        textOverrides: normalizeString(source?.textOverrides?.reason),
        telemetry: normalizeString(source?.telemetry?.reason),
    };
}

export function createSettingsHealthSnapshot({
    settings = null,
    recordStorePort = null,
    profileStorePort = null,
    menuTextOverridePort = null,
    listMenuPresets = null,
    telemetryFacade = null,
    persistenceStatus = null,
    getPersistenceStatus = null,
} = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const presetCount = safeCount(() => (typeof listMenuPresets === 'function' ? listMenuPresets() : []));
    const textOverrideCount = safeCount(() => menuTextOverridePort?.listOverrides?.());
    let resolvedPersistenceStatus = persistenceStatus;
    if (typeof getPersistenceStatus === 'function') {
        try {
            resolvedPersistenceStatus = getPersistenceStatus();
        } catch {
            resolvedPersistenceStatus = persistenceStatus;
        }
    }
    return {
        hasRecordStorePort: !!(
            recordStorePort
            && typeof recordStorePort.loadJsonRecord === 'function'
            && typeof recordStorePort.saveJsonRecord === 'function'
        ),
        hasProfileStorePort: !!(
            profileStorePort
            && typeof profileStorePort.loadProfiles === 'function'
            && typeof profileStorePort.saveProfiles === 'function'
        ),
        hasMenuTextOverridePort: !!(
            menuTextOverridePort
            && typeof menuTextOverridePort.listOverrides === 'function'
            && typeof menuTextOverridePort.getOverride === 'function'
        ),
        presetCount,
        textOverrideCount,
        telemetryAvailable: !!(
            telemetryFacade
            && typeof telemetryFacade.getMenuTelemetrySnapshot === 'function'
            && typeof telemetryFacade.recordMenuTelemetry === 'function'
        ),
        activePresetId: normalizeString(source?.matchSettings?.activePresetId),
        activePresetKind: normalizeString(source?.matchSettings?.activePresetKind),
        sessionType: normalizeString(source?.localSettings?.sessionType),
        persistenceStatus: normalizePersistenceStatus(resolvedPersistenceStatus),
        persistenceReasons: normalizePersistenceReasons(resolvedPersistenceStatus),
        lastPersistenceReason: normalizeString(resolvedPersistenceStatus?.lastPersistenceReason),
    };
}
