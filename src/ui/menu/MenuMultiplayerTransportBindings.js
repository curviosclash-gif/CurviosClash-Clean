export function bindMenuMultiplayerTransportButtons({
    ui,
    settings,
    bind,
    emit,
    emitSettingsChangedImmediate,
    eventTypes,
    keys,
}) {
    if (ui?.multiplayerHostLocalPlayerCount) {
        bind(ui.multiplayerHostLocalPlayerCount, 'change', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.lanHostLocalPlayerCount = ui.multiplayerHostLocalPlayerCount.value === '2' ? 2 : 1;
            emitSettingsChangedImmediate([keys.LAN_HOST_LOCAL_PLAYER_COUNT]);
        });
    }

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
                emit(eventTypes.MULTIPLAYER_LOBBY_LIST_REFRESH);
                return;
            }
            settings.localSettings.multiplayerTransport = requestedTransport;
            emitSettingsChangedImmediate([
                keys.MULTIPLAYER_TRANSPORT,
                keys.MULTIPLAYER_STATUS,
            ]);
            emit(eventTypes.MULTIPLAYER_LOBBY_LIST_REFRESH);
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
