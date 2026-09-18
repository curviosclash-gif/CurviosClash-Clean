import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { NetworkLobbyService } from '../src/application/session-runtime/NetworkLobbyService.js';
import { MENU_CONTROLLER_EVENT_TYPES } from '../src/shared/contracts/MenuControllerContract.js';
import { LOBBY_NAME_STORAGE_KEY } from '../src/shared/contracts/PlayerProfileStorageContract.js';
import {
    handleMultiplayerLobbyNameAction,
    loadRememberedLobbyName,
} from '../src/core/runtime/MultiplayerLobbyNameOps.js';
import { registerMultiplayerMenuEventHandlers } from '../src/core/runtime/menu-handlers/MultiplayerMenuEventHandlers.js';
import { bindLobbyNameField, syncLobbyNameField } from '../src/ui/start-setup/LobbyNameField.js';

function createNetworkService(url) {
    return new NetworkLobbyService({
        runtime: { global: {} },
        discoveryPort: null,
        resolveHostSignalingUrl: () => url,
        resolveJoinSignalingUrl: () => url,
        createLobby: (signalingUrl) => {
            const lobby = new LANMatchLobby({ signalingUrl });
            lobby._startPolling = () => {};
            return lobby;
        },
    });
}

function createProfileGame() {
    const records = new Map();
    return {
        records,
        toasts: [],
        _showStatusToast(message) { this.toasts.push(message); },
        playerProfileManager: {
            getActiveRecordStorePort: () => ({
                loadJsonRecord: (key, fallback) => (records.has(key) ? records.get(key) : fallback),
                saveJsonRecord: (key, value) => { records.set(key, value); return { success: true }; },
            }),
        },
    };
}

test('the lobby service carries the remembered name into the lobby and renames later', async () => {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = createNetworkService(url);
    const guest = createNetworkService(url);
    try {
        const hosted = await host.host({ actorId: 'profile-host', name: 'Spieler 1', lobbyName: 'Kapitän' });
        assert.equal(hosted.ok, true);
        const joined = await guest.join({ actorId: 'profile-guest', name: 'Spieler 1', lobbyCode: hosted.lobbyCode });
        assert.equal(joined.ok, true);
        assert.deepEqual(guest.getSessionState().members.map((member) => member.name), ['Kapitän', 'Spieler 1 2']);

        const renamed = await guest.setLobbyName('Blitz');
        assert.equal(renamed.ok, true);
        const local = renamed.sessionState.members.find((member) => member.isLocal);
        assert.equal(local.name, 'Blitz');
        assert.equal(local.lobbyName, 'Blitz');
    } finally {
        guest.leave(); host.leave();
        await closeLanTestServer(server);
    }
});

test('the menu event remembers the name in the active profile and forwards it', async () => {
    const game = createProfileGame();
    const calls = [];
    const registry = new Map();
    let synced = 0;
    registerMultiplayerMenuEventHandlers({
        game,
        menuMultiplayerBridge: { setLobbyName: async (name) => { calls.push(name); return { ok: true }; } },
        _syncMultiplayerUiState: () => { synced += 1; },
    }, registry);
    const handler = registry.get(MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_SET_LOBBY_NAME);
    assert.equal(typeof handler, 'function');
    await handler({ lobbyName: '  Nova  ' });
    assert.deepEqual(calls, ['Nova']);
    assert.equal(synced, 1);
    assert.deepEqual(game.records.get(LOBBY_NAME_STORAGE_KEY), { lobbyName: 'Nova' });
    assert.equal(loadRememberedLobbyName(game), 'Nova');
});

test('a lobby without rename support shows a message instead of failing silently', async () => {
    const game = createProfileGame();
    const result = await handleMultiplayerLobbyNameAction({ game, event: { lobbyName: 'Nova' }, menuMultiplayerBridge: {} });
    assert.equal(result.ok, false);
    assert.equal(game.toasts.length, 1);
});

function fakeElement(doc) {
    const classes = new Set(['hidden']);
    const listeners = {};
    return {
        ownerDocument: doc,
        value: '',
        placeholder: '',
        disabled: false,
        classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        fire: (type) => listeners[type]?.(),
    };
}

test('the own name field shows the chosen name, the default as hint, and keeps typing intact', () => {
    const doc = { activeElement: null };
    const ui = { lobbyNameRow: fakeElement(doc), lobbyNameInput: fakeElement(doc), lobbyNameDefaultButton: fakeElement(doc) };
    const state = { members: [{ isLocal: true, name: 'Spieler 1 2', lobbyName: '' }] };
    syncLobbyNameField(ui, state, true);
    assert.equal(ui.lobbyNameRow.classList.contains('hidden'), false);
    assert.equal(ui.lobbyNameInput.placeholder, 'Spieler 1 2');
    assert.equal(ui.lobbyNameDefaultButton.disabled, true);

    doc.activeElement = ui.lobbyNameInput;
    ui.lobbyNameInput.value = 'Bli';
    syncLobbyNameField(ui, { members: [{ isLocal: true, name: 'Blitz', lobbyName: 'Blitz' }] }, true);
    assert.equal(ui.lobbyNameInput.value, 'Bli', 'a lobby update must not overwrite what the player is typing');

    const emitted = [];
    bindLobbyNameField(ui, (el, type, fn) => el.addEventListener(type, fn), (type, payload) => emitted.push([type, payload]), MENU_CONTROLLER_EVENT_TYPES);
    ui.lobbyNameInput.value = 'Blitz';
    ui.lobbyNameInput.fire('change');
    ui.lobbyNameDefaultButton.fire('click');
    assert.deepEqual(emitted, [
        [MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_SET_LOBBY_NAME, { lobbyName: 'Blitz' }],
        [MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_SET_LOBBY_NAME, { lobbyName: '' }],
    ]);
    assert.equal(ui.lobbyNameInput.value, '');

    syncLobbyNameField(ui, state, false);
    assert.equal(ui.lobbyNameRow.classList.contains('hidden'), true);
});
