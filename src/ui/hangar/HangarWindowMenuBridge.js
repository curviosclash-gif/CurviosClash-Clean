/* global __APP_TARGET__ */
import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { createBrowserPageHangarAdapter } from '../../platform/browser/BrowserPlatformAdapters.js';
import { STORAGE_KEYS } from '../../shared/storage/StorageKeys.js';
import { createInfoHintButton } from '../menu/InfoHintToggle.js';
import { isArcadeLabShipsStorageKey, registerArcadeLabShipsFromStore } from '../../shared/contracts/ArcadeLabStoreContract.js';
import { listRegisteredArcadeLabShips } from '../../shared/contracts/ArcadeLabRegistryContract.js';

export function createHangarWindowLauncher(createElement) {
    const card = createElement('section', 'arcade-surface-card hangar-window-launch-card');
    card.appendChild(createElement('h3', 'arcade-surface-card-title', 'Desktop Hangar'));
    card.appendChild(createInfoHintButton(card.ownerDocument || document,
        'Öffnet den Fahrzeug-Workshop bildschirmfüllend in einem eigenen Fenster.'));
    const button = createElement('button', 'start-btn hangar-window-open', 'Hangar im großen Fenster öffnen');
    button.type = 'button';
    card.appendChild(button);
    return { card, button };
}

function resolveBuildAppTarget() {
    return typeof __APP_TARGET__ !== 'undefined' ? String(__APP_TARGET__).trim().toLowerCase() : '';
}

export function createHangarWindowMenuPort(runtimeGlobal = globalThis, { appTarget = resolveBuildAppTarget() } = {}) {
    const electronPort = createElectronPreloadHangarAdapter(runtimeGlobal);
    // The Android app bundles hangar.html and opens it in the same WebView.
    if (electronPort.isAvailable() || appTarget !== 'mobile-classic') return electronPort;
    return createBrowserPageHangarAdapter(runtimeGlobal);
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

export function applyArcadeLabWindowStorageEvent(event, runtimeAccess, ui) {
    if (!isArcadeLabShipsStorageKey(event?.key)) return false;
    registerArcadeLabShipsFromStore(runtimeAccess?.getSettingsStore?.());
    const select = ui?.vehicleSelectP1;
    if (select) {
        for (const option of [...select.options]) if (option.value.startsWith('arcade_lab_')) option.remove();
        for (const ship of listRegisteredArcadeLabShips()) {
            const option = document.createElement('option');
            option.value = ship.id;
            option.textContent = ship.label;
            select.append(option);
        }
    }
    return true;
}
