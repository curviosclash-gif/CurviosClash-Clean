import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { createMenuEventHandlerRegistry } from '../src/core/runtime/menu-handlers/CreateMenuEventHandlerRegistry.js';
import { MENU_CONTROLLER_EVENT_TYPES } from '../src/shared/contracts/MenuControllerContract.js';
import { bindMenuMultiplayerActionButtons } from '../src/ui/menu/MenuMultiplayerActionBindings.js';

function createButton() {
    const handlers = new Map();
    return {
        handlers,
        addEventListener(type, handler) {
            handlers.set(type, handler);
        },
        click() {
            handlers.get('click')?.();
        },
        change() {
            handlers.get('change')?.();
        },
    };
}

test('LAN multiplayer join button forwards lobbyCode plus optional manual signalingUrl', () => {
    const emitted = [];
    const joinButton = createButton();
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerJoinButton: joinButton,
            multiplayerLobbyCodeInput: { value: 'LAN-QA' },
            multiplayerHostAddressInput: { value: 'localhost:9090' },
        },
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        eventTypes: {
            MULTIPLAYER_JOIN: 'multiplayer_join',
        },
        featureFlags: {},
    });

    joinButton.click();

    assert.deepEqual(emitted, [{
        eventType: 'multiplayer_join',
        payload: {
            lobbyCode: 'LAN-QA',
            signalingUrl: 'localhost:9090',
        },
    }]);
});

test('online lobby browser refreshes and copies the selected lobby code', () => {
    const emitted = [];
    const refreshButton = createButton();
    const lobbySelect = { ...createButton(), value: '' };
    const lobbyCodeInput = { value: '' };
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerOpenLobbiesRefreshButton: refreshButton,
            multiplayerOpenLobbiesSelect: lobbySelect,
            multiplayerLobbyCodeInput: lobbyCodeInput,
        },
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        eventTypes: {
            MULTIPLAYER_LOBBY_LIST_REFRESH: 'multiplayer_lobby_list_refresh',
        },
        featureFlags: {},
    });

    refreshButton.click();
    lobbySelect.value = 'ABCD1234';
    lobbySelect.change();

    assert.deepEqual(emitted, [{
        eventType: 'multiplayer_lobby_list_refresh',
        payload: undefined,
    }]);
    assert.equal(lobbyCodeInput.value, 'ABCD1234');
});

test('multiplayer leave event delegates through the runtime facade', () => {
    const event = { type: MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_LEAVE_LOBBY };
    const facade = Object.create(GameRuntimeFacade.prototype);
    facade.menuActionHandler = {
        handleMultiplayerLeaveLobby(receivedEvent) {
            assert.equal(receivedEvent, event);
            return 'left';
        },
    };

    const registry = createMenuEventHandlerRegistry(facade);

    assert.equal(registry.get(event.type)(event), 'left');
});

test('multiplayer lobby list event delegates through the runtime facade', () => {
    const event = { type: MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_LOBBY_LIST_REFRESH };
    const facade = Object.create(GameRuntimeFacade.prototype);
    facade.menuActionHandler = {
        handleMultiplayerLobbyListRefresh(receivedEvent) {
            assert.equal(receivedEvent, event);
            return 'listed';
        },
    };

    const registry = createMenuEventHandlerRegistry(facade);

    assert.equal(registry.get(event.type)(event), 'listed');
});
