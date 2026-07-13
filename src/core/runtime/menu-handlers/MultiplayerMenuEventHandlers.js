import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';

export function registerMultiplayerMenuEventHandlers(facade, registry) {
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_HOST, (event) => facade.handleMultiplayerHost(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_JOIN, (event) => facade.handleMultiplayerJoin(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_LEAVE_LOBBY, (event) => facade.handleMultiplayerLeaveLobby(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_READY_TOGGLE, (event) => facade.handleMultiplayerReadyToggle(event));
}
