export function setupMenuControlBindings(ctx) {
    const ui = ctx.ui;
    const settings = ctx.settings;
    const emit = ctx.emit;
    const emitSettingsChangedImmediate = ctx.emitSettingsChangedImmediate;
    const eventTypes = ctx.eventTypes;
    const keys = ctx.settingsChangeKeys;
    const bind = ctx.bind;

    if (ui.mouseSteeringToggle) {
        bind(ui.mouseSteeringToggle, 'change', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.mouseSteering = ui.mouseSteeringToggle.checked === true;
            emitSettingsChangedImmediate([keys.LOCAL_MOUSE_STEERING]);
        });
    }

    if (ui.gamepadVibrationToggle) {
        bind(ui.gamepadVibrationToggle, 'change', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.gamepadVibration = ui.gamepadVibrationToggle.checked === true;
            emitSettingsChangedImmediate([keys.LOCAL_GAMEPAD_VIBRATION]);
        });
    }

    if (ui.smoothSteeringToggle) {
        bind(ui.smoothSteeringToggle, 'change', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.smoothSteering = ui.smoothSteeringToggle.checked === true;
            emitSettingsChangedImmediate([keys.LOCAL_SMOOTH_STEERING]);
        });
    }

    bind(ui.keybindP1, 'click', (e) => {
        const btn = e.target.closest('button.keybind-btn');
        if (!btn) return;
        emit(eventTypes.START_KEY_CAPTURE, {
            player: 'PLAYER_1',
            action: btn.dataset.action,
        });
    });

    bind(ui.keybindP2, 'click', (e) => {
        const btn = e.target.closest('button.keybind-btn');
        if (!btn) return;
        emit(eventTypes.START_KEY_CAPTURE, {
            player: 'PLAYER_2',
            action: btn.dataset.action,
        });
    });

    if (ui.keybindGlobal) {
        bind(ui.keybindGlobal, 'click', (e) => {
            const btn = e.target.closest('button.keybind-btn');
            if (!btn) return;
            emit(eventTypes.START_KEY_CAPTURE, {
                player: 'GLOBAL',
                action: btn.dataset.action,
            });
        });
    }

    bind(ui.resetKeysButton, 'click', () => {
        emit(eventTypes.RESET_KEYS);
    });

    bind(ui.saveKeysButton, 'click', () => {
        emit(eventTypes.SAVE_KEYS);
    });
}
