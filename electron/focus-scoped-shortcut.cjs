'use strict';

// Electron-free focus-scoped accelerator helper for the desktop shell.
//
// Every side effect is injected so the state machine can be exercised in plain
// Node contract tests.

/**
 * @typedef {object} ShortcutRegistry
 * @property {(accelerator: string, handler: () => void) => boolean} register
 * @property {(accelerator: string) => void} unregister
 */

/**
 * @typedef {object} ShortcutFocusEvents
 * @property {(eventName: string, handler: () => void) => unknown} on
 * @property {(eventName: string, handler: () => void) => unknown} off
 */

/**
 * @typedef {object} FocusScopedShortcutOptions
 * @property {ShortcutRegistry} [globalShortcut] Electron's globalShortcut module.
 * @property {ShortcutFocusEvents} [appEvents] Emitter of browser-window-focus/-blur.
 * @property {string} [accelerator] Accelerator to hold while focused.
 * @property {() => void} [onTrigger] Runs when the accelerator fires.
 * @property {() => boolean} [isAnyWindowFocused] True while an app window has focus.
 * @property {{ warn?: (message: string) => void } | null} [logger]
 */

/**
 * @typedef {object} FocusScopedShortcut
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => boolean} isRegistered
 */

/**
 * Holds a system-wide accelerator only while one of the application windows has
 * focus, so the key stays usable in other programs while the game runs.
 *
 * @param {FocusScopedShortcutOptions} [options]
 * @returns {FocusScopedShortcut}
 */
function createFocusScopedShortcut({
    globalShortcut,
    appEvents,
    accelerator,
    onTrigger,
    isAnyWindowFocused = () => false,
    logger = console,
} = {}) {
    /** @type {boolean} */
    let registered = false;
    /** @type {boolean} */
    let started = false;

    function register() {
        if (registered) return true;
        globalShortcut.unregister(accelerator);
        registered = globalShortcut.register(accelerator, onTrigger) === true;
        if (!registered) {
            logger?.warn?.(`[tuning] Hotkey ${accelerator} konnte nicht registriert werden.`);
        }
        return registered;
    }

    function unregister() {
        if (!registered) return;
        registered = false;
        globalShortcut.unregister(accelerator);
    }

    const onFocus = () => {
        if (!started) return;
        register();
    };
    const onBlur = () => {
        unregister();
    };

    return Object.freeze({
        start() {
            if (started) return;
            started = true;
            appEvents.on('browser-window-focus', onFocus);
            appEvents.on('browser-window-blur', onBlur);
            if (isAnyWindowFocused()) register();
        },
        stop() {
            if (started) {
                started = false;
                appEvents.off('browser-window-focus', onFocus);
                appEvents.off('browser-window-blur', onBlur);
            }
            unregister();
        },
        isRegistered() {
            return registered;
        },
    });
}

module.exports = {
    createFocusScopedShortcut,
};
