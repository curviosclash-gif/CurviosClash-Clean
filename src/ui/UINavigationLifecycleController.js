// ============================================
// UINavigationLifecycleController.js
// Navigation, Level4-Drawer, Expert-Login, Toast, Access-Sichtbarkeit und Dispose
// Extrahiert aus UIManager.js (V38 Phase 38.3.2)
// ============================================

import {
    evaluateMenuAccessPolicy,
    resolveDebugAccessPolicy,
    resolveDeveloperAccessPolicy,
} from './menu/MenuAccessPolicy.js';
import { LEVEL4_SECTION_IDS, MENU_SESSION_TYPES } from './menu/MenuStateContracts.js';
import { MenuNavigationRuntime } from './menu/MenuNavigationRuntime.js';
import { resolveMapPreview } from './menu/MenuPreviewCatalog.js';
import { resolveDeveloperReleaseState } from './menu/MenuUiSyncContext.js';
import { applyMenuChromeState } from './menu/MenuChromeStateOps.js';
import { showStatusToast } from './menu/StatusToastOps.js';

function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

export class UINavigationLifecycleController {
    /**
     * @param {{ ui: object, manager: object, port?: object }} options
     */
    constructor({ ui, manager, port = null }) {
        this.ui = ui;
        this.manager = manager;
        this.port = port;
        this._level4SectionControlsSetup = false;
        this._level4CloseFallbackSetup = false;
        this._developerTextCatalogSetup = false;
        this._toastTimer = null;
    }

    _getActiveSubmenu() {
        return this.port?.getActiveSubmenu?.() || null;
    }

    _setActiveSubmenu(panelId) {
        this.port?.setActiveSubmenu?.(panelId || null);
    }

    _persistMenuState(transition = null) {
        this.port?.persistMenuState?.(this.manager?.menuStateMachine?.getState?.() || null, transition || null);
    }

    _getExpertLoginRuntime() {
        return this.port?.getExpertLoginRuntime?.() || this.manager?.menuExpertLoginRuntime || null;
    }

    _getSettings() {
        return this.port?.getSettings?.() || this.manager?.settings || null;
    }

    _updateToolsState(patch = null) {
        const safePatch = patch && typeof patch === 'object' ? patch : null;
        if (safePatch && this.port?.updateToolsState) {
            this.port.updateToolsState(safePatch);
            return this._getSettings();
        }
        const settings = this._getSettings();
        if (!settings) return null;
        if (!settings.localSettings || typeof settings.localSettings !== 'object') {
            settings.localSettings = {};
        }
        if (!settings.localSettings.toolsState || typeof settings.localSettings.toolsState !== 'object') {
            settings.localSettings.toolsState = {};
        }
        if (safePatch) {
            Object.assign(settings.localSettings.toolsState, safePatch);
        }
        return settings;
    }

    _isSettingsDirty() {
        return this.port?.getSettingsDirty?.() === true;
    }

    // ------------------------------------------------------------------
    // Interne Level4-Hilfsm­ethoden
    // ------------------------------------------------------------------

    _resolveLevel4Section(sectionId, fallback = LEVEL4_SECTION_IDS.CONTROLS) {
        const normalizedSectionId = String(sectionId || '').trim();
        const validIds = Object.values(LEVEL4_SECTION_IDS);
        return validIds.includes(normalizedSectionId) ? normalizedSectionId : fallback;
    }

    _setStartSectionOpen(sectionId, shouldOpen = true) {
        const normalizedSectionId = String(sectionId || '').trim();
        if (!normalizedSectionId) return;
        const section = document.querySelector(`[data-start-section="${normalizedSectionId}"]`);
        if (!(section instanceof HTMLDetailsElement)) return;
        section.open = !!shouldOpen;
    }

    _setupLevel4SectionControls() {
        if (this._level4SectionControlsSetup) return;
        if (!Array.isArray(this.ui.level4SectionTabs)) return;
        this.ui.level4SectionTabs.forEach((button) => {
            this.manager._listen(button, 'click', () => {
                const sectionId = this._resolveLevel4Section(button?.dataset?.level4SectionTarget);
                this.setLevel4Section(sectionId, { persist: true, focus: true });
            });
            this.manager._listen(button, 'keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const tabs = this.ui.level4SectionTabs.filter(Boolean);
                const currentIndex = tabs.indexOf(button);
                if (currentIndex < 0 || tabs.length === 0) return;
                const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
                tabs[nextIndex]?.focus?.();
            });
        });
        this._level4SectionControlsSetup = true;
    }

    ensureLevel4SectionControlsSetup() {
        if (this._level4SectionControlsSetup) return;
        this._setupLevel4SectionControls();
    }

    ensureDeveloperTextCatalogSetup() {
        if (this._developerTextCatalogSetup) return;
        this.manager._setupDeveloperTextCatalog();
        this._developerTextCatalogSetup = true;
    }

    _syncLevel4SectionState(sectionId, options = {}) {
        const resolvedSectionId = this._resolveLevel4Section(sectionId);
        const tabs = Array.isArray(this.ui.level4SectionTabs) ? this.ui.level4SectionTabs : [];
        const panels = Array.isArray(this.ui.level4SectionPanels) ? this.ui.level4SectionPanels : [];
        tabs.forEach((button) => {
            const isActive = this._resolveLevel4Section(button?.dataset?.level4SectionTarget, '') === resolvedSectionId;
            button.setAttribute('aria-selected', String(isActive));
            button.classList.toggle('active', isActive);
            button.tabIndex = isActive ? 0 : -1;
        });
        panels.forEach((panel) => {
            const panelSectionId = this._resolveLevel4Section(panel?.dataset?.level4Section, '');
            const isActive = panelSectionId === resolvedSectionId;
            panel.classList.toggle('is-active', isActive);
            panel.setAttribute('aria-hidden', String(!isActive));
        });
        if (options.focus) {
            const activePanel = panels.find((panel) => this._resolveLevel4Section(panel?.dataset?.level4Section, '') === resolvedSectionId);
            const focusTarget = activePanel?.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
                || tabs.find((button) => this._resolveLevel4Section(button?.dataset?.level4SectionTarget, '') === resolvedSectionId);
            focusWithoutScroll(focusTarget);
        }
    }

    _syncMenuChromeState(panelId = this._getActiveSubmenu()) {
        applyMenuChromeState(this.ui.mainMenu, {
            panelId,
            level4Open: this._getSettings()?.localSettings?.toolsState?.level4Open === true,
        });
    }

    // ------------------------------------------------------------------
    // Public Level4-Methoden
    // ------------------------------------------------------------------

    setLevel4Section(sectionId, options = {}) {
        const resolvedSectionId = this._resolveLevel4Section(sectionId);
        const settings = this._updateToolsState();
        if (!settings?.localSettings?.toolsState) return;
        if (options.persist !== false) {
            this._updateToolsState({ activeSection: resolvedSectionId });
        }
        if (!this._getSettings()?.localSettings?.toolsState?.level4Open) return;
        this.ensureLevel4SectionControlsSetup();
        this._syncLevel4SectionState(resolvedSectionId, options);
        this.manager.updateContext();
    }

    setLevel4Open(isOpen) {
        const drawer = this.ui.level4Drawer;
        if (!drawer) return;
        const open = !!isOpen;
        const wasOpen = !drawer.classList.contains('hidden') && drawer.getAttribute('aria-hidden') !== 'true';
        if (open) {
            this.ensureLevel4SectionControlsSetup();
        }
        const settings = this._updateToolsState({ level4Open: open });
        if (!settings?.localSettings?.toolsState) return;
        drawer.classList.toggle('hidden', !open);
        drawer.setAttribute('aria-hidden', String(!open));
        const activeSection = this._resolveLevel4Section(
            settings?.localSettings?.toolsState?.activeSection,
            LEVEL4_SECTION_IDS.CONTROLS
        );
        if (open || this._level4SectionControlsSetup) {
            this._syncLevel4SectionState(activeSection, { focus: false });
        }
        this._syncMenuChromeState(this._getActiveSubmenu() || null);
        if (open) {
            const activePanel = Array.isArray(this.ui.level4SectionPanels)
                ? this.ui.level4SectionPanels.find((panel) => this._resolveLevel4Section(panel?.dataset?.level4Section, '') === activeSection)
                : null;
            const firstFocusable = activePanel?.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
                || drawer.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
            focusWithoutScroll(firstFocusable);
        } else if (wasOpen && this._getActiveSubmenu() === 'submenu-game') {
            focusWithoutScroll(this.ui.openLevel4Button);
        }
        this.manager.updateContext();
    }

    // ------------------------------------------------------------------
    // Expert-Login
    // ------------------------------------------------------------------

    setupExpertLoginBindings() {
        const runtime = this._getExpertLoginRuntime();
        if (!runtime) return;
        const listen = (target, type, handler) => this.manager._listen(target, type, handler);
        if (this.ui.expertPasswordInput) {
            listen(this.ui.expertPasswordInput, 'input', () => runtime.clearError());
            listen(this.ui.expertPasswordInput, 'keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this._attemptExpertUnlock();
            });
        }
        if (this.ui.expertUnlockButton)  listen(this.ui.expertUnlockButton,   'click', () => this._attemptExpertUnlock());
        if (this.ui.expertLockButton)    listen(this.ui.expertLockButton,     'click', () => runtime.lock());
        if (this.ui.expertQuickLockButton) listen(this.ui.expertQuickLockButton, 'click', () => runtime.lock());
        if (this.ui.expertCancelButton)  listen(this.ui.expertCancelButton,   'click', () => this.manager.showMainNav());
    }

    _attemptExpertUnlock() {
        const runtime = this._getExpertLoginRuntime();
        if (!runtime) return;
        const password = String(this.ui.expertPasswordInput?.value || '');
        const result = runtime.unlock(password);
        if (!result.success) {
            const isPasswordError = result.reason === 'invalid_password';
            this.manager.showToast(result.message || 'Passwort falsch.', 1400, isPasswordError ? 'error' : 'info');
            if (isPasswordError) {
                this.ui.expertPasswordInput?.focus?.();
                this.ui.expertPasswordInput?.select?.();
            }
            return;
        }
        runtime.focusPrimaryControl();
    }

    handleExpertStateChanged() {
        const settings = this._getSettings();
        const menuUiContext = this.manager._resolveMenuUiContext?.(settings) || null;
        if (menuUiContext) {
            this.manager.syncDeveloperState(settings, menuUiContext);
            this.updateContext(menuUiContext);
        } else {
            this.manager.updateContext();
            this.manager.syncDeveloperState(settings);
        }
        if (this._getActiveSubmenu() === 'submenu-expert') {
            this._getExpertLoginRuntime()?.focusPrimaryControl?.();
        }
    }

    // ------------------------------------------------------------------
    // Menü-Navigation
    // ------------------------------------------------------------------

    setupMenuNavigation() {
        const manager = this.manager;
        manager._navButtons = Array.isArray(this.ui.menuNavButtons) && this.ui.menuNavButtons.length > 0
            ? this.ui.menuNavButtons
            : Array.from(document.querySelectorAll('.nav-btn'));
        manager._submenuPanels = Array.isArray(this.ui.menuPanels) && this.ui.menuPanels.length > 0
            ? this.ui.menuPanels
            : Array.from(document.querySelectorAll('.submenu-panel'));

        if (!this._level4CloseFallbackSetup && this.ui.closeLevel4Button) {
            this.manager._listen(this.ui.closeLevel4Button, 'click', () => manager.setLevel4Open(false));
            this._level4CloseFallbackSetup = true;
        }

        manager._menuButtonByPanel.clear();
        manager._navButtons.forEach(btn => {
            const rawTargetId = btn.dataset.submenu || btn.dataset.menuTarget;
            const targetId = manager.menuPanelRegistry.resolvePanelId(rawTargetId) || rawTargetId;
            if (targetId) manager._menuButtonByPanel.set(targetId, btn);
        });

        if (manager.menuNavigationRuntime?.dispose) {
            manager.menuNavigationRuntime.dispose();
        }

        manager.menuNavigationRuntime = new MenuNavigationRuntime({
            ui: this.ui,
            panelRegistry: manager.menuPanelRegistry,
            stateMachine: manager.menuStateMachine,
            accessContext: manager._accessContext,
            onLevel4CloseRequested: () => manager.setLevel4Open(false),
            onPanelChanged: (panelId, _panelConfig, _transition, transitionMetadata) => {
                const previousPanelId = this._getActiveSubmenu() || null;
                this._setActiveSubmenu(panelId || null);
                if (panelId === 'submenu-developer') {
                    this.ensureDeveloperTextCatalogSetup();
                }
                if (panelId === 'submenu-expert') {
                    this._getExpertLoginRuntime()?.focusPrimaryControl?.();
                }
                if (panelId !== 'submenu-game' && this._getSettings()?.localSettings?.toolsState?.level4Open) {
                    this._updateToolsState({ level4Open: false });
                    manager.setLevel4Open(false);
                }
                this.manager.ports?.runtimeIntentPort?.handleMenuPanelChanged?.(previousPanelId, panelId || null, transitionMetadata || null);
                this._syncMenuChromeState(panelId || null);
                manager.updateContext();
            },
            onMenuStateChanged: (transition) => {
                this._persistMenuState(transition || null);
            },
        });
        manager.menuNavigationRuntime.init();
        this._syncMenuChromeState(this._getActiveSubmenu() || null);
    }

    showMainNav() {
        const manager = this.manager;
        if (manager.menuNavigationRuntime) {
            manager.menuNavigationRuntime.showMainNav({ trigger: 'ui_manager' });
            manager.setLevel4Open(false);
            return;
        }
        const submenus = manager._submenuPanels.length > 0
            ? manager._submenuPanels
            : Array.from(document.querySelectorAll('.submenu-panel'));
        submenus.forEach(p => p.classList.add('hidden'));
        manager._navButtons.forEach(b => b.classList.remove('active'));
        this._setActiveSubmenu(null);
        manager.setLevel4Open(false);
        manager.updateContext();
    }

    // ------------------------------------------------------------------
    // Developer-Release-Sichtbarkeit
    // ------------------------------------------------------------------

    _setElementsHidden(elements, hidden) {
        if (!Array.isArray(elements)) return;
        elements.forEach((element) => {
            if (!element) return;
            element.classList.toggle('hidden', !!hidden);
            element.setAttribute('aria-hidden', String(!!hidden));
            if (hidden) {
                element.setAttribute('tabindex', '-1');
            } else {
                element.removeAttribute('tabindex');
            }
        });
    }

    syncDeveloperReleaseCutVisibility(menuUiContext = this.manager.getMenuUiContext?.(this._getSettings())) {
        const manager = this.manager;
        const settings = menuUiContext?.settings || this._getSettings();
        const accessContext = menuUiContext?.accessContext || manager._accessContext || {};
        const releaseState = menuUiContext?.releaseState || resolveDeveloperReleaseState(settings);
        const shouldHideDeveloperUi = releaseState.developerUiHidden;
        const shouldHideDebugHints = releaseState.releaseCutEnabled;
        const developerPanelConfig = manager.menuPanelRegistry.getPanelById('submenu-developer');
        const debugPanelConfig = manager.menuPanelRegistry.getPanelById('submenu-debug');
        const developerPolicy = developerPanelConfig?.semanticId === 'developer'
            ? resolveDeveloperAccessPolicy(accessContext)
            : (developerPanelConfig?.accessPolicy || 'open');
        const debugPolicy = debugPanelConfig?.semanticId === 'debug'
            ? resolveDebugAccessPolicy(accessContext)
            : (debugPanelConfig?.accessPolicy || 'open');
        const developerAllowed = !shouldHideDeveloperUi
            && developerPanelConfig?.visibility !== 'hidden'
            && evaluateMenuAccessPolicy(developerPolicy, accessContext).allowed;
        const debugAllowed = !shouldHideDeveloperUi
            && debugPanelConfig?.visibility !== 'hidden'
            && evaluateMenuAccessPolicy(debugPolicy, accessContext).allowed;

        this._setElementsHidden(manager._developerNavButtons, !developerAllowed);
        this._setElementsHidden(manager._debugNavButtons, !debugAllowed);
        this._setElementsHidden(manager._debugHintNodes, shouldHideDebugHints);

        if (manager._developerPanel) {
            manager._developerPanel.setAttribute('data-release-cut', shouldHideDeveloperUi ? 'true' : 'false');
        }
        if (!developerAllowed && this._getActiveSubmenu() === 'submenu-developer') {
            manager.showMainNav();
            return;
        }
        if (!debugAllowed && this._getActiveSubmenu() === 'submenu-debug') {
            manager.showMainNav();
        }
    }

    // ------------------------------------------------------------------
    // Toast
    // ------------------------------------------------------------------

    showToast(message, durationMsOrTone = 1200, tone = 'info') {
        if (this._toastTimer) clearTimeout(this._toastTimer);
        const { timerId } = showStatusToast(this.ui.statusToast, message, durationMsOrTone, tone);
        this._toastTimer = timerId;
    }

    // ------------------------------------------------------------------
    // updateContext + Hilfsmethoden
    // ------------------------------------------------------------------

    updateContext(menuUiContext = null) {
        const manager = this.manager;
        if (!this.ui.menuContext) return;
        const resolvedContext = menuUiContext
            || manager.getMenuUiContext?.(this._getSettings())
            || null;
        const settings = resolvedContext?.settings || this._getSettings() || {};
        const accessContext = resolvedContext?.accessContext || manager._accessContext || {};
        manager._accessContext = accessContext;
        manager.menuNavigationRuntime?.setAccessContext?.(accessContext);
        const activeSubmenu = this._getActiveSubmenu();
        this._syncMenuChromeState(activeSubmenu || null);
        const section = this._getMenuSectionLabel(activeSubmenu);
        const activeProfile = this._resolveActiveProfileName();
        const dirtyState = this._isSettingsDirty() ? 'ungespeicherte Aenderungen' : 'alles gespeichert';
        const sessionType = String(
            resolvedContext?.surfaceMenuState?.sessionType
            || settings?.localSettings?.sessionType
            || MENU_SESSION_TYPES.SINGLE
        ).toLowerCase();
        const sessionLabel = sessionType === MENU_SESSION_TYPES.SPLITSCREEN
            ? 'Splitscreen'
            : (sessionType === MENU_SESSION_TYPES.MULTIPLAYER ? 'Multiplayer' : 'Single Player');
        const modePath = String(
            resolvedContext?.surfaceMenuState?.modePath
            || settings?.localSettings?.modePath
            || 'normal'
        ).toLowerCase();
        const modeLabel = modePath === 'fight'
            ? 'Fight'
            : (modePath === 'arcade' ? 'Arcade' : (modePath === 'quick_action' ? 'Schnellstart' : 'Normal'));
        const mapLabel = resolveMapPreview(settings?.mapKey).name;
        const activeSection = this._resolveLevel4Section(settings?.localSettings?.toolsState?.activeSection);
        const activeSectionLabel = {
            [LEVEL4_SECTION_IDS.CONTROLS]: 'Steuerung',
            [LEVEL4_SECTION_IDS.MOBILE_CONTROLS]: 'Mobile',
            [LEVEL4_SECTION_IDS.GAMEPLAY]: 'Gameplay',
            [LEVEL4_SECTION_IDS.ADVANCED_MAP]: 'Map-Details',
            [LEVEL4_SECTION_IDS.TOOLS]: 'Profile',
        }[activeSection] || 'Profile';

        let contextText = `${section} | Profil: ${activeProfile} | ${dirtyState}`;
        if (settings?.localSettings?.toolsState?.level4Open) {
            contextText = `Ebene 4 | ${activeSectionLabel} | ${sessionLabel} | ${dirtyState}`;
        } else if (activeSubmenu === 'submenu-game') {
            contextText = `${section} | ${sessionLabel} | ${modeLabel} | ${mapLabel}`;
        } else if (activeSubmenu === 'submenu-custom') {
            contextText = `${section} | ${sessionLabel} | Sofortstart oder Setup | ${dirtyState}`;
        } else if (activeSubmenu === 'submenu-expert') {
            const expertState = this._getExpertLoginRuntime()?.getState?.() || null;
            const expertStateLabel = expertState?.available === false
                ? 'lokaler Dev-Pfad'
                : (expertState?.unlocked ? 'freigeschaltet' : 'gesperrt');
            contextText = `${section} | Expertenstatus: ${expertStateLabel} | ${dirtyState}`;
        }
        this.ui.menuContext.textContent = contextText;
    }

    _resolveActiveProfileName() {
        const typedProfile = this.ui?.profileNameInput?.value || '';
        const normalizedTypedProfile = this.port?.normalizeProfileName?.(typedProfile) || typedProfile.trim();
        return this.port?.getActiveProfileName?.() || normalizedTypedProfile || 'kein Profil';
    }

    _getMenuSectionLabel(panelId) {
        const manager = this.manager;
        if (!panelId) return 'Hauptmenue';
        const registeredPanel = manager.menuPanelRegistry.getPanelById(panelId);
        if (registeredPanel?.label) {
            return String(registeredPanel.label).replace(/\s+/g, ' ').trim();
        }
        const linkedButton = manager._menuButtonByPanel.get(panelId);
        if (linkedButton) {
            return (linkedButton.textContent || '').replace(/\s+/g, ' ').trim();
        }
        const panelTitle = document.querySelector(`#${panelId} .submenu-title`);
        return (panelTitle?.textContent || 'Untermenue').replace(/\s+/g, ' ').trim();
    }

    // ------------------------------------------------------------------
    // Dispose
    // ------------------------------------------------------------------

    dispose() {
        if (this._toastTimer) {
            clearTimeout(this._toastTimer);
            this._toastTimer = null;
        }
        this._level4SectionControlsSetup = false;
        this._level4CloseFallbackSetup = false;
        this._developerTextCatalogSetup = false;
    }
}
