export const GAMEPLAY_CAMERA_MODE_ID = 'FIRST_PERSON';
export const GAMEPLAY_COCKPIT_CAMERA_ENABLED = true;

export function resolveCameraModeIndexFromModes(modeIds, preferredModeId = GAMEPLAY_CAMERA_MODE_ID) {
    if (!Array.isArray(modeIds) || modeIds.length <= 0) {
        return 0;
    }

    const normalizedModes = modeIds
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
    if (normalizedModes.length <= 0) {
        return 0;
    }

    const preferredIndex = normalizedModes.indexOf(String(preferredModeId || '').trim());
    return preferredIndex >= 0 ? preferredIndex : 0;
}

export function resolveGameplayCameraModeId(gameplayConfig = null) {
    const modeIds = gameplayConfig?.CAMERA?.MODES;
    if (!Array.isArray(modeIds) || modeIds.length <= 0) {
        return GAMEPLAY_CAMERA_MODE_ID;
    }

    const preferredIndex = resolveCameraModeIndexFromModes(modeIds, GAMEPLAY_CAMERA_MODE_ID);
    const resolvedModeId = modeIds[preferredIndex];
    return typeof resolvedModeId === 'string' && resolvedModeId.trim()
        ? resolvedModeId.trim()
        : GAMEPLAY_CAMERA_MODE_ID;
}

export function resolveGameplayCameraModeIndex(gameplayConfig = null) {
    return resolveCameraModeIndexFromModes(gameplayConfig?.CAMERA?.MODES, GAMEPLAY_CAMERA_MODE_ID);
}

export function createGameplayCameraState(gameplayConfig = null) {
    return {
        cockpitCamera: GAMEPLAY_COCKPIT_CAMERA_ENABLED,
        cameraModeId: resolveGameplayCameraModeId(gameplayConfig),
        cameraModeIndex: resolveGameplayCameraModeIndex(gameplayConfig),
    };
}
