import { normalizeOptionalMultiplayerPlayerName } from '../../shared/contracts/MultiplayerSessionContract.js';
import { LOBBY_NAME_STORAGE_KEY } from '../../shared/contracts/LobbyNameStorageContract.js';

// The lobby name lives in the active player profile, so every profile keeps its own.
function resolveProfileStore(game) {
    return game?.playerProfileManager?.getActiveRecordStorePort?.() || null;
}

export function loadRememberedLobbyName(game) {
    const record = resolveProfileStore(game)?.loadJsonRecord?.(LOBBY_NAME_STORAGE_KEY, null);
    return normalizeOptionalMultiplayerPlayerName(record?.lobbyName);
}

export function rememberLobbyName(game, lobbyName) {
    const normalized = normalizeOptionalMultiplayerPlayerName(lobbyName);
    resolveProfileStore(game)?.saveJsonRecord?.(LOBBY_NAME_STORAGE_KEY, { lobbyName: normalized });
    return normalized;
}

export async function handleMultiplayerLobbyNameAction({ game, event, menuMultiplayerBridge, syncUiState }) {
    const lobbyName = rememberLobbyName(game, event?.lobbyName);
    let result = null;
    try {
        result = await Promise.resolve(menuMultiplayerBridge?.setLobbyName?.(lobbyName))
            || { ok: false, message: 'Name kann hier nicht geändert werden.' };
    } catch (error) {
        result = { ok: false, message: error instanceof Error ? error.message : 'Name konnte nicht gesetzt werden.' };
    }
    if (!result?.ok) {
        game?._showStatusToast?.(result?.message || 'Name konnte nicht gesetzt werden.', 1700, 'error');
        return result;
    }
    syncUiState?.();
    return result;
}
