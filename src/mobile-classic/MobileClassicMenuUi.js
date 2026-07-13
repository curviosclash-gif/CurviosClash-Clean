// @ts-check

import { MENU_SESSION_TYPES } from '../composition/core-ui/CoreSettingsPorts.js';
import { LEVEL4_SECTION_IDS, MENU_MODE_PATHS } from '../ui/menu/MenuStateContracts.js';
import {
    isMobileArcadeRouteAllowed,
    listMobileArcadeRouteAllowlist,
    resolveMobileArcadeMapKey,
} from '../mobile-arcade/MobileArcadeApp.js';

const MOBILE_ANDROID_GHOST_STATUS_ID = 'mobile-arcade-ghost-status';
const MOBILE_ANDROID_ENTRY_PANEL_ID = 'mobile-android-entry-panel';
const MOBILE_ANDROID_ROUTE_PANEL_ID = 'mobile-android-route-panel';
const MOBILE_ANDROID_ROUTE_LIST_ID = 'mobile-android-route-list';
const MOBILE_ANDROID_ROUTE_EMPTY_ID = 'mobile-android-route-empty';
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

function createEntryButton(doc, { id, modePath, label, copy }) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'nav-btn mobile-android-entry-btn';
    button.dataset.mobileModeEntry = modePath;
    button.title = '';
    const labelNode = doc.createElement('span');
    labelNode.className = 'mobile-android-entry-title';
    labelNode.textContent = label;
    const copyNode = doc.createElement('span');
    copyNode.className = 'mobile-android-entry-copy';
    copyNode.textContent = copy;
    button.append(labelNode, copyNode);
    return button;
}

function ensureEntryUi(doc = document) {
    if (!doc?.createElement) {
        return null;
    }
    const existing = doc.getElementById(MOBILE_ANDROID_ENTRY_PANEL_ID);
    if (existing) {
        return existing;
    }
    const panel = doc.createElement('div');
    panel.id = MOBILE_ANDROID_ENTRY_PANEL_ID;
    panel.className = 'mobile-android-entry-panel';
    panel.setAttribute('aria-label', 'Android Spielstil');
    panel.append(
        createEntryButton(doc, {
            id: 'mobile-android-entry-classic',
            modePath: MENU_MODE_PATHS.NORMAL,
            label: 'Classic',
            copy: 'Freier Flug fuer den schnellen Start',
        }),
        createEntryButton(doc, {
            id: 'mobile-android-entry-arcade',
            modePath: MENU_MODE_PATHS.ARCADE,
            label: 'Parcours',
            copy: 'Zeitroute mit Ghost-Selbstduell',
        }),
    );
    const menuNav = doc.getElementById('menu-nav');
    const host = doc.querySelector('.menu-shell') || doc.getElementById('main-menu') || doc.body;
    if (menuNav?.parentNode) {
        menuNav.parentNode.insertBefore(panel, menuNav);
    } else {
        host?.appendChild(panel);
    }
    return panel;
}

function ensureRouteUi(doc = document) {
    if (!doc?.createElement) {
        return null;
    }
    const existing = doc.getElementById(MOBILE_ANDROID_ROUTE_PANEL_ID);
    if (existing) {
        return existing;
    }
    const panel = doc.createElement('section');
    panel.id = MOBILE_ANDROID_ROUTE_PANEL_ID;
    panel.className = 'mobile-android-route-panel';
    panel.setAttribute('aria-label', 'Parcours Route');

    const title = doc.createElement('h3');
    title.className = 'mobile-android-route-title';
    title.textContent = 'Route waehlen';

    const list = doc.createElement('div');
    list.id = MOBILE_ANDROID_ROUTE_LIST_ID;
    list.className = 'mobile-android-route-list';

    const empty = doc.createElement('p');
    empty.id = MOBILE_ANDROID_ROUTE_EMPTY_ID;
    empty.className = 'mobile-android-route-empty';
    empty.textContent = 'Keine mobile Route verfuegbar.';
    panel.append(title, list, empty);

    const startRail = doc.querySelector('#submenu-game .start-rail');
    if (startRail?.parentNode) {
        startRail.parentNode.insertBefore(panel, startRail.nextSibling);
    } else {
        doc.getElementById('submenu-game')?.appendChild(panel);
    }
    return panel;
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

function syncMenuCopy(doc = document) {
    const labelsById = [
        ['submenu-custom-title', 'Spielstil waehlen'],
        ['submenu-game-title', 'Start vorbereiten'],
        ['level4-tab-mobile-controls', 'Steuerung'],
        ['level4-tab-gameplay', 'Anzeige'],
    ];
    labelsById.forEach(([id, text]) => {
        const node = doc?.getElementById?.(id);
        if (node) node.textContent = text;
    });
    const level4Button = doc?.getElementById?.('btn-open-level4');
    if (level4Button) {
        level4Button.textContent = 'Einstellungen';
        level4Button.dataset.level4Section = LEVEL4_SECTION_IDS.MOBILE_CONTROLS;
    }
    const labelsBySelector = [
        ['#submenu-level4 .level4-header .submenu-title', 'Einstellungen'],
        ['#level4-section-mobile-controls .section-title', 'Steuerung'],
        ['#level4-section-gameplay .section-title', 'Anzeige & Spielgefuehl'],
    ];
    labelsBySelector.forEach(([selector, text]) => {
        const node = doc?.querySelector?.(selector);
        if (node) node.textContent = text;
    });
}

function updateMenuVisibility(doc = document) {
    if (!doc?.body) {
        return;
    }
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

function collapseStartSections(doc = document) {
    const mainMenu = doc?.getElementById?.('main-menu');
    if (!mainMenu || mainMenu.dataset.mobileAndroidStartSectionsCompacted === '1') {
        return;
    }
    doc.querySelectorAll?.('#submenu-game details.start-section-card')?.forEach((section) => {
        section.open = false;
    });
    mainMenu.dataset.mobileAndroidStartSectionsCompacted = '1';
}

export function setupMobileClassicMenuDocumentState(doc = document) {
    ensureEntryUi(doc);
    ensureRouteUi(doc);
    collapseStartSections(doc);
    ensureStatusUi(doc);
    syncMenuCopy(doc);
    ensureMenuVisibilityObserver(doc);
}

function setButtonLocked(button, locked) {
    if (!button) return;
    button.disabled = !!locked;
    button.setAttribute('aria-hidden', locked ? 'true' : 'false');
    button.tabIndex = locked ? -1 : 0;
}

function setButtonLabel(button, label) {
    if (!button) return;
    const labelNode = button.querySelector?.('.nav-btn-label, .menu-choice-title');
    if (labelNode) {
        labelNode.textContent = label;
    } else {
        button.textContent = label;
    }
    button.title = '';
}

function updateDocumentMode(modePath, doc = (typeof document !== 'undefined' ? document : null)) {
    const normalizedModePath = resolveMobileAndroidModePath({ localSettings: { modePath } });
    if (doc?.documentElement?.dataset) {
        doc.documentElement.dataset.mobileModePath = normalizedModePath;
    }
    if (doc?.body?.dataset) {
        doc.body.dataset.mobileModePath = normalizedModePath;
    }
    updateMenuVisibility(doc);
}

function pruneMapSelectToArcadeAllowlist(select) {
    if (!select?.options) {
        return '';
    }
    const options = Array.from(select.options);
    for (let i = options.length - 1; i >= 0; i -= 1) {
        const option = options[i];
        if (!isMobileArcadeRouteAllowed(option?.value)) {
            option.remove?.();
        }
    }
    const selectedValue = resolveMobileArcadeMapKey(select.value);
    const hasSelectedOption = Array.from(select.options).some((option) => option.value === selectedValue);
    if (hasSelectedOption) {
        select.value = selectedValue;
    } else if (select.options.length > 0) {
        select.value = select.options[0].value;
    }
    return String(select.value || '');
}

function syncQuickStarts(ui = null) {
    const quickStartSection = ui?.quickStartLastButton?.closest?.('.menu-section')
        || ui?.quickStartEventPlaylistButton?.closest?.('.menu-section')
        || ui?.quickStartRandomButton?.closest?.('.menu-section')
        || null;
    if (!quickStartSection) {
        return;
    }
    quickStartSection.classList.add('hidden');
    quickStartSection.setAttribute('aria-hidden', 'true');
}

function formatRouteLabel(mapKey, option = null) {
    const optionText = String(option?.textContent || '').replace(/\s+/g, ' ').trim();
    if (optionText) {
        return optionText.replace(/\s*\([^)]*\)\s*$/, '');
    }
    return String(mapKey || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dispatchMapSelectChange(mapSelect, doc) {
    const eventFactory = doc?.defaultView?.Event || (typeof Event !== 'undefined' ? Event : null);
    if (eventFactory) {
        mapSelect.dispatchEvent(new eventFactory('change', { bubbles: true }));
    } else {
        mapSelect.dispatchEvent?.({ type: 'change', bubbles: true, target: mapSelect });
    }
}

function syncRouteChoices(game = null, ui = null, modePath = MENU_MODE_PATHS.NORMAL, doc = document) {
    const panel = ensureRouteUi(doc);
    const list = doc?.getElementById?.(MOBILE_ANDROID_ROUTE_LIST_ID);
    const mapSelect = ui?.mapSelect || doc?.getElementById?.('map-select') || null;
    if (!panel || !list) {
        return;
    }

    while (list.firstChild) {
        list.removeChild(list.firstChild);
    }

    const selectableOptions = new Map(
        Array.from(mapSelect?.options || [])
            .filter((option) => isMobileArcadeRouteAllowed(option?.value))
            .map((option) => [String(option.value || ''), option])
    );
    const routeKeys = modePath === MENU_MODE_PATHS.ARCADE
        ? listMobileArcadeRouteAllowlist().filter((mapKey) => selectableOptions.has(mapKey))
        : [];
    panel.dataset.routeEmpty = routeKeys.length > 0 ? 'false' : 'true';

    routeKeys.forEach((mapKey) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'mobile-android-route-btn';
        button.dataset.mobileRouteKey = mapKey;
        button.textContent = formatRouteLabel(mapKey, selectableOptions.get(mapKey));
        button.setAttribute('aria-pressed', String(mapSelect?.value === mapKey));
        button.classList.toggle('active', mapSelect?.value === mapKey);
        button.addEventListener?.('click', () => {
            if (!mapSelect) return;
            mapSelect.value = mapKey;
            if (game?.settings) {
                const startSetup = ensureMobileAndroidStartSetup(game.settings);
                game.settings.mapKey = mapKey;
                startSetup.modeSelections.arcade.mapKey = mapKey;
            }
            dispatchMapSelectChange(mapSelect, doc);
            game?.uiManager?.syncStartSetupState?.(game.settings);
            syncRouteChoices(game, ui, modePath, doc);
        });
        list.appendChild(button);
    });
}

function syncEntryButtons(doc, modePath) {
    const panel = doc?.getElementById?.(MOBILE_ANDROID_ENTRY_PANEL_ID);
    if (!panel) {
        return;
    }
    panel.querySelectorAll?.('[data-mobile-mode-entry]')?.forEach((button) => {
        const active = normalizeTarget(button?.dataset?.mobileModeEntry) === modePath;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

function bindMobileModeResync(game, button, applyMobileClassicSettings) {
    if (!button?.dataset || button.dataset.mobileAndroidModeBound === '1') {
        return;
    }
    button.dataset.mobileAndroidModeBound = '1';
    button.addEventListener?.('click', () => {
        const ownerWindow = button.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
        ownerWindow?.setTimeout?.(() => applyMobileClassicMenuUiLocks(game, { applyMobileClassicSettings }), 0);
    });
}

function bindEntryUi(game = null, doc = document, applyMobileClassicSettings = null) {
    const panel = doc?.getElementById?.(MOBILE_ANDROID_ENTRY_PANEL_ID);
    if (!panel || panel.dataset.mobileAndroidEntryBound === '1') {
        return;
    }
    const ownerWindow = resolveWindow(doc);
    panel.querySelectorAll?.('[data-mobile-mode-entry]')?.forEach((button) => {
        button.addEventListener?.('click', () => {
            const modePath = resolveMobileAndroidModePath({
                localSettings: { modePath: button?.dataset?.mobileModeEntry },
            });
            const ui = game?.runtimeCoordinator?.getRuntimeHandle?.('ui') || game?.ui || null;
            const modeButton = Array.isArray(ui?.modePathButtons)
                ? ui.modePathButtons.find((entry) => normalizeTarget(entry?.dataset?.modePath) === modePath)
                : null;
            if (modeButton && !modeButton.disabled) {
                modeButton.click();
            } else if (game?.settings) {
                game.settings.localSettings = typeof game.settings.localSettings === 'object'
                    ? game.settings.localSettings
                    : {};
                game.settings.localSettings.modePath = modePath;
                applyMobileClassicSettings?.(game.settings);
                game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
                    trigger: 'mobile_android_entry',
                    modePath,
                });
            }
            ownerWindow?.setTimeout?.(() => {
                if (game?.settings) {
                    applyMobileClassicSettings?.(game.settings);
                    game.uiManager?.syncStartSetupState?.(game.settings);
                }
                applyMobileClassicMenuUiLocks(game, { applyMobileClassicSettings });
            }, 0);
        });
    });
    panel.dataset.mobileAndroidEntryBound = '1';
}

export function applyMobileClassicMenuUiLocks(game = null, { applyMobileClassicSettings = null } = {}) {
    if (game?.settings) {
        applyMobileClassicSettings?.(game.settings);
        game.uiManager?.syncStartSetupState?.(game.settings);
    }
    const ui = game?.runtimeCoordinator?.getRuntimeHandle?.('ui') || game?.ui || null;
    if (!ui) {
        return;
    }
    const modePath = resolveMobileAndroidModePath(game?.settings || null);
    const doc = ui.mainMenu?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    updateDocumentMode(modePath, doc);
    syncMenuCopy(doc);
    bindEntryUi(game, doc, applyMobileClassicSettings);
    syncEntryButtons(doc, modePath);
    collapseStartSections(doc);
    syncQuickStarts(ui);

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const sessionType = normalizeTarget(button?.dataset?.sessionType);
            setButtonLocked(button, sessionType && sessionType !== MENU_SESSION_TYPES.SINGLE);
            if (sessionType === MENU_SESSION_TYPES.SINGLE) setButtonLabel(button, 'Solo spielen');
        });
    }
    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => {
            const buttonModePath = normalizeTarget(button?.dataset?.modePath);
            const allowed = buttonModePath === MENU_MODE_PATHS.NORMAL || buttonModePath === MENU_MODE_PATHS.ARCADE;
            setButtonLocked(button, buttonModePath && !allowed);
            if (buttonModePath === MENU_MODE_PATHS.NORMAL) {
                setButtonLabel(button, 'Classic');
                bindMobileModeResync(game, button, applyMobileClassicSettings);
            } else if (buttonModePath === MENU_MODE_PATHS.ARCADE) {
                setButtonLabel(button, 'Parcours');
                bindMobileModeResync(game, button, applyMobileClassicSettings);
            }
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
    syncRouteChoices(game, ui, modePath, doc);
    if (ui.startButton) {
        ui.startButton.textContent = modePath === MENU_MODE_PATHS.ARCADE ? 'Parcours starten' : 'Classic starten';
        ui.startButton.title = '';
    }
    if (ui.menuContext) {
        ui.menuContext.textContent = modePath === MENU_MODE_PATHS.ARCADE ? 'Arcade-Parcours' : 'Classic';
    }
}
