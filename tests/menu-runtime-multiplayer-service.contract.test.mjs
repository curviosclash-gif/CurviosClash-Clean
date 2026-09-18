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
    assert.equal(game.ui.multiplayerStatus.textContent, 'Beitritt fehlgeschlagen: Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.');
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

function fakeLobbyTable() {
    return { updates: [], update(lobbies) { this.updates.push(lobbies); } };
}

test('online lobby list action hands the found lobbies to the lobby table and reports the count', async () => {
    const table = fakeLobbyTable();
    const refreshButton = { disabled: false };
    const game = {
        settings: {
            localSettings: {
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.ONLINE,
            },
        },
        ui: {
            openLobbyTable: table,
            multiplayerOpenLobbiesRefreshButton: refreshButton,
            multiplayerStatus: { textContent: '' },
        },
    };
    const lobbies = [{
        lobbyCode: 'ABCD1234',
        memberCount: 1,
        maxPlayers: 4,
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
    assert.deepEqual(table.updates, [lobbies]);
    assert.equal(refreshButton.disabled, false);
    assert.equal(game.ui.multiplayerStatus.textContent, '1 offene Online-Lobby gefunden.');
});

test('LAN lobby list action uses the same discovery UI, and a background refresh stays silent', async () => {
    const table = fakeLobbyTable();
    const game = {
        settings: { localSettings: { multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN } },
        ui: {
            openLobbyTable: table,
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
    assert.equal(table.updates[0][0].lobbyCode, 'LAN-QA');
    assert.equal(game.ui.multiplayerStatus.textContent, '1 offene LAN-Lobby gefunden.');

    game.ui.multiplayerStatus.textContent = 'unverändert';
    let release = null;
    const slowBridge = { listOpenLobbies: () => new Promise((resolve) => { release = () => resolve(lobbies); }) };
    const first = handleMultiplayerLobbyListRefreshAction({ game, event: { auto: true }, menuMultiplayerBridge: slowBridge });
    const overlapping = await handleMultiplayerLobbyListRefreshAction({ game, event: { auto: true }, menuMultiplayerBridge: slowBridge });
    assert.equal(overlapping, null, 'a second background search waits for the running one');
    release();
    assert.equal((await first).ok, true);
    assert.equal(table.updates.length, 2);
    assert.equal(game.ui.multiplayerStatus.textContent, 'unverändert');
});