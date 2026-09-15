'use strict';

// Electron-free focus-scoped accelerator helper for the desktop shell.
//
// Every side effect is injected so the state machine can be exercised in plain
// Node contract tests.

/**
 * Holds a system-wide accelerator only while one of the application windows has
 * focus, so the key stays usable in other programs while the game runs.
 */
function createFocusScopedShortcut({
    globalShortcut,
    appEvents,
    accelerator,
    onTrigger,
    isAnyWindowFocused = () => false,
    logger = console,
} = {}) {
    let registered = false;
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
