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

function createFakeElement(doc, tag = 'div') {
    const listeners = new Map();
    const element = {
        tagName: tag.toUpperCase(), ownerDocument: doc, children: [], dataset: {}, attributes: new Map(),
        className: '', textContent: '', tabIndex: -1, disabled: false,
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        fire(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, target: this, ...event }); },
        focus() { doc.activeElement = this; },
        contains(node) { return node === this || this.children.some((child) => child === node || child.contains?.(node)); },
        querySelectorAll(selector) {
            const role = /\[role="(\w+)"\]/.exec(selector)?.[1];
            return this.children.filter((child) => child.getAttribute?.('role') === role);
        },
    };
    return element;
}

test('the open lobby table fills the code on a click and joins on Enter', () => {
    const emitted = [];
    const doc = { activeElement: null };
    doc.createElement = (tag) => createFakeElement(doc, tag);
    const table = createFakeElement(doc);
    const refreshButton = createButton();
    const lobbyCodeInput = { ...createButton(), value: '' };
    const hostAddressInput = { ...createButton(), value: '' };
    const ui = {
        multiplayerOpenLobbiesRefreshButton: refreshButton,
        multiplayerOpenLobbiesTable: table,
        multiplayerLobbySearchInput: { ...createButton(), value: '' },
        multiplayerLobbyCodeInput: lobbyCodeInput,
        multiplayerHostAddressInput: hostAddressInput,
    };
    bindMenuMultiplayerActionButtons({
        ui,
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        eventTypes: {
            MULTIPLAYER_LOBBY_LIST_REFRESH: 'multiplayer_lobby_list_refresh',
            MULTIPLAYER_JOIN: 'multiplayer_join',
        },
        featureFlags: {},
    });
    try {
        refreshButton.click();
        ui.openLobbyTable.update([{ lobbyCode: 'ABCD1234', hostName: 'Blitz', memberCount: 1, maxPlayers: 10, signalingUrl: 'http://192.168.1.8:9090' }]);
        const row = table.children.find((child) => child.getAttribute('role') === 'option');
        row.fire('click');
        assert.equal(lobbyCodeInput.value, 'ABCD1234');
        assert.equal(hostAddressInput.value, 'http://192.168.1.8:9090');
        table.fire('keydown', { key: 'Enter' });
        assert.deepEqual(emitted, [
            { eventType: 'multiplayer_lobby_list_refresh', payload: undefined },
            { eventType: 'multiplayer_join', payload: { lobbyCode: 'ABCD1234', signalingUrl: 'http://192.168.1.8:9090' } },
        ]);
    } finally {
        ui.stopOpenLobbyAutoRefresh();
    }
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
