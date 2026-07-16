import {
    evaluateMenuAccessPolicy,
    resolveDebugAccessPolicy,
    resolveDeveloperAccessPolicy,
} from './MenuAccessPolicy.js';
import { MENU_STATE_IDS } from './MenuStateMachine.js';

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.closest?.('[inert], [aria-hidden="true"], .hidden, details:not([open])')
        && element.getAttribute?.('aria-disabled') !== 'true');
}

function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

function isMobileMenuDocument(doc) {
    return doc?.body?.classList?.contains?.('mobile-classic-app')
        || doc?.body?.classList?.contains?.('mobile-arcade-app');
}

function resetMobileMenuScroll(targetPanel) {
    const doc = targetPanel?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!isMobileMenuDocument(doc)) return;
    const scrollContainer = targetPanel?.closest?.('.menu-content')
        || doc?.querySelector?.('.menu-content')
        || null;
    if (!scrollContainer) return;
    if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
    } else {
        scrollContainer.scrollTop = 0;
    }
}

function resetMobileMainNavScroll(menuRoot) {
    const doc = menuRoot?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!isMobileMenuDocument(doc)) return;
    const scrollContainer = menuRoot?.querySelector?.('.menu-content')
        || doc?.querySelector?.('.menu-content')
        || null;
    if (!scrollContainer) return;
    if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
    } else {
        scrollContainer.scrollTop = 0;
    }
}

export class MenuNavigationRuntime {
    constructor(options = {}) {
        this.ui = options.ui || {};
        this.panelRegistry = options.panelRegistry || null;
        this.stateMachine = options.stateMachine || null;
        this.onMenuStateChanged = typeof options.onMenuStateChanged === 'function'
            ? options.onMenuStateChanged
            : null;
        this.onPanelChanged = typeof options.onPanelChanged === 'function'
            ? options.onPanelChanged
            : null;
        this.onLevel4CloseRequested = typeof options.onLevel4CloseRequested === 'function'
            ? options.onLevel4CloseRequested
            : null;
        this.accessContext = options.accessContext && typeof options.accessContext === 'object'
            ? options.accessContext
            : { isOwner: true };

        this._initialized = false;
        this._disposers = [];
        this._buttonByPanelId = new Map();
        this._panelTargetByButton = new Map();
        this._panelById = new Map();
        this._navButtons = [];
        this._submenuPanels = [];
        this._gamepadLoopHandle = null;
        this._gamepadButtonStateByIndex = new Map();
        this._activeSessionType = '';
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this._navButtons = Array.isArray(this.ui.menuNavButtons) && this.ui.menuNavButtons.length > 0
            ? this.ui.menuNavButtons
            : Array.from(document.querySelectorAll('.nav-btn'));
        this._submenuPanels = Array.isArray(this.ui.menuPanels) && this.ui.menuPanels.length > 0
            ? this.ui.menuPanels
            : Array.from(document.querySelectorAll('.submenu-panel'));

        this._buttonByPanelId.clear();
        this._panelTargetByButton.clear();
        this._panelById.clear();
        this._submenuPanels.forEach((panel) => {
            const id = normalizeId(panel?.id);
            if (!id) return;
            this._panelById.set(id, panel);
        });

        this._navButtons.forEach((button) => {
            const rawTarget = normalizeId(button.dataset.submenu || button.dataset.menuTarget);
            const targetId = this.panelRegistry?.resolvePanelId(rawTarget) || rawTarget;
            if (!targetId) return;
            if (!this._buttonByPanelId.has(targetId)) {
                this._buttonByPanelId.set(targetId, []);
            }
            this._buttonByPanelId.get(targetId).push(button);
            this._panelTargetByButton.set(button, targetId);

            const onClick = () => {
                const sessionType = normalizeId(button.dataset.sessionType);
                this.showPanel(targetId, {
                    trigger: 'nav_button',
                    sessionType: sessionType || undefined,
                });
            };
            button.addEventListener('click', onClick);
            this._disposers.push(() => button.removeEventListener('click', onClick));
        });

        const backButtons = Array.from(document.querySelectorAll('[data-back]'));
        backButtons.forEach((button) => {
            if (button === this.ui.closeLevel4Button) return;
            const onClick = () => {
                const targetId = normalizeId(button.dataset.backTarget);
                this._goBackFromCurrent('back_button', targetId);
            };
            button.addEventListener('click', onClick);
            this._disposers.push(() => button.removeEventListener('click', onClick));
        });

        const stepperButtons = Array.isArray(this.ui.customStepperButtons) && this.ui.customStepperButtons.length > 0
            ? this.ui.customStepperButtons
            : Array.from(document.querySelectorAll('[data-menu-step], [data-menu-step-target]'));
        stepperButtons.forEach((button) => {
            const onClick = () => {
                const rawTarget = normalizeId(
                    button.dataset.menuStepTarget
                    || button.dataset.menuStep
                    || button.dataset.submenu
                );
                const targetId = this.panelRegistry?.resolvePanelId(rawTarget) || rawTarget;
                if (!targetId) return;
                this.showPanel(targetId, { trigger: 'custom_stepper' });
            };
            button.addEventListener('click', onClick);
            this._disposers.push(() => button.removeEventListener('click', onClick));
        });

        const menuRoot = this.ui.mainMenu || document.getElementById('main-menu');
        if (menuRoot) {
            const onKeyDown = (event) => this._handleMenuKeyDown(event);
            menuRoot.addEventListener('keydown', onKeyDown);
            this._disposers.push(() => menuRoot.removeEventListener('keydown', onKeyDown));
        }

        const focusMainAfterDocumentLoad = () => requestAnimationFrame(
            () => this.focusMainAction({ onlyIfFocusLost: true })
        );
        if (document.readyState === 'complete') {
            focusMainAfterDocumentLoad();
        } else {
            window.addEventListener('load', focusMainAfterDocumentLoad, { once: true });
            this._disposers.push(() => window.removeEventListener('load', focusMainAfterDocumentLoad));
        }

        this.applyAccessPolicy();
        this.showMainNav({ trigger: 'init' });
        this._startGamepadLoop();
    }

    dispose() {
        while (this._disposers.length > 0) {
            const dispose = this._disposers.pop();
            try {
                dispose?.();
            } catch {
                // Ignore dispose errors to keep menu runtime robust.
            }
        }
        this._stopGamepadLoop();
        this._initialized = false;
    }

    setAccessContext(accessContext) {
        if (!accessContext || typeof accessContext !== 'object') return;
        this.accessContext = { ...accessContext };
        this.applyAccessPolicy();
    }

    applyAccessPolicy() {
        for (const [panelId, buttons] of this._buttonByPanelId.entries()) {
            const panelConfig = this.panelRegistry?.getPanelById(panelId);
            const panelPolicy = this._resolvePanelPolicy(panelConfig);
            const accessResult = evaluateMenuAccessPolicy(panelPolicy, this.accessContext);
            const isVisible = panelConfig?.visibility !== 'hidden' && accessResult.allowed;
            buttons.forEach((button) => {
                button.classList.toggle('hidden', !isVisible);
                button.setAttribute('aria-hidden', String(!isVisible));
                if (!isVisible) {
                    button.setAttribute('tabindex', '-1');
                    button.setAttribute('aria-disabled', 'true');
                } else {
                    button.removeAttribute('tabindex');
                    button.removeAttribute('aria-disabled');
                }
            });
        }
    }

    showPanel(requestedPanelId, metadata = null) {
        const panelId = this.panelRegistry?.resolvePanelId(requestedPanelId) || normalizeId(requestedPanelId);
        if (!panelId) return false;

        const targetPanel = this._panelById.get(panelId) || document.getElementById(panelId);
        if (!targetPanel) return false;

        const panelConfig = this.panelRegistry?.getPanelById(panelId);
        const panelPolicy = this._resolvePanelPolicy(panelConfig);
        const accessResult = evaluateMenuAccessPolicy(panelPolicy, this.accessContext);
        if (panelConfig?.visibility === 'hidden' || !accessResult.allowed) {
            return false;
        }

        const semanticState = normalizeId(panelConfig?.semanticId, panelId);
        const transition = this.stateMachine?.transition
            ? this.stateMachine.transition(semanticState, metadata)
            : { state: semanticState };
        if (transition?.blocked) return false;

        this._submenuPanels.forEach((panel) => {
            const isTarget = panel === targetPanel;
            panel.classList.toggle('hidden', !isTarget);
            panel.setAttribute('aria-hidden', String(!isTarget));
            panel.setAttribute('data-menu-visible', isTarget ? 'true' : 'false');
        });

        const requestedSessionType = normalizeId(metadata?.sessionType).toLowerCase();
        if (requestedSessionType) {
            this._activeSessionType = requestedSessionType;
        }
        const effectiveSessionType = this._activeSessionType;
        this._navButtons.forEach((button) => {
            const rawTarget = normalizeId(button.dataset.submenu || button.dataset.menuTarget);
            const resolvedTarget = this.panelRegistry?.resolvePanelId(rawTarget) || rawTarget;
            const buttonSessionType = normalizeId(button.dataset.sessionType).toLowerCase();
            if (buttonSessionType) {
                const isActiveSession = !!effectiveSessionType && buttonSessionType === effectiveSessionType;
                const isExpanded = resolvedTarget === panelId && isActiveSession;
                button.classList.toggle('active', isActiveSession);
                button.setAttribute('aria-pressed', String(isActiveSession));
                button.setAttribute('aria-expanded', String(isExpanded));
                return;
            }

            const isExpanded = resolvedTarget === panelId;
            button.classList.toggle('active', isExpanded);
            button.setAttribute('aria-expanded', String(isExpanded));
        });

        this.onPanelChanged?.(panelId, panelConfig || null, transition, metadata && typeof metadata === 'object' ? { ...metadata } : null);
        this.onMenuStateChanged?.(transition);

        const callbackFocusTarget = targetPanel.ownerDocument?.activeElement || null;
        if (!targetPanel.contains?.(callbackFocusTarget)) {
            const [focusTarget] = getFocusableElements(targetPanel);
            focusWithoutScroll(focusTarget);
        }
        resetMobileMenuScroll(targetPanel);
        return true;
    }

    showMainNav(metadata = null) {
        this._submenuPanels.forEach((panel) => {
            panel.classList.add('hidden');
            panel.setAttribute('aria-hidden', 'true');
            panel.setAttribute('data-menu-visible', 'false');
        });
        this._navButtons.forEach((button) => {
            const isSessionButton = !!normalizeId(button.dataset.sessionType);
            if (!isSessionButton || button.getAttribute('aria-pressed') !== 'true') {
                button.classList.remove('active');
            }
            button.setAttribute('aria-expanded', 'false');
        });

        const transition = this.stateMachine?.transition
            ? this.stateMachine.transition(MENU_STATE_IDS.MAIN, metadata)
            : { state: MENU_STATE_IDS.MAIN };
        this.onPanelChanged?.(null, null, transition, metadata && typeof metadata === 'object' ? { ...metadata } : null);
        this.onMenuStateChanged?.(transition);

        const firstVisibleButton = this._getVisibleMainActions()[0] || null;
        this.focusMainAction();
        queueMicrotask(() => {
            this.focusMainAction({ onlyIfFocusLost: true, fallbackTarget: firstVisibleButton });
        });
        resetMobileMainNavScroll(this.ui.mainMenu || document.getElementById('main-menu'));
    }

    focusMainAction(options = {}) {
        if (this.stateMachine?.getState?.() !== MENU_STATE_IDS.MAIN) return false;
        const menuRoot = this.ui.mainMenu || document.getElementById('main-menu');
        const activeElement = document.activeElement;
        const focusWasLost = !activeElement || activeElement === document.body || !menuRoot?.contains?.(activeElement);
        if (options.onlyIfFocusLost === true && !focusWasLost) return false;
        if (!this._isMenuInteractive()) return false;
        const target = options.fallbackTarget || this._getVisibleMainActions()[0] || null;
        focusWithoutScroll(target);
        return !!target;
    }

    _handleMenuKeyDown(event) {
        if (!event) return;
        if (event.key === 'Tab') {
            const focusScope = this._isLevel4Open()
                ? (this.ui.level4Drawer || document.getElementById('submenu-level4'))
                : (this._getVisiblePanelElement() || this.ui.mainMenu || document.getElementById('main-menu'));
            this._trapFocus(event, focusScope);
            return;
        }
        if (
            event.key === 'Escape'
            && (this._isLevel4Open() || this.stateMachine?.getState?.() !== MENU_STATE_IDS.MAIN)
        ) {
            event.preventDefault();
            this._goBackFromCurrent('escape');
            return;
        }

        const activeElement = document.activeElement;
        const usesNativeKeyboardInput = this._usesNativeKeyboardInput(activeElement);
        if (event.key === 'Enter' || event.key === ' ') {
            if (usesNativeKeyboardInput) return;
            this._activateFocusedElement(event);
            return;
        }

        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        if (usesNativeKeyboardInput) return;

        event.preventDefault();
        if (event.key === 'ArrowRight') this._moveFocusByDirection('right');
        if (event.key === 'ArrowLeft') this._moveFocusByDirection('left');
        if (event.key === 'ArrowUp') this._moveFocusByDirection('up');
        if (event.key === 'ArrowDown') this._moveFocusByDirection('down');
    }

    _usesNativeKeyboardInput(element) {
        if (!element || typeof element.tagName !== 'string') return false;
        const tagName = element.tagName.toLowerCase();
        return ['input', 'select', 'textarea'].includes(tagName)
            || element.isContentEditable === true;
    }

    _getVisibleNavButtons() {
        return this._navButtons.filter((button) => !button.classList.contains('hidden'));
    }

    _trapFocus(event, container) {
        const focusables = getFocusableElements(container);
        if (focusables.length === 0) return false;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeElement = document.activeElement;
        const activeInside = !!activeElement && container?.contains?.(activeElement);
        if (event.shiftKey && (!activeInside || activeElement === first)) {
            event.preventDefault();
            focusWithoutScroll(last);
            return true;
        }
        if (!event.shiftKey && (!activeInside || activeElement === last)) {
            event.preventDefault();
            focusWithoutScroll(first);
            return true;
        }
        return false;
    }

    _getVisibleMainActions() {
        const menuRoot = this.ui.mainMenu || document.getElementById('main-menu');
        const primaryActions = Array.from(menuRoot?.querySelectorAll?.('[data-menu-main-action]') || []);
        return [...primaryActions, ...this._getVisibleNavButtons()].filter((button) => (
            !button.classList.contains('hidden')
            && button.getAttribute('aria-hidden') !== 'true'
            && !button.disabled
        ));
    }

    _getVisiblePanelElement() {
        if (this._isLevel4Open()) {
            return this.ui.level4Drawer || document.getElementById('submenu-level4');
        }
        return this._submenuPanels.find((panel) => !panel.classList.contains('hidden')) || null;
    }

    _moveFocusInCollection(elements, delta) {
        if (!Array.isArray(elements) || elements.length === 0) return;
        const activeElement = document.activeElement;
        const activeIndex = elements.indexOf(activeElement);
        const resolvedIndex = activeIndex >= 0 ? activeIndex : 0;
        const nextIndex = (resolvedIndex + delta + elements.length) % elements.length;
        elements[nextIndex].focus();
    }

    _moveFocusByDirection(direction) {
        if ((direction === 'left' || direction === 'right') && this._moveStartSetupChoice(direction)) {
            return;
        }
        const delta = direction === 'left' || direction === 'up' ? -1 : 1;
        const state = this.stateMachine?.getState?.() || MENU_STATE_IDS.MAIN;
        if (state === MENU_STATE_IDS.MAIN) {
            this._moveFocusInCollection(this._getVisibleMainActions(), delta);
            return;
        }

        const visiblePanel = this._getVisiblePanelElement();
        const focusables = getFocusableElements(visiblePanel);
        if (focusables.length > 0) {
            this._moveFocusInCollection(focusables, delta);
            return;
        }
        this._moveFocusInCollection(this._getVisibleNavButtons(), delta);
    }

    _moveStartSetupChoice(direction) {
        const activeElement = document.activeElement;
        const listbox = activeElement?.closest?.('[role="listbox"]');
        if (!listbox) return false;
        const choices = Array.from(listbox.querySelectorAll('[role="option"]'))
            .filter((entry) => !entry.disabled && !entry.classList.contains('hidden'));
        const currentIndex = choices.indexOf(activeElement);
        if (currentIndex < 0 || choices.length < 2) return false;
        const delta = direction === 'left' ? -1 : 1;
        const next = choices[(currentIndex + delta + choices.length) % choices.length];
        next.focus();
        next.click();
        return true;
    }

    _activateFocusedElement(event = null) {
        const activeElement = document.activeElement;
        if (!activeElement || typeof activeElement.click !== 'function') return;
        if (!activeElement.matches('button, [role="button"], .nav-btn, .secondary-btn, .mode-btn')) return;
        event?.preventDefault?.();
        activeElement.click();
    }

    _isMenuInteractive() {
        const menuRoot = this.ui.mainMenu || document.getElementById('main-menu');
        if (!menuRoot) return false;
        if (menuRoot.classList.contains('hidden')) return false;
        if (menuRoot.getAttribute('aria-hidden') === 'true') return false;
        return true;
    }

    _isLevel4Open() {
        const drawer = this.ui.level4Drawer || document.getElementById('submenu-level4');
        return !!drawer && !drawer.classList.contains('hidden') && drawer.getAttribute('aria-hidden') !== 'true';
    }

    _goBackFromCurrent(trigger = 'back_button', explicitTargetId = '') {
        if (this._isLevel4Open()) {
            this.onLevel4CloseRequested?.({ trigger });
            return true;
        }

        const normalizedExplicitTarget = normalizeId(explicitTargetId);
        if (normalizedExplicitTarget) {
            return this.showPanel(normalizedExplicitTarget, { trigger, backNavigation: true });
        }

        const visiblePanel = this._getVisiblePanelElement();
        const backButton = visiblePanel?.querySelector?.('[data-back]');
        const backTargetId = normalizeId(backButton?.dataset?.backTarget);
        if (backTargetId) {
            return this.showPanel(backTargetId, { trigger, backNavigation: true });
        }

        this.showMainNav({ trigger });
        return true;
    }

    _pollGamepadButtons() {
        if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
        const gamepads = navigator.getGamepads();
        const gamepad = Array.from(gamepads || []).find((entry) => !!entry);
        if (!gamepad) {
            this._gamepadButtonStateByIndex.clear();
            return;
        }
        if (!this._isMenuInteractive()) return;

        const consumePress = (index) => {
            const isPressed = !!gamepad.buttons?.[index]?.pressed;
            const wasPressed = !!this._gamepadButtonStateByIndex.get(index);
            this._gamepadButtonStateByIndex.set(index, isPressed);
            return isPressed && !wasPressed;
        };

        if (consumePress(14)) this._moveFocusByDirection('left');
        if (consumePress(15)) this._moveFocusByDirection('right');
        if (consumePress(12)) this._moveFocusByDirection('up');
        if (consumePress(13)) this._moveFocusByDirection('down');
        if (consumePress(0)) this._activateFocusedElement();
        if (consumePress(1) && (this._isLevel4Open() || this.stateMachine?.getState?.() !== MENU_STATE_IDS.MAIN)) {
            this._goBackFromCurrent('controller_back');
        }
        if (consumePress(4)) this._moveFocusByDirection('left');
        if (consumePress(5)) this._moveFocusByDirection('right');
    }

    _startGamepadLoop() {
        if (this._gamepadLoopHandle !== null) return;
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
        const tick = () => {
            this._pollGamepadButtons();
            this._gamepadLoopHandle = window.requestAnimationFrame(tick);
        };
        this._gamepadLoopHandle = window.requestAnimationFrame(tick);
    }

    _stopGamepadLoop() {
        if (this._gamepadLoopHandle === null) return;
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this._gamepadLoopHandle);
        }
        this._gamepadLoopHandle = null;
        this._gamepadButtonStateByIndex.clear();
    }

    _resolvePanelPolicy(panelConfig) {
        if (!panelConfig || typeof panelConfig !== 'object') return 'open';
        if (panelConfig.semanticId === 'developer') {
            return resolveDeveloperAccessPolicy(this.accessContext);
        }
        if (panelConfig.semanticId === 'debug') {
            return resolveDebugAccessPolicy(this.accessContext);
        }
        return panelConfig.accessPolicy || 'open';
    }
}
