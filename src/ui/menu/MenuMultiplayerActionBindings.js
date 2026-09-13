export function bindMenuMultiplayerActionButtons({
    ui,
    bind,
    emit,
    eventTypes,
    featureFlags,
}) {
    const connectionControls = ui.multiplayerConnectionControls;
    const intentButtons = Array.from(connectionControls?.querySelectorAll?.('[data-connection-intent-target]') || []);
    const setConnectionIntent = (intent) => {
        const resolved = intent === 'host' && featureFlags?.canHost === true ? 'host' : 'join';
        if (!connectionControls) return;
        connectionControls.dataset.connectionIntent = resolved;
        intentButtons.forEach((button) => {
            const active = button.dataset.connectionIntentTarget === resolved;
            button.setAttribute('aria-pressed', String(active));
            button.classList.toggle('active', active);
            if (button.dataset.connectionIntentTarget === 'host') {
                button.classList.toggle('hidden', featureFlags?.canHost !== true);
            }
        });
        if (ui.multiplayerLobbyCodeInput) {
            ui.multiplayerLobbyCodeInput.placeholder = resolved === 'host'
                ? 'Optional: eigenen Code vergeben' : 'Code eingeben, z. B. TEST-1234';
        }
    };
    intentButtons.forEach((button) => bind(button, 'click', () => setConnectionIntent(button.dataset.connectionIntentTarget)));
    setConnectionIntent('join');

    const copyValue = async (value, label) => {
        const text = String(value || '').trim();
        if (!text) return;
        try {
            const clipboard = globalThis.navigator?.clipboard;
            if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard_unavailable');
            await clipboard.writeText(text);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `${label} kopiert.`,
                duration: 1200,
                tone: 'success',
            });
        } catch {
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `${label} konnte nicht kopiert werden.`,
                duration: 1600,
                tone: 'error',
            });
        }
    };
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
            const selectedOption = ui.multiplayerOpenLobbiesSelect.selectedOptions?.[0];
            const signalingUrl = String(selectedOption?.dataset?.signalingUrl || '').trim();
            if (signalingUrl && ui.multiplayerHostAddressInput) {
                ui.multiplayerHostAddressInput.value = signalingUrl;
            }
        });
    }

    if (ui.multiplayerCopyCodeButton) {
        bind(ui.multiplayerCopyCodeButton, 'click', () => copyValue(
            ui.multiplayerShareCode?.textContent,
            'Lobby-Code'
        ));
    }

    if (ui.multiplayerCopyAddressButton) {
        bind(ui.multiplayerCopyAddressButton, 'click', () => copyValue(
            ui.multiplayerShareAddress?.textContent,
            'LAN-Adresse'
        ));
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
