import { HANGAR_SELECTION_PLAYER_SLOTS, writeHangarVehicleSelection } from './HangarSelectionWritebackContract.js';

export function persistHangarVehicleSelection({ settings, runtimeAccess, vehicleId, mode = 'arcade' } = {}) {
    const normalizedMode = String(mode || '').trim().toLowerCase() === 'fight' ? 'fight' : 'arcade';
    const localSettings = settings && typeof settings === 'object' ? settings : {};
    let targetSettings = localSettings;
    try {
        const latestSettings = runtimeAccess?.loadSettings?.();
        if (latestSettings && typeof latestSettings === 'object') targetSettings = latestSettings;
    } catch {
        targetSettings = localSettings;
    }

    const result = writeHangarVehicleSelection(
        targetSettings,
        HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
        vehicleId,
        'ship5',
        { modePath: normalizedMode }
    );
    targetSettings.vehicles.PLAYER_1 = result.value;
    runtimeAccess?.saveSettings?.(targetSettings);
    if (targetSettings !== localSettings) Object.assign(localSettings, targetSettings);
    return result.value;
}

export function persistArcadeHangarVehicleSelection(options = {}) {
    return persistHangarVehicleSelection({ ...options, mode: 'arcade' });
}
