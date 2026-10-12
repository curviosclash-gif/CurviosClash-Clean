import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { createSignalingServer } from '../server/signaling-server.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';
import { normalizeLobbyMember } from '../src/network/MatchLobbySessionState.js';
import { buildSessionState } from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';
import {
    LOBBY_VEHICLE_ID_MAX_LENGTH,
    normalizeLobbyVehicleId,
} from '../src/shared/contracts/LobbyVehicleContract.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    SIGNALING_HTTP_ROUTES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';
import { resolveRuntimeNetworkPlayerSlots } from '../src/core/runtime/RuntimeNetworkPlayerSlots.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { applyMultiplayerMatchSettingsSnapshot } from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { syncRuntimeMultiplayerContext } from '../src/core/runtime/RuntimeMultiplayerFlowService.js';
import { resolveAnnouncedNetworkVehicleId } from '../src/core/runtime/NetworkVehicleSelectionOps.js';
import {
    clearArcadeLabShipRegistry,
    registerArcadeLabShips,
} from '../src/shared/contracts/ArcadeLabRegistryContract.js';

// ---- Contract ----

test('a lobby vehicle id keeps only a plain, bounded id and never throws', () => {
    assert.equal(normalizeLobbyVehicleId('  manta '), 'manta');
    assert.equal(normalizeLobbyVehicleId('lab_helix_interceptor'), 'lab_helix_interceptor');
    for (const garbage of [undefined, null, 42, {}, [], '', '   ', '<script>', 'a b', '../ship5']) {
        assert.equal(normalizeLobbyVehicleId(garbage), '', `${JSON.stringify(garbage)} is not a vehicle id`);
    }
    assert.equal(normalizeLobbyVehicleId('x'.repeat(LOBBY_VEHICLE_ID_MAX_LENGTH)).length, LOBBY_VEHICLE_ID_MAX_LENGTH);
    assert.equal(normalizeLobbyVehicleId('x'.repeat(LOBBY_VEHICLE_ID_MAX_LENGTH + 1)), '', 'an over-long id is dropped, not cut');
});

test('a lobby member keeps its announced vehicle and an old member without one stays empty', () => {
    assert.equal(normalizeLobbyMember({ peerId: 'peer-b', vehicleId: 'drone' }).vehicleId, 'drone');
    assert.equal(normalizeLobbyMember({ peerId: 'peer-b' }).vehicleId, '');
    assert.equal(normalizeLobbyMember({ peerId: 'peer-b', vehicleId: { parts: [] } }).vehicleId, '', 'no build plan travels');
});

// ---- LAN signaling ----

const vehiclesOf = (lobby) => buildSessionState(lobby.sessionState, { localPeerId: lobby.getLocalPeerId() })
    .members.map((member) => member.vehicleId);

async function withLanLobbies(run) {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    const guest = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = guest._startPolling = () => {};
    try {
        await host.create({ actorId: 'profile-host', name: 'Host', vehicleId: 'arrow' });
        await guest.join({ signalingUrl: url, lobbyCode: host.lobbyCode, actorId: 'profile-guest', name: 'Gast', vehicleId: 'manta' });
        await run({ url, host, guest });
    } finally {
        guest.dispose(); host.dispose();
        await closeLanTestServer(server);
    }
}

test('LAN: the host learns the vehicle the guest joined with and every later change', async () => {
    await withLanLobbies(async ({ host, guest }) => {
        host._processServerStatus(await host._pollStatusOnce());
        assert.deepEqual(vehiclesOf(host), ['arrow', 'manta'], 'host and guest each keep their own ship');
        assert.deepEqual(vehiclesOf(guest), ['arrow', 'manta']);

        await guest.setVehicle('drone');
        host._processServerStatus(await host._pollStatusOnce());
        assert.deepEqual(vehiclesOf(host), ['arrow', 'drone'], 'a changed pick reaches the host');

        await guest.setVehicle('not a vehicle');
        assert.deepEqual(vehiclesOf(guest), ['arrow', ''], 'the server drops an invalid id');
    });
});

test('LAN: nobody can change another player\'s vehicle', async () => {
    await withLanLobbies(async ({ url, host, guest }) => {
        const response = await fetch(`${url}${SIGNALING_HTTP_ROUTES.LOBBY_VEHICLE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: 'host', vehicleId: 'orb', hostToken: guest._localPeerToken }),
        });
        assert.equal(response.status, 403);
        host._processServerStatus(await host._pollStatusOnce());
        assert.equal(vehiclesOf(host)[0], 'arrow');
    });
});

test('LAN: an older client that sends no vehicle still joins', async () => {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    const guest = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = guest._startPolling = () => {};
    try {
        await host.create({ actorId: 'profile-host', name: 'Host' });
        await guest.join({ signalingUrl: url, lobbyCode: host.lobbyCode, actorId: 'profile-guest', name: 'Gast' });
        host._processServerStatus(await host._pollStatusOnce());
        assert.deepEqual(vehiclesOf(host), ['', '']);
    } finally {
        guest.dispose(); host.dispose();
        await closeLanTestServer(server);
    }
});

// ---- Online signaling ----

async function startOnlineServer() {
    const wss = createSignalingServer(0);
    if (!wss.address()) await once(wss, 'listening');
    return { wss, url: `ws://127.0.0.1:${wss.address().port}` };
}

async function stopOnlineServer(wss) {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
}

async function openClient(url) {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    await once(socket, 'open');
    return socket;
}

function nextMessage(socket, type) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off('message', onMessage);
            reject(new Error(`Timed out waiting for ${type}`));
        }, 2_000);
        function onMessage(raw) {
            const message = JSON.parse(raw.toString());
            if (message.type !== type) return;
            clearTimeout(timer);
            socket.off('message', onMessage);
            resolve(message);
        }
        socket.on('message', onMessage);
    });
}

function send(socket, type, payload) {
    socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
}

const onlineVehiclesOf = (message) => message.sessionState.members.map((member) => member.vehicleId);

test('Online: create and join carry each vehicle, and a change reaches every member', async () => {
    const { wss, url } = await startOnlineServer();
    try {
        const host = await openClient(url);
        const created = nextMessage(host, SIGNALING_EVENT_TYPES.LOBBY_CREATED);
        send(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2, actorId: 'Host', vehicleId: 'arrow' });
        const { lobbyCode } = await created;

        const guest = await openClient(url);
        const hostSeesJoin = nextMessage(host, SIGNALING_EVENT_TYPES.PLAYER_JOINED);
        const joined = nextMessage(guest, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
        send(guest, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode, actorId: 'Gast', vehicleId: 'manta' });
        assert.deepEqual(onlineVehiclesOf(await joined), ['arrow', 'manta']);
        assert.deepEqual(onlineVehiclesOf(await hostSeesJoin), ['arrow', 'manta']);

        const hostSeesChange = nextMessage(host, SIGNALING_EVENT_TYPES.PLAYER_VEHICLE_CHANGED);
        const guestAck = nextMessage(guest, SIGNALING_EVENT_TYPES.PLAYER_VEHICLE_CHANGED);
        send(guest, SIGNALING_COMMAND_TYPES.SET_VEHICLE, { vehicleId: 'drone' });
        assert.deepEqual(onlineVehiclesOf(await hostSeesChange), ['arrow', 'drone']);
        assert.equal((await guestAck).vehicleId, 'drone');

        const invalid = nextMessage(host, SIGNALING_EVENT_TYPES.PLAYER_VEHICLE_CHANGED);
        send(guest, SIGNALING_COMMAND_TYPES.SET_VEHICLE, { vehicleId: 'y'.repeat(500) });
        assert.deepEqual(onlineVehiclesOf(await invalid), ['arrow', ''], 'the server drops an over-long id');
    } finally {
        await stopOnlineServer(wss);
    }
});

test('Online: an older client that sends no vehicle still joins', async () => {
    const { wss, url } = await startOnlineServer();
    try {
        const host = await openClient(url);
        const created = nextMessage(host, SIGNALING_EVENT_TYPES.LOBBY_CREATED);
        send(host, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 2, actorId: 'Host' });
        assert.deepEqual(onlineVehiclesOf(await created), ['']);
    } finally {
        await stopOnlineServer(wss);
    }
});

test('Online: the lobby client announces its ship and the host lobby sees it', async () => {
    const previousSocket = globalThis.WebSocket;
    globalThis.WebSocket = WebSocket;
    const { wss, url } = await startOnlineServer();
    const host = new OnlineMatchLobby({ signalingUrl: url });
    const guest = new OnlineMatchLobby({ signalingUrl: url });
    try {
        await host.create({ vehicleId: 'arrow' });
        await guest.join(host.lobbyCode, { name: 'Gast', vehicleId: 'manta', maxConnectAttempts: 1, connectTimeoutMs: 2000 });
        await guest.setVehicle('drone');
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(host.sessionState.members.map((member) => member.vehicleId), ['arrow', 'drone']);
    } finally {
        guest.dispose(); host.dispose();
        await stopOnlineServer(wss);
        globalThis.WebSocket = previousSocket;
    }
});

// ---- Slots and match setup ----

const LOBBY_STATE = Object.freeze({
    hostPeerId: 'host',
    members: [
        { peerId: 'host', isHost: true, name: 'Host', vehicleId: 'arrow', joinedAt: 1 },
        { peerId: 'peer-b', name: 'Gast', vehicleId: 'manta', joinedAt: 5 },
    ],
});

/** Mirrors applyRuntimeNetworkPlayerSlotContext: the runtime config one machine builds its match from. */
function createMachineRuntimeConfig({ isHost, localPeerId, ownVehicleId }) {
    const slots = resolveRuntimeNetworkPlayerSlots({
        lobbyState: LOBBY_STATE,
        session: { isHost, localPlayerId: localPeerId, getPlayers: () => [] },
    });
    const localSlots = slots.filter((slot) => slot.isLocal);
    return {
        settings: { vehicles: { PLAYER_1: ownVehicleId, PLAYER_2: ownVehicleId } },
        runtimeConfig: {
            player: { vehicles: { PLAYER_1: ownVehicleId, PLAYER_2: ownVehicleId } },
            session: {
                networkEnabled: true,
                numHumans: localSlots.length,
                localHumanCount: localSlots.length,
                humanEntityCount: slots.length,
                localPlayerIndex: localSlots[0].playerIndex,
                networkPlayerSlots: slots,
            },
        },
    };
}

test('host and guest build the same ship for every seat, each its own pick', () => {
    const host = createMachineRuntimeConfig({ isHost: true, localPeerId: 'host', ownVehicleId: 'arrow' });
    const guest = createMachineRuntimeConfig({ isHost: false, localPeerId: 'peer-b', ownVehicleId: 'manta' });
    const hostVehicles = buildHumanConfigs(host.settings, host.runtimeConfig).map((config) => config.vehicleId);
    const guestVehicles = buildHumanConfigs(guest.settings, guest.runtimeConfig).map((config) => config.vehicleId);
    assert.deepEqual(hostVehicles, ['arrow', 'manta'], 'the guest does not fly ship5 on the host');
    assert.deepEqual(guestVehicles, ['arrow', 'manta'], 'the guest sees the host in the host ship');
});

test('a seat with an id this build does not ship flies the default ship on every machine', () => {
    const slots = resolveRuntimeNetworkPlayerSlots({
        lobbyState: {
            hostPeerId: 'host',
            members: [
                { peerId: 'host', isHost: true, vehicleId: 'my_private_build' },
                { peerId: 'peer-b', joinedAt: 5 },
            ],
        },
        session: { isHost: true, localPlayerId: 'host', getPlayers: () => [] },
    });
    assert.deepEqual(slots.map((slot) => slot.vehicleId), ['ship5', ''], 'unknown becomes ship5, unannounced stays empty');
});

test('an own hangar build is announced as its factory base ship, never as the build itself', () => {
    registerArcadeLabShips([{
        id: 'arcade_lab_1',
        label: 'Eigenbau',
        role: 'balanced',
        config: { baseVehicleId: 'manta', baseMeshMode: 'reference', parts: [] },
    }]);
    try {
        assert.equal(resolveAnnouncedNetworkVehicleId('arcade_lab_1'), 'manta');
        assert.equal(resolveAnnouncedNetworkVehicleId('arcade_lab_9'), 'ship5', 'a build without a known base flies ship5');
        assert.equal(resolveAnnouncedNetworkVehicleId('drone'), 'drone');
        assert.equal(resolveAnnouncedNetworkVehicleId(undefined), 'ship5');
    } finally {
        clearArcadeLabShipRegistry();
    }
});

// ---- Host snapshot and the guest's own pick ----

test('the host match snapshot does not overwrite the guest vehicle', () => {
    const guestSettings = { vehicles: { PLAYER_1: 'manta', PLAYER_2: 'drone' }, localSettings: {} };
    applyMultiplayerMatchSettingsSnapshot(guestSettings, {
        mapKey: 'maze',
        vehicles: { PLAYER_1: 'arrow', PLAYER_2: 'arrow' },
        localSettings: { sessionType: 'multiplayer', multiplayerTransport: 'lan', modePath: 'normal' },
    });
    assert.equal(guestSettings.mapKey, 'maze', 'the match settings still apply');
    assert.deepEqual(guestSettings.vehicles, { PLAYER_1: 'manta', PLAYER_2: 'drone' });
});

test('the authoritative snapshot leaves the guest hangar vehicle selection alone', () => {
    const game = {
        settings: {
            mapKey: 'standard',
            vehicles: { PLAYER_1: 'manta', PLAYER_2: 'manta' },
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'lan',
                modePath: 'normal',
                startSetup: { modeSelections: { normal: { mapKey: 'standard', vehicles: { PLAYER_1: 'manta', PLAYER_2: 'manta' } } } },
            },
        },
        settingsManager: { applyMenuCompatibilityRules: () => ({ changedKeys: [] }) },
        uiManager: { syncAll() {}, updateContext() {} },
        ui: {},
    };
    const handler = new GameRuntimeSettingsHandler({ facade: { game, _resolveMenuAccessContext: () => ({ isOwner: false }) } });
    handler.applyAuthoritativeMultiplayerMatchSettings({
        mapKey: 'maze',
        vehicles: { PLAYER_1: 'arrow', PLAYER_2: 'arrow' },
        localSettings: { sessionType: 'multiplayer', multiplayerTransport: 'lan', modePath: 'normal' },
    });
    assert.deepEqual(game.settings.localSettings.startSetup.modeSelections.normal.vehicles, { PLAYER_1: 'manta', PLAYER_2: 'manta' });
    assert.equal(game.settings.vehicles.PLAYER_1, 'manta');
});

// ---- Announcing a change ----

function createBridge(localVehicleId) {
    const calls = [];
    return {
        calls,
        getSessionState: () => ({
            joined: true,
            members: [
                { peerId: 'host', isHost: true, vehicleId: 'arrow' },
                { peerId: 'peer-b', isLocal: true, vehicleId: localVehicleId },
            ],
        }),
        setLobbyVehicle(vehicleId) {
            calls.push(vehicleId);
            return Promise.resolve({ ok: true });
        },
    };
}

function syncWith(bridge, vehicleId) {
    return syncRuntimeMultiplayerContext({
        game: { settings: { vehicles: { PLAYER_1: vehicleId }, localSettings: { sessionType: 'multiplayer', multiplayerTransport: 'lan' } } },
        changedKeys: [],
        menuMultiplayerBridge: bridge,
        resolveMenuAccessContext: () => ({ isOwner: false }),
        captureSettingsSnapshot: () => ({}),
        syncUiState: () => {},
    });
}

test('a guest announces a changed vehicle to its lobby and stays quiet otherwise', () => {
    const changed = createBridge('manta');
    syncWith(changed, 'drone');
    assert.deepEqual(changed.calls, ['drone']);

    const unchanged = createBridge('manta');
    syncWith(unchanged, 'manta');
    assert.deepEqual(unchanged.calls, [], 'no request when the lobby already knows the pick');
});
