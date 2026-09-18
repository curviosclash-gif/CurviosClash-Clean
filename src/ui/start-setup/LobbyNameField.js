// The own lobby name: typed into one field below the member list, never into the
// member rows, because those rows are rebuilt on every lobby update.
export function syncLobbyNameField(ui, state, joined) {
    const row = ui?.lobbyNameRow;
    const input = ui?.lobbyNameInput;
    row?.classList?.toggle('hidden', !joined);
    if (!joined || !input) return;
    const localMember = (state?.members || []).find((member) => member?.isLocal === true) || null;
    const chosenName = String(localMember?.lobbyName || '');
    input.placeholder = chosenName ? '' : String(localMember?.name || '');
    const doc = input.ownerDocument;
    if (doc?.activeElement !== input && input.value !== chosenName) input.value = chosenName;
    if (ui.lobbyNameDefaultButton) ui.lobbyNameDefaultButton.disabled = !chosenName;
}

export function bindLobbyNameField(ui, bind, emit, eventTypes) {
    if (ui?.lobbyNameInput) {
        bind(ui.lobbyNameInput, 'change', () => emit(eventTypes.MULTIPLAYER_SET_LOBBY_NAME, {
            lobbyName: ui.lobbyNameInput.value,
        }));
    }
    if (ui?.lobbyNameDefaultButton) {
        bind(ui.lobbyNameDefaultButton, 'click', () => {
            if (ui.lobbyNameInput) ui.lobbyNameInput.value = '';
            emit(eventTypes.MULTIPLAYER_SET_LOBBY_NAME, { lobbyName: '' });
        });
    }
}
