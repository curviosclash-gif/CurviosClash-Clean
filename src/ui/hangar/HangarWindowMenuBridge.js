import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { STORAGE_KEYS } from '../StorageKeys.js';

export function createHangarWindowLauncher(createElement) {
    const card = createElement('section', 'arcade-surface-card hangar-window-launch-card');
    card.appendChild(createElement('h3', 'arcade-surface-card-title', 'Desktop Hangar'));
    const hint = createElement('span', 'menu-info-hint', 'i');
    hint.title = 'Öffnet den Fahrzeug-Workshop bildschirmfüllend in einem eigenen Fenster.';
    hint.setAttribute('role', 'img');
    hint.setAttribute('aria-label', hint.title);
    card.appendChild(hint);
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
        const loadedLocal = loaded?.localSettings;
        if (loadedLocal && typeof loadedLocal === 'object') {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
            if (loadedLocal?.startSetup?.modeSelections && typeof loadedLocal.startSetup.modeSelections === 'object') {
                settings.localSettings.startSetup = {
                    ...(settings.localSettings.startSetup || {}),
                    modeSelections: { ...loadedLocal.startSetup.modeSelections },
                };
            }
            if (loadedLocal.fightHangar && typeof loadedLocal.fightHangar === 'object') {
                settings.localSettings.fightHangar = { ...loadedLocal.fightHangar };
            }
        }
        const vehicleId = String(settings?.vehicles?.PLAYER_1 || '');
        if (ui?.vehicleSelectP1 && vehicleId) ui.vehicleSelectP1.value = vehicleId;
        return true;
    } catch { return false; }
}
