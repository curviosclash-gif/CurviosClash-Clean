// @ts-check

import { MENU_SESSION_TYPES } from '../composition/core-ui/CoreSettingsPorts.js';
import { MENU_MODE_PATHS } from '../ui/menu/MenuStateContracts.js';

// The phone shows the full desktop menu; only splitscreen (one screen, two players) stays locked.
const MOBILE_ANDROID_LOCKED_SESSION_TYPES = Object.freeze([MENU_SESSION_TYPES.SPLITSCREEN]);
const MOBILE_ANDROID_MODE_PATHS = Object.freeze(Object.values(MENU_MODE_PATHS));

function normalizeTarget(value = '') {
    return String(value || '').trim().toLowerCase();
}

function resolveWindow(doc = document) {
    return doc?.defaultView || (typeof window !== 'undefined' ? window : null);
}

export function resolveMobileAndroidModePath(settings = null) {
    const requestedModePath = normalizeTarget(settings?.localSettings?.modePath);
    return MOBILE_ANDROID_MODE_PATHS.includes(requestedModePath)
        ? requestedModePath
        : MENU_MODE_PATHS.NORMAL;
}

function configureMobileLanLobbyUi(doc = document) {
    // Without LAN discovery the phone joins a LAN host by typing its address.
    const manualAddress = doc?.getElementById?.('multiplayer-manual-address');
    if (manualAddress) {
        manualAddress.setAttribute?.('open', '');
        const summary = manualAddress.querySelector?.('summary');
        if (summary) summary.hidden = true;
    }
    const addressInput = doc?.getElementById?.('multiplayer-host-address');
    if (addressInput) {
        addressInput.setAttribute?.('placeholder', '192.168.1.10:9090');
        addressInput.setAttribute?.('inputmode', 'url');
    }
    const addressLabel = doc?.querySelector?.('label[for="multiplayer-host-address"]');
    if (addressLabel) addressLabel.textContent = 'Host-IP und Port';
}

function updateMenuVisibility(doc = document) {
    if (!doc?.body) return;
    const mainMenu = doc.getElementById?.('main-menu');
    const menuVisible = !!mainMenu && !mainMenu.classList.contains('hidden');
    doc.body.dataset.mobileMenuVisible = menuVisible ? '1' : '0';
    if (doc.documentElement?.dataset) {
        doc.documentElement.dataset.mobileMenuVisible = menuVisible ? '1' : '0';
    }
}

function ensureMenuVisibilityObserver(doc = document) {
    const mainMenu = doc?.getElementById?.('main-menu');
    const ownerWindow = resolveWindow(doc);
    updateMenuVisibility(doc);
    if (!mainMenu || !ownerWindow?.MutationObserver || mainMenu.dataset.mobileAndroidMenuObserverBound === '1') {
        return;
    }
    const observer = new ownerWindow.MutationObserver(() => updateMenuVisibility(doc));
    observer.observe(mainMenu, { attributes: true, attributeFilter: ['class'] });
    mainMenu.dataset.mobileAndroidMenuObserverBound = '1';
}

export function setupMobileClassicMenuDocumentState(doc = document) {
    configureMobileLanLobbyUi(doc);
    ensureMenuVisibilityObserver(doc);
}

function setButtonLocked(button, locked) {
    if (!button) return;
    button.disabled = !!locked;
    button.setAttribute('aria-hidden', locked ? 'true' : 'false');
    button.tabIndex = locked ? -1 : 0;
}

function updateDocumentMode(modePath, doc = (typeof document !== 'undefined' ? document : null)) {
    if (doc?.documentElement?.dataset) doc.documentElement.dataset.mobileModePath = modePath;
    if (doc?.body?.dataset) doc.body.dataset.mobileModePath = modePath;
    updateMenuVisibility(doc);
}

function lockHostLocalPlayerCount(select) {
    // "2 Spieler · Geteilter Bildschirm" at the host would be splitscreen through the back door.
    if (!select) return;
    select.value = '1';
    select.disabled = true;
}

function bindMobileMenuResync(game, button, applyMobileClassicSettings) {
    if (!button?.dataset || button.dataset.mobileAndroidModeBound === '1') return;
    button.dataset.mobileAndroidModeBound = '1';
    button.addEventListener?.('click', () => {
        const ownerWindow = button.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
        ownerWindow?.setTimeout?.(() => {
            applyMobileClassicMenuUiLocks(game, { applyMobileClassicSettings });
        }, 0);
    });
}

export function applyMobileClassicMenuUiLocks(game = null, { applyMobileClassicSettings = null } = {}) {
    if (game?.settings) {
        applyMobileClassicSettings?.(game.settings);
        game.uiManager?.syncStartSetupState?.(game.settings);
    }
    const ui = game?.runtimeCoordinator?.getRuntimeHandle?.('ui') || game?.ui || null;
    if (!ui) return;

    const doc = ui.mainMenu?.ownerDocument || ui.mapSelect?.ownerDocument
        || (typeof document !== 'undefined' ? document : null);
    configureMobileLanLobbyUi(doc);
    updateDocumentMode(resolveMobileAndroidModePath(game?.settings || null), doc);

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const sessionType = normalizeTarget(button?.dataset?.sessionType);
            const locked = MOBILE_ANDROID_LOCKED_SESSION_TYPES.includes(sessionType);
            setButtonLocked(button, locked);
            if (!locked) bindMobileMenuResync(game, button, applyMobileClassicSettings);
        });
    }
    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => bindMobileMenuResync(game, button, applyMobileClassicSettings));
    }
    lockHostLocalPlayerCount(ui.multiplayerHostLocalPlayerCount);
}
