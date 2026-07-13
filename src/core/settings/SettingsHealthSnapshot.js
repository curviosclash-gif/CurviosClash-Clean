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
} = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
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
        presetCount: safeCount(() => (typeof listMenuPresets === 'function' ? listMenuPresets() : [])),
        textOverrideCount: safeCount(() => menuTextOverridePort?.listOverrides?.()),
        telemetryAvailable: !!(
            telemetryFacade
            && typeof telemetryFacade.getMenuTelemetrySnapshot === 'function'
            && typeof telemetryFacade.recordMenuTelemetry === 'function'
        ),
        activePresetId: normalizeString(source?.matchSettings?.activePresetId),
        activePresetKind: normalizeString(source?.matchSettings?.activePresetKind),
        sessionType: normalizeString(source?.localSettings?.sessionType),
        persistenceStatus: normalizePersistenceStatus(persistenceStatus),
        lastPersistenceReason: normalizeString(persistenceStatus?.lastPersistenceReason),
    };
}
