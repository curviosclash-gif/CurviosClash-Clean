import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { STORAGE_KEYS } from '../StorageKeys.js';

export function createHangarWindowLauncher(createElement) {
    const card = createElement('section', 'arcade-surface-card hangar-window-launch-card');
    card.appendChild(createElement('h3', 'arcade-surface-card-title', 'Desktop Hangar'));
    card.appendChild(createElement('p', 'menu-hint', 'Öffnet den Fahrzeug-Workshop bildschirmfüllend in einem eigenen Fenster.'));
    const button = createElement('button', 'start-btn hangar-window-open', 'Hangar im großen Fenster öffnen');
    button.type = 'button';
    card.appendChild(button);
    return { card, button };
}

export function createHangarWindowMenuPort(runtimeGlobal = globalThis) {
    return createElectronPreloadHangarAdapter(runtimeGlobal);
}

export function applyHangarWindowStorageEvent(event, settings, ui) {
    if (event?.key !== STORAGE_KEYS.settings || !event.newValue) return false;
    try {
        const loaded = JSON.parse(event.newValue);
        if (loaded?.vehicles && typeof loaded.vehicles === 'object') settings.vehicles = { ...loaded.vehicles };
        if (loaded?.localSettings && typeof loaded.localSettings === 'object') settings.localSettings = { ...(settings.localSettings || {}), ...loaded.localSettings };
        const vehicleId = String(settings?.vehicles?.PLAYER_1 || '');
        if (ui?.vehicleSelectP1 && vehicleId) ui.vehicleSelectP1.value = vehicleId;
        return true;
    } catch { return false; }
}
