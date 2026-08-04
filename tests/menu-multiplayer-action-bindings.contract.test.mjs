import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { createMenuEventHandlerRegistry } from '../src/core/runtime/menu-handlers/CreateMenuEventHandlerRegistry.js';
import { MENU_CONTROLLER_EVENT_TYPES } from '../src/shared/contracts/MenuControllerContract.js';
import { bindMenuMultiplayerActionButtons } from '../src/ui/menu/MenuMultiplayerActionBindings.js';
import { bindMenuMultiplayerTransportButtons } from '../src/ui/menu/MenuMultiplayerTransportBindings.js';

function createButton() {
    const handlers = new Map();
    return {
        handlers,
        addEventListener(type, handler) {
            handlers.set(type, handler);
        },
        click() {
            return handlers.get('click')?.();
        },
        change() {
            handlers.get('change')?.();
        },
        input() {
            handlers.get('input')?.();
        },
    };
}

test('LAN multiplayer join button forwards lobbyCode plus optional manual signalingUrl', () => {
    const emitted = [];
    const joinButton = createButton();
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerJoinButton: joinButton,
            multiplayerLobbyCodeInput: { ...createButton(), value: 'LAN-QA' },
            multiplayerHostAddressInput: { ...createButton(), value: 'localhost:9090' },
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
    const lobbySelect = {
        ...createButton(),
        value: '',
        selectedOptions: [{ dataset: { signalingUrl: 'http://192.168.1.8:9090' } }],
    };
    const lobbyCodeInput = { ...createButton(), value: '' };
    const hostAddressInput = { ...createButton(), value: '' };
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerOpenLobbiesRefreshButton: refreshButton,
            multiplayerOpenLobbiesSelect: lobbySelect,
            multiplayerLobbyCodeInput: lobbyCodeInput,
            multiplayerHostAddressInput: hostAddressInput,
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
    assert.equal(hostAddressInput.value, 'http://192.168.1.8:9090');
});

test('lobby share buttons copy code and LAN address with feedback', async () => {
    const emitted = [];
    const copied = [];
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: async (value) => copied.push(value) } },
    });
    try {
        const copyCodeButton = createButton();
        const copyAddressButton = createButton();
        bindMenuMultiplayerActionButtons({
            ui: {
                multiplayerCopyCodeButton: copyCodeButton,
                multiplayerShareCode: { textContent: 'ABCD1234' },
                multiplayerCopyAddressButton: copyAddressButton,
                multiplayerShareAddress: { textContent: '192.168.1.8:9090' },
            },
            bind: (el, event, handler) => el.addEventListener(event, handler),
            emit: (eventType, payload) => emitted.push({ eventType, payload }),
            eventTypes: { SHOW_STATUS_TOAST: 'show_status_toast' },
            featureFlags: {},
        });

        await copyCodeButton.click();
        await copyAddressButton.click();
        assert.deepEqual(copied, ['ABCD1234', '192.168.1.8:9090']);
        assert.deepEqual(emitted.map((event) => event.payload.message), [
            'Lobby-Code kopiert.',
            'LAN-Adresse kopiert.',
        ]);
    } finally {
        if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
        else delete globalThis.navigator;
    }
});

test('lobby start button delegates to the shared match-start event', () => {
    const emitted = [];
    const startButton = createButton();
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerStartMatchButton: startButton,
        },
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        eventTypes: {
            START_MATCH: 'start_match',
        },
        featureFlags: {
            canHost: true,
        },
    });

    startButton.click();

    assert.deepEqual(emitted, [{
        eventType: 'start_match',
        payload: undefined,
    }]);
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

test('transport selection refreshes the matching lobby directory automatically', () => {
    const emitted = [];
    const onlineButton = { ...createButton(), disabled: false, dataset: { multiplayerTransport: 'online' } };
    const settings = { localSettings: { multiplayerTransport: 'lan' } };
    bindMenuMultiplayerTransportButtons({
        ui: { multiplayerTransportButtons: [onlineButton] },
        settings,
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        emitSettingsChangedImmediate: () => {},
        eventTypes: {
            MULTIPLAYER_LOBBY_LIST_REFRESH: 'multiplayer_lobby_list_refresh',
            SHOW_STATUS_TOAST: 'show_status_toast',
        },
        keys: { MULTIPLAYER_TRANSPORT: 'transport', MULTIPLAYER_STATUS: 'status' },
    });

    onlineButton.click();
    assert.equal(settings.localSettings.multiplayerTransport, 'online');
    assert.equal(emitted[0].eventType, 'multiplayer_lobby_list_refresh');
});
