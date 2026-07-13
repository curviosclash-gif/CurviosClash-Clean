export function bindMenuMultiplayerActionButtons({
    ui,
    bind,
    emit,
    eventTypes,
    featureFlags,
}) {
    if (ui.multiplayerHostButton) {
        bind(ui.multiplayerHostButton, 'click', () => {
            const canHost = featureFlags?.canHost === true;
            if (!canHost) return;
            emit(eventTypes.MULTIPLAYER_HOST, {
                lobbyCode: String(ui.multiplayerLobbyCodeInput?.value || '').trim(),
            });
        });
    }

    if (ui.multiplayerJoinButton) {
        bind(ui.multiplayerJoinButton, 'click', () => {
            emit(eventTypes.MULTIPLAYER_JOIN, {
                lobbyCode: String(ui.multiplayerLobbyCodeInput?.value || '').trim(),
                signalingUrl: String(ui.multiplayerHostAddressInput?.value || '').trim(),
            });
        });
    }

    if (ui.multiplayerLeaveLobbyButton) {
        bind(ui.multiplayerLeaveLobbyButton, 'click', () => {
            emit(eventTypes.MULTIPLAYER_LEAVE_LOBBY);
        });
    }

    if (ui.multiplayerReadyToggle) {
        bind(ui.multiplayerReadyToggle, 'change', () => {
            emit(eventTypes.MULTIPLAYER_READY_TOGGLE, {
                ready: ui.multiplayerReadyToggle.checked === true,
            });
        });
    }

    if (ui.multiplayerStartMatchButton) {
        bind(ui.multiplayerStartMatchButton, 'click', () => {
            const canHost = featureFlags?.canHost === true;
            if (!canHost) return;
            emit(eventTypes.START_MATCH);
        });
    }
}
