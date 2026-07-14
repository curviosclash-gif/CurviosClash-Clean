import { resolveSurfaceDeveloperAccess } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';

// Dev-only diagnostic credential — not a security barrier, license check, or product feature.
// Changing or removing this does not affect product security; it only controls local dev-tool access.
// See docs/referenz/ai_architecture_context.md section 4.6.4.17 and V77 77.6.5.
const __PROCESS__ = typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).process ? /** @type {any} */ (globalThis).process : null;
// Default '1307' ist die dokumentierte Produktentscheidung (V27c) und wird von der
// Playwright-Suite gepinnt; im Browser existiert `process` nicht, dort greift immer der Default.
const EXPERT_PASSWORD = __PROCESS__?.env?.CURVIOS_EXPERT_PASSWORD || '1307';
// Symbol key for attaching the expert state to the settings object as an optional lookup bridge.
// The canonical expert state is owned by MenuExpertLoginRuntime and does not require this attachment.
const MENU_EXPERT_STATE_KEY = Symbol('menuExpertState');

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveExpertSurfaceAccess(runtimeGlobal = globalThis) {
    const globalRef = /** @type {typeof globalThis & { __APP_MODE__?: unknown }} */ (
        runtimeGlobal && typeof runtimeGlobal === 'object' ? runtimeGlobal : globalThis
    );
    const appMode = typeof globalRef.__APP_MODE__ === 'string'
        ? globalRef.__APP_MODE__.trim().toLowerCase()
        : 'web';
    return resolveSurfaceDeveloperAccess({
        runtimeGlobal: globalRef,
        appMode,
        platformRuntimeSnapshot: resolveElectronRuntimeSnapshot(globalRef),
    });
}

function setElementHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('hidden', !!hidden);
    element.setAttribute('aria-hidden', String(!!hidden));
    if (hidden) {
        element.setAttribute('tabindex', '-1');
        return;
    }
    element.removeAttribute('tabindex');
}

export function attachMenuExpertState(settings, state) {
    if (!settings || typeof settings !== 'object') return null;
    Object.defineProperty(settings, MENU_EXPERT_STATE_KEY, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: state,
    });
    return state;
}

export function resolveMenuExpertState(settings) {
    const state = settings && typeof settings === 'object'
        ? settings[MENU_EXPERT_STATE_KEY]
        : null;
    return state && typeof state === 'object' ? state : null;
}

export class MenuExpertLoginRuntime {
    constructor(options = {}) {
        this.settings = options.settings || null;
        this.ui = options.ui || null;
        this.showStatusToast = typeof options.showStatusToast === 'function'
            ? options.showStatusToast
            : (() => { });
        this.onStateChanged = typeof options.onStateChanged === 'function'
            ? options.onStateChanged
            : null;
        const expertSurfaceAccess = resolveExpertSurfaceAccess();
        this.state = {
            unlocked: false,
            error: '',
            lastAttemptAt: 0,
            available: expertSurfaceAccess.available === true,
            accessMode: String(expertSurfaceAccess.accessMode || ''),
            reason: String(expertSurfaceAccess.reason || ''),
            message: String(expertSurfaceAccess.message || ''),
            productSurfaceId: String(expertSurfaceAccess.productSurfaceId || ''),
        };
        attachMenuExpertState(this.settings, this.state);
    }

    bindUi(ui) {
        this.ui = ui || this.ui;
        this.syncUi();
    }

    isUnlocked() {
        return this.state.unlocked === true;
    }

    getState() {
        return {
            unlocked: this.isUnlocked(),
            error: String(this.state.error || ''),
            lastAttemptAt: Number(this.state.lastAttemptAt || 0),
            available: this.state.available === true,
            accessMode: String(this.state.accessMode || ''),
            reason: String(this.state.reason || ''),
            message: String(this.state.message || ''),
            productSurfaceId: String(this.state.productSurfaceId || ''),
        };
    }

    clearError() {
        if (!this.state.error) return;
        this.state.error = '';
        this.syncUi();
    }

    unlock(rawPassword = '') {
        if (this.state.available !== true) {
            this.state.unlocked = false;
            this.state.error = '';
            this.syncUi();
            return {
                success: false,
                reason: 'surface_policy_blocked',
                message: String(this.state.message || ''),
                state: this.getState(),
            };
        }
        const password = normalizeString(rawPassword);
        this.state.lastAttemptAt = Date.now();
        if (password !== EXPERT_PASSWORD) {
            this.state.unlocked = false;
            this.state.error = 'Passwort falsch.';
            this.syncUi();
            return {
                success: false,
                reason: 'invalid_password',
                message: String(this.state.error || ''),
                state: this.getState(),
            };
        }

        this.state.unlocked = true;
        this.state.error = '';
        if (this.ui?.expertPasswordInput) {
            this.ui.expertPasswordInput.value = '';
        }
        this.syncUi();
        this.showStatusToast('Lokaler Dev-Bereich freigeschaltet.', 1400, 'success');
        return {
            success: true,
            reason: 'unlocked',
            message: 'Lokaler Dev-Bereich freigeschaltet.',
            state: this.getState(),
        };
    }

    lock(options = {}) {
        const silent = options?.silent === true;
        const wasUnlocked = this.state.unlocked === true;
        this.state.unlocked = false;
        this.state.error = '';
        this.state.lastAttemptAt = Date.now();
        if (this.ui?.expertPasswordInput) {
            this.ui.expertPasswordInput.value = '';
        }
        this.syncUi();
        if (wasUnlocked && !silent) {
            this.showStatusToast('Lokaler Dev-Bereich gesperrt.', 1400, 'info');
        }
        return {
            success: true,
            reason: 'locked',
            message: 'Lokaler Dev-Bereich gesperrt.',
            state: this.getState(),
        };
    }

    focusPrimaryControl() {
        if (!this.ui) return;
        if (this.state.available !== true) {
            return;
        }
        if (this.isUnlocked()) {
            this.ui.openDeveloperButton?.focus?.();
            return;
        }
        this.ui.expertPasswordInput?.focus?.();
    }

    syncUi() {
        if (!this.ui) {
            this._notifyStateChanged();
            return;
        }

        const unlocked = this.isUnlocked();
        const available = this.state.available === true;
        const statusText = !available
            ? String(this.state.message || 'Developer- und Debugpfade sind fuer diese Surface nicht verfuegbar.')
            : (unlocked
                ? 'Lokaler Dev-/Diagnosebereich fuer diese Sitzung freigeschaltet.'
                : (this.state.error || String(this.state.message || 'Developer- und Debugfunktionen sind lokal gesperrt.')));

        if (this.ui.openExpertButton) {
            this.ui.openExpertButton.textContent = unlocked ? 'Expert offen' : 'Expert';
            this.ui.openExpertButton.setAttribute('aria-pressed', String(unlocked));
        }
        setElementHidden(this.ui.expertQuickLockButton, !available || !unlocked);
        setElementHidden(this.ui.expertLockedState, unlocked || !available);
        setElementHidden(this.ui.expertUnlockedState, !unlocked || !available);

        if (this.ui.expertStatus) {
            this.ui.expertStatus.textContent = statusText;
            this.ui.expertStatus.classList.toggle('is-error', available && !unlocked && !!this.state.error);
            this.ui.expertStatus.classList.toggle('is-success', unlocked);
            this.ui.expertStatus.classList.remove('hidden');
        }

        if (this.ui.expertPasswordInput) {
            this.ui.expertPasswordInput.disabled = !available;
            this.ui.expertPasswordInput.setAttribute('aria-invalid', String(available && !unlocked && !!this.state.error));
        }
        if (this.ui.expertUnlockButton) {
            this.ui.expertUnlockButton.disabled = !available;
        }
        if (this.ui.expertLockButton) {
            this.ui.expertLockButton.disabled = !available || !unlocked;
        }
        if (this.ui.openDeveloperButton) {
            this.ui.openDeveloperButton.disabled = !available || !unlocked;
        }
        if (this.ui.openDebugButton) {
            this.ui.openDebugButton.disabled = !available || !unlocked;
        }

        this._notifyStateChanged();
    }

    _notifyStateChanged() {
        this.onStateChanged?.(this.getState());
    }
}
