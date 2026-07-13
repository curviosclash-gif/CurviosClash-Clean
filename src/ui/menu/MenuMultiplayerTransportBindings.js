export function bindMenuMultiplayerTransportButtons({
    ui,
    settings,
    bind,
    emit,
    emitSettingsChangedImmediate,
    eventTypes,
    keys,
}) {
    if (!Array.isArray(ui?.multiplayerTransportButtons)) {
        return;
    }

    ui.multiplayerTransportButtons.forEach((button) => {
        bind(button, 'click', () => {
            if (button.disabled) return;
            const requestedTransport = String(button?.dataset?.multiplayerTransport || '').trim().toLowerCase();
            if (!requestedTransport) return;
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.sessionType = 'multiplayer';
            if (settings.localSettings.multiplayerTransport === requestedTransport) {
                return;
            }
            settings.localSettings.multiplayerTransport = requestedTransport;
            emitSettingsChangedImmediate([
                keys.MULTIPLAYER_TRANSPORT,
                keys.MULTIPLAYER_STATUS,
            ]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: requestedTransport === 'online'
                    ? 'Multiplayer-Transport: Online'
                    : 'Multiplayer-Transport: LAN',
                duration: 1000,
                tone: 'info',
            });
        });
    });
}
