function isObjectRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommandSettingsOptions(options = undefined) {
    if (!isObjectRecord(options)) {
        return {};
    }
    return { ...options };
}

export function applyCommandRuntimeSettings(facade = null, options = undefined) {
    const normalizedOptions = normalizeCommandSettingsOptions(options);
    const { settingsSnapshot = null, ...runtimeApplyOptions } = normalizedOptions;
    if (isObjectRecord(settingsSnapshot)) {
        facade?._applyAuthoritativeMultiplayerMatchSettings?.(settingsSnapshot);
    }
    return facade?._applySettingsToRuntimeInternal?.(runtimeApplyOptions);
}
