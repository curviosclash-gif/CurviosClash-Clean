import assert from 'node:assert/strict';
import test from 'node:test';

import {
    handleMultiplayerJoinAction,
    handleMultiplayerLobbyListRefreshAction,
} from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { LOBBY_SERVICE_TRANSPORTS } from '../src/shared/contracts/LobbyServiceContract.js';
import { MULTIPLAYER_TRANSPORTS } from '../src/shared/contracts/RuntimeSessionContract.js';

test('LAN join uses player profile identity while access actor remains separate', async () => {
    const calls = [];
    const hostAddressInput = {
        attributes: new Map(),
        classNames: new Set(),
        focused: false,
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        },
        classList: {
            add(value) {
                hostAddressInput.classNames.add(value);
            },
            remove(value) {
                hostAddressInput.classNames.delete(value);
            },
        },
        focus() {
            this.focused = true;
        },
    };
    const game = {
        playerProfileManager: {
            getActiveProfile: () => ({ id: '00000000-0000-4000-8000-000000000099', displayName: 'Gunda' }),
        },
        settings: {
            localSettings: {
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
            },
        },
        ui: {
            multiplayerStatus: { textContent: '' },
            multiplayerHostAddressInput: hostAddressInput,
        },
        _showStatusToast(message, duration, tone) {
            calls.push(['toast', message, duration, tone]);
        },
    };
    const menuMultiplayerBridge = {
        transport: LOBBY_SERVICE_TRANSPORTS.LAN,
        join(options) {
            calls.push(['join', options]);
            return {
                ok: false,
                code: 'manual_signaling_url_invalid',
                message: 'Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.',
            };
        },
    };

    const result = await handleMultiplayerJoinAction({
        game,
        event: {
            lobbyCode: 'LAN-QA',
            signalingUrl: 'localhost:9090',
        },
        resolveMenuAccessContext: () => ({ actorId: 'Client' }),
        menuMultiplayerBridge,
        syncUiState: () => calls.push(['sync']),
        runtimeSource: null,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(calls[0], ['join', {
        actorId: '00000000-0000-4000-8000-000000000099',
        lobbyCode: 'LAN-QA',
        lobbyName: '',
        name: 'Gunda',
        signalingUrl: 'localhost:9090',
    }]);
    assert.equal(game.ui.multiplayerStatus.textContent, 'Join fehlgeschlagen: Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.');
    assert.equal(hostAddressInput.attributes.get('aria-invalid'), 'true');
    assert.equal(hostAddressInput.classNames.has('menu-field-error'), true);
    assert.equal(hostAddressInput.focused, true);
    assert.deepEqual(calls[1], ['toast', 'Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.', 1800, 'error']);
    assert.equal(calls.some(([type]) => type === 'sync'), false);
});

test('join action exposes a busy state and restores controls after connecting', async () => {
    let resolveJoin = null;
    const joinPromise = new Promise((resolve) => {
        resolveJoin = resolve;
    });
    const hostButton = { disabled: false };
    const joinButton = { disabled: false };
    const panelAttributes = new Map();
    const game = {
        settings: {
            localSettings: {
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
            },
        },
        ui: {
            multiplayerHostButton: hostButton,
            multiplayerJoinButton: joinButton,
            multiplayerStatus: { textContent: '' },
            multiplayerLobbyCodeInput: {
                value: 'LAN-QA',
                removeAttribute() {},
                classList: { remove() {} },
            },
            multiplayerInlineState: {
                setAttribute(name, value) {
                    panelAttributes.set(name, String(value));
                },
                removeAttribute(name) {
                    panelAttributes.delete(name);
                },
            },
        },
    };
    let syncCount = 0;
    const actionPromise = handleMultiplayerJoinAction({
        game,
        event: {
            lobbyCode: 'LAN-QA',
            signalingUrl: '',
        },
        resolveMenuAccessContext: () => ({ actorId: 'Client' }),
        menuMultiplayerBridge: {
            transport: LOBBY_SERVICE_TRANSPORTS.LAN,
            join: () => joinPromise,
        },
        syncUiState: () => {
            syncCount += 1;
        },
        runtimeSource: null,
    });

    assert.equal(hostButton.disabled, true);
    assert.equal(joinButton.disabled, true);
    assert.equal(panelAttributes.get('aria-busy'), 'true');
    assert.equal(game.ui.multiplayerStatus.textContent, 'Lobby wird gesucht …');

    resolveJoin({ ok: true, lobbyCode: 'LAN-QA' });
    const result = await actionPromise;

    assert.equal(result.ok, true);
    assert.equal(hostButton.disabled, false);
    assert.equal(joinButton.disabled, false);
    assert.equal(panelAttributes.has('aria-busy'), false);
    assert.equal(syncCount, 1);
});

test('online lobby list action renders joinable lobby options and status', async () => {
    const select = {
        ownerDocument: {
            createElement: () => ({ value: '', textContent: '', dataset: {} }),
        },
        options: [],
        value: '',
        disabled: false,
        replaceChildren(...options) {
            this.options = options;
        },
    };
    const refreshButton = { disabled: false };
    const game = {
        settings: {
            localSettings: {
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.ONLINE,
            },
        },
        ui: {
            multiplayerOpenLobbiesSelect: select,
            multiplayerOpenLobbiesRefreshButton: refreshButton,
            multiplayerStatus: { textContent: '' },
        },
    };
    const lobbies = [{
        lobbyCode: 'ABCD1234',
        memberCount: 1,
        maxPlayers: 4,
        createdAt: 1,
        updatedAt: 2,
        hostName: 'Captain',
        modePath: 'fight',
        mapKey: 'maze',
        signalingUrl: 'ws://lobby.example',
    }];

    const result = await handleMultiplayerLobbyListRefreshAction({
        game,
        menuMultiplayerBridge: {
            listOpenLobbies: async () => lobbies,
        },
    });

    assert.deepEqual(result, { ok: true, lobbies });
    assert.equal(select.options.length, 2);
    assert.equal(select.options[1].value, 'ABCD1234');
    assert.equal(select.options[1].textContent, 'ABCD1234 · 1/4 Spieler · Captain · fight · maze');
    assert.equal(select.options[1].dataset.signalingUrl, 'ws://lobby.example');
    assert.equal(select.disabled, false);
    assert.equal(refreshButton.disabled, false);
    assert.equal(game.ui.multiplayerStatus.textContent, '1 offene Online-Lobby gefunden.');
});

test('LAN lobby list action uses the same discovery UI', async () => {
    const select = {
        ownerDocument: { createElement: () => ({ value: '', textContent: '', dataset: {} }) },
        options: [],
        value: '',
        disabled: false,
        replaceChildren(...options) { this.options = options; },
    };
    const game = {
        settings: { localSettings: { multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN } },
        ui: {
            multiplayerOpenLobbiesSelect: select,
            multiplayerOpenLobbiesRefreshButton: { disabled: false },
            multiplayerStatus: { textContent: '' },
        },
    };
    const lobbies = [{
        lobbyCode: 'LAN-QA', memberCount: 2, maxPlayers: 10, hostName: 'Wohnzimmer',
    }];

    const result = await handleMultiplayerLobbyListRefreshAction({
        game,
        menuMultiplayerBridge: { listOpenLobbies: async () => lobbies },
    });

    assert.equal(result.ok, true);
    assert.equal(select.options[1].value, 'LAN-QA');
    assert.equal(game.ui.multiplayerStatus.textContent, '1 offene LAN-Lobby gefunden.');
});
