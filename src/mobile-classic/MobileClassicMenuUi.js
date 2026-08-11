// @ts-check

import { MENU_SESSION_TYPES } from '../composition/core-ui/CoreSettingsPorts.js';
import { LEVEL4_SECTION_IDS, MENU_MODE_PATHS } from '../ui/menu/MenuStateContracts.js';
import {
    isMobileArcadeRouteAllowed,
    resolveMobileArcadeMapKey,
} from '../mobile-arcade/MobileArcadeApp.js';

const MOBILE_ANDROID_GHOST_STATUS_ID = 'mobile-arcade-ghost-status';
const MOBILE_ANDROID_MODE_PATHS = Object.freeze([MENU_MODE_PATHS.NORMAL, MENU_MODE_PATHS.ARCADE]);
const MOBILE_ANDROID_LEVEL4_SECTION_IDS = Object.freeze([
    LEVEL4_SECTION_IDS.MOBILE_CONTROLS,
    LEVEL4_SECTION_IDS.GAMEPLAY,
]);

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

export function resolveMobileAndroidLevel4SectionId(value = '') {
    const requestedSection = normalizeTarget(value);
    return MOBILE_ANDROID_LEVEL4_SECTION_IDS.includes(requestedSection)
        ? requestedSection
        : LEVEL4_SECTION_IDS.MOBILE_CONTROLS;
}

export function ensureMobileAndroidStartSetup(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    if (!settings.localSettings.startSetup || typeof settings.localSettings.startSetup !== 'object') {
        settings.localSettings.startSetup = {};
    }
    const startSetup = settings.localSettings.startSetup;
    if (!startSetup.modeSelections || typeof startSetup.modeSelections !== 'object') {
        startSetup.modeSelections = {};
    }
    if (!startSetup.modeSelections.arcade || typeof startSetup.modeSelections.arcade !== 'object') {
        startSetup.modeSelections.arcade = {};
    }
    return startSetup;
}

function ensureStatusUi(doc = document) {
    if (!doc?.createElement || typeof doc.body?.appendChild !== 'function'
        || doc.getElementById?.(MOBILE_ANDROID_GHOST_STATUS_ID)) {
        return;
    }
    const status = doc.createElement('div');
    status.id = MOBILE_ANDROID_GHOST_STATUS_ID;
    status.textContent = 'Ghost: Selbstduell';
    doc.body.appendChild(status);
}

function configureMobileLanLobbyUi(doc = document) {
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
    ensureStatusUi(doc);
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
    const normalizedModePath = resolveMobileAndroidModePath({ localSettings: { modePath } });
    if (doc?.documentElement?.dataset) doc.documentElement.dataset.mobileModePath = normalizedModePath;
    if (doc?.body?.dataset) doc.body.dataset.mobileModePath = normalizedModePath;
    updateMenuVisibility(doc);
}

function pruneMapSelectToArcadeAllowlist(select) {
    if (!select?.options) return '';
    const options = Array.from(select.options);
    for (let i = options.length - 1; i >= 0; i -= 1) {
        if (!isMobileArcadeRouteAllowed(options[i]?.value)) options[i].remove?.();
    }
    const selectedValue = resolveMobileArcadeMapKey(select.value);
    const hasSelectedOption = Array.from(select.options).some((option) => option.value === selectedValue);
    select.value = hasSelectedOption ? selectedValue : String(select.options[0]?.value || '');

    const doc = select.ownerDocument || null;
    doc?.querySelectorAll?.('#start-map-choice-strip [data-map-key]')?.forEach((button) => {
        if (!isMobileArcadeRouteAllowed(button?.dataset?.mapKey)) {
            button.remove?.();
            return;
        }
        const active = button.dataset.mapKey === select.value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
    });
    return String(select.value || '');
}

function bindMobileModeResync(game, button, applyMobileClassicSettings) {
    if (!button?.dataset || button.dataset.mobileAndroidModeBound === '1') return;
    button.dataset.mobileAndroidModeBound = '1';
    button.addEventListener?.('click', () => {
        const ownerWindow = button.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
        ownerWindow?.setTimeout?.(() => {
            const requestedSessionType = normalizeTarget(button?.dataset?.sessionType);
            if (requestedSessionType === MENU_SESSION_TYPES.MULTIPLAYER && game?.settings?.localSettings) {
                game.settings.localSettings.modePath = MENU_MODE_PATHS.NORMAL;
                game.settings.localSettings.multiplayerTransport = 'lan';
            }
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

    const modePath = resolveMobileAndroidModePath(game?.settings || null);
    const doc = ui.mainMenu?.ownerDocument || ui.mapSelect?.ownerDocument
        || (typeof document !== 'undefined' ? document : null);
    configureMobileLanLobbyUi(doc);
    updateDocumentMode(modePath, doc);

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const sessionType = normalizeTarget(button?.dataset?.sessionType);
            const allowed = sessionType === MENU_SESSION_TYPES.SINGLE || sessionType === MENU_SESSION_TYPES.MULTIPLAYER;
            setButtonLocked(button, sessionType && !allowed);
            if (allowed) bindMobileModeResync(game, button, applyMobileClassicSettings);
        });
    }
    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => {
            const buttonModePath = normalizeTarget(button?.dataset?.modePath);
            const multiplayerActive = game?.settings?.localSettings?.sessionType === MENU_SESSION_TYPES.MULTIPLAYER;
            const allowed = buttonModePath === MENU_MODE_PATHS.NORMAL
                || (!multiplayerActive && buttonModePath === MENU_MODE_PATHS.ARCADE);
            setButtonLocked(button, buttonModePath && !allowed);
            if (allowed) bindMobileModeResync(game, button, applyMobileClassicSettings);
        });
    }
    if (ui.multiplayerHostButton) setButtonLocked(ui.multiplayerHostButton, true);
    if (Array.isArray(ui.multiplayerTransportButtons)) {
        ui.multiplayerTransportButtons.forEach((button) => {
            setButtonLocked(button, normalizeTarget(button?.dataset?.multiplayerTransport) !== 'lan');
        });
    }
    if (modePath === MENU_MODE_PATHS.ARCADE) {
        const selectedMapKey = pruneMapSelectToArcadeAllowlist(ui.mapSelect);
        if (selectedMapKey && game?.settings) {
            const startSetup = ensureMobileAndroidStartSetup(game.settings);
            game.settings.mapKey = selectedMapKey;
            startSetup.modeSelections.arcade.mapKey = selectedMapKey;
        }
    }
}
