export function bindMenuMultiplayerActionButtons({
    ui,
    bind,
    emit,
    eventTypes,
    featureFlags,
}) {
    const clearFieldError = (field) => {
        field?.removeAttribute?.('aria-invalid');
        field?.classList?.remove?.('menu-field-error');
    };

    if (ui.multiplayerLobbyCodeInput) {
        bind(ui.multiplayerLobbyCodeInput, 'input', () => clearFieldError(ui.multiplayerLobbyCodeInput));
    }

    if (ui.multiplayerHostAddressInput) {
        bind(ui.multiplayerHostAddressInput, 'input', () => clearFieldError(ui.multiplayerHostAddressInput));
    }

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

    if (ui.multiplayerOpenLobbiesRefreshButton) {
        bind(ui.multiplayerOpenLobbiesRefreshButton, 'click', () => {
            emit(eventTypes.MULTIPLAYER_LOBBY_LIST_REFRESH);
        });
    }

    if (ui.multiplayerOpenLobbiesSelect) {
        bind(ui.multiplayerOpenLobbiesSelect, 'change', () => {
            const lobbyCode = String(ui.multiplayerOpenLobbiesSelect.value || '').trim();
            if (lobbyCode && ui.multiplayerLobbyCodeInput) {
                ui.multiplayerLobbyCodeInput.value = lobbyCode;
            }
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
