import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';
import { handleMultiplayerLobbyNameAction } from '../MultiplayerLobbyNameOps.js';

export function registerMultiplayerMenuEventHandlers(facade, registry) {
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_HOST, (event) => facade.handleMultiplayerHost(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_JOIN, (event) => facade.handleMultiplayerJoin(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_LOBBY_LIST_REFRESH, (event) => facade.handleMultiplayerLobbyListRefresh(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_LEAVE_LOBBY, (event) => facade.handleMultiplayerLeaveLobby(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_READY_TOGGLE, (event) => facade.handleMultiplayerReadyToggle(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_SET_LOBBY_NAME, (event) => handleMultiplayerLobbyNameAction({
        game: facade.game,
        event,
        menuMultiplayerBridge: facade.menuMultiplayerBridge,
        syncUiState: () => facade._syncMultiplayerUiState?.(),
    }));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_SETTINGS_RETRY, () => facade.menuMultiplayerBridge?.publishHostSettings?.(
        facade.settingsHandler.captureMultiplayerMatchSettings()
    ));
}
