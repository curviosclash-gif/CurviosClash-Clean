import { SETTINGS_CHANGE_KEYS, normalizeSettingsChangeKeys } from './SettingsChangeKeys.js';
import { addChangedKeys, changedKeySetToArray } from './SettingsChangeSetOps.js';
import { setupMenuGameplayBindings } from './menu/MenuGameplayBindings.js';
import { setupMenuProfileBindings } from './menu/MenuProfileBindings.js';
import { setupMenuControlBindings } from './menu/MenuControlBindings.js';
import { setupMenuDevPanelBindings } from './menu/MenuDevPanelBindings.js';
import { resolveRuntimeMenuFeatureFlags } from './menu/MenuRuntimeFeatureFlags.js';
import {
    MENU_CONTROLLER_EVENT_CONTRACT_VERSION,
    MENU_CONTROLLER_EVENT_TYPES,
} from '../shared/contracts/MenuControllerContract.js';

export {
    MENU_CONTROLLER_EVENT_CONTRACT_VERSION,
    MENU_CONTROLLER_EVENT_TYPES,
} from '../shared/contracts/MenuControllerContract.js';

export class MenuController {
    /**
     * @param {Object} options
     * @param {Object} options.ui Elements from the DOM
     * @param {Object} options.settings Current runtime settings
     * @param {Function} options.onEvent Event sink for emitted menu events
     */
    constructor(options) {
        this.ui = options.ui;
        this.game = options.game || null;
        this.settings = options.settings;
        this.runtimeAccess = options.runtimeAccess && typeof options.runtimeAccess === 'object'
            ? options.runtimeAccess
            : null;
        this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this._queuedInputChangeKeys = new Set();
        this._queuedInputFlushHandle = null;
        this._queuedInputFlushUsesAnimationFrame = false;
        this._disposers = [];
    }

    _bind(target, type, handler, options) {
        if (!target?.addEventListener || typeof handler !== 'function') return;
        target.addEventListener(type, handler, options);
        this._disposers.push(() => target.removeEventListener(type, handler, options));
    }

    _emit(type, payload = {}) {
        if (type !== MENU_CONTROLLER_EVENT_TYPES.SETTINGS_CHANGED) {
            this._flushQueuedInputSettingsChangedNow();
        }
        if (!this.onEvent) return;
        this.onEvent({ contractVersion: MENU_CONTROLLER_EVENT_CONTRACT_VERSION, type, ...payload });
    }

    _emitSettingsChanged(changedKeys) {
        const normalizedChangedKeys = normalizeSettingsChangeKeys(changedKeys);
        if (normalizedChangedKeys.length > 0) {
            this._emit(MENU_CONTROLLER_EVENT_TYPES.SETTINGS_CHANGED, { changedKeys: normalizedChangedKeys });
            return;
        }
        this._emit(MENU_CONTROLLER_EVENT_TYPES.SETTINGS_CHANGED);
    }

    _emitSettingsChangedImmediate(changedKeys) {
        this._flushQueuedInputSettingsChangedNow();
        this._emitSettingsChanged(changedKeys);
    }

    _queueInputSettingsChanged(changedKeys) {
        const normalizedChangedKeys = normalizeSettingsChangeKeys(changedKeys);
        if (normalizedChangedKeys.length === 0) return;

        // Keep first input response immediate; merge only follow-up input bursts in the same frame.
        if (this._queuedInputFlushHandle === null) {
            this._emitSettingsChanged(normalizedChangedKeys);
            this._scheduleQueuedInputSettingsChangedFlush();
            return;
        }

        addChangedKeys(this._queuedInputChangeKeys, normalizedChangedKeys);
    }

    _scheduleQueuedInputSettingsChangedFlush() {
        if (this._queuedInputFlushHandle !== null) return;

        const flush = () => {
            this._queuedInputFlushHandle = null;
            this._queuedInputFlushUsesAnimationFrame = false;
            this._flushQueuedInputSettingsChanged();
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            this._queuedInputFlushUsesAnimationFrame = true;
            this._queuedInputFlushHandle = window.requestAnimationFrame(flush);
            return;
        }

        this._queuedInputFlushHandle = setTimeout(flush, 0);
    }

    _flushQueuedInputSettingsChangedNow() {
        if (this._queuedInputFlushHandle !== null) {
            this._cancelQueuedInputSettingsChangedFlush();
            this._queuedInputFlushHandle = null;
            this._queuedInputFlushUsesAnimationFrame = false;
        }
        this._flushQueuedInputSettingsChanged();
    }

    _flushQueuedInputSettingsChanged() {
        const changedKeys = changedKeySetToArray(this._queuedInputChangeKeys);
        if (changedKeys.length === 0) return;
        this._queuedInputChangeKeys.clear();
        this._emitSettingsChanged(changedKeys);
    }

    _cancelQueuedInputSettingsChangedFlush() {
        if (this._queuedInputFlushHandle === null) return;
        if (this._queuedInputFlushUsesAnimationFrame && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this._queuedInputFlushHandle);
            return;
        }
        clearTimeout(this._queuedInputFlushHandle);
    }

    setupListeners() {
        this.dispose();
        const bindingContext = {
            ui: this.ui,
            game: this.game,
            configSource: this.game?.config || null,
            settings: this.settings,
            featureFlags: resolveRuntimeMenuFeatureFlags(this.settings?.menuFeatureFlags),
            runtimeAccess: this.runtimeAccess,
            eventTypes: MENU_CONTROLLER_EVENT_TYPES,
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
            emit: (type, payload) => this._emit(type, payload),
            emitSettingsChangedImmediate: (changedKeys) => this._emitSettingsChangedImmediate(changedKeys),
            queueInputSettingsChanged: (changedKeys) => this._queueInputSettingsChanged(changedKeys),
            bind: (target, type, handler, options) => this._bind(target, type, handler, options),
        };

        setupMenuGameplayBindings(bindingContext);
        setupMenuProfileBindings(bindingContext);
        setupMenuControlBindings(bindingContext);
        setupMenuDevPanelBindings(bindingContext);
    }

    dispose() {
        this._cancelQueuedInputSettingsChangedFlush();
        this._queuedInputFlushHandle = null;
        this._queuedInputFlushUsesAnimationFrame = false;
        this._queuedInputChangeKeys.clear();
        while (this._disposers.length > 0) {
            const dispose = this._disposers.pop();
            try {
                dispose?.();
            } catch {
                // Keep teardown robust even if one UI binding is already detached.
            }
        }
    }
}
