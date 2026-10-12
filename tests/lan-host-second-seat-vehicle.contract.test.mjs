import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { normalizeLobbyMember } from '../src/network/MatchLobbySessionState.js';
import { buildSessionState } from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';
import { resolveRuntimeNetworkPlayerSlots } from '../src/core/runtime/RuntimeNetworkPlayerSlots.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { syncLocalLobbyVehicle } from '../src/core/runtime/NetworkVehicleSelectionOps.js';

// A LAN host with two players at one screen: the host announces its own ship and the ship of
// its second seat; a guest joins with a third ship.
function createLobbyState({ secondVehicleId } = {}) {
    return {
        hostPeerId: 'host',
        localPlayerCount: 2,
        members: [
            { peerId: 'host', isHost: true, name: 'Host', vehicleId: 'arrow', secondVehicleId, joinedAt: 1 },
            { peerId: 'peer-b', name: 'Gast', vehicleId: 'manta', joinedAt: 5 },
        ],
    };
}

/** Mirrors applyRuntimeNetworkPlayerSlotContext: the seats one machine builds its match from. */
function buildMachineVehicles({ lobbyState, isHost, localPeerId, pickByLocalSeat }) {
    const slots = resolveRuntimeNetworkPlayerSlots({
        lobbyState,
        session: { isHost, localPlayerId: localPeerId, getPlayers: () => [] },
    });
    const localSlots = slots.filter((slot) => slot.isLocal);
    const vehicles = { PLAYER_1: pickByLocalSeat[0], PLAYER_2: pickByLocalSeat[1] || pickByLocalSeat[0] };
    return buildHumanConfigs({ vehicles }, {
        player: { vehicles },
        session: {
            networkEnabled: true,
            numHumans: localSlots.length,
            localHumanCount: localSlots.length,
            humanEntityCount: slots.length,
            localPlayerIndex: localSlots[0].playerIndex,
            networkPlayerSlots: slots,
        },
    }).map((config) => config.vehicleId);
}

test('the second seat at the LAN host flies its own announced ship on every machine', () => {
    const lobbyState = createLobbyState({ secondVehicleId: 'drone' });
    const host = buildMachineVehicles({ lobbyState, isHost: true, localPeerId: 'host', pickByLocalSeat: ['arrow', 'drone'] });
    const guest = buildMachineVehicles({ lobbyState, isHost: false, localPeerId: 'peer-b', pickByLocalSeat: ['manta'] });
    assert.deepEqual(host, ['arrow', 'drone', 'manta'], 'player 2 at the host flies the drone it picked, not the host ship');
    assert.deepEqual(guest, host, 'the guest builds the same ship for every seat');
});

test('an unannounced second seat never borrows the host ship', () => {
    const slots = resolveRuntimeNetworkPlayerSlots({
        lobbyState: createLobbyState(),
        session: { isHost: true, localPlayerId: 'host', getPlayers: () => [] },
    });
    const secondSeat = slots.find((slot) => slot.peerId === 'host::local-2');
    assert.equal(secondSeat.vehicleId, '', 'without an announcement the seat stays open, as before the lobby carried ships');
});

test('a lobby member keeps the announced ship of its second seat', () => {
    assert.equal(normalizeLobbyMember({ peerId: 'host', secondVehicleId: 'drone' }).secondVehicleId, 'drone');
    assert.equal(normalizeLobbyMember({ peerId: 'host' }).secondVehicleId, '');
    assert.equal(normalizeLobbyMember({ peerId: 'host', secondVehicleId: '../ship5' }).secondVehicleId, '');
});

test('LAN: the guest learns the ship of the second seat at the host', async () => {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    const guest = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = guest._startPolling = () => {};
    try {
        await host.create({ actorId: 'profile-host', name: 'Host', vehicleId: 'arrow', localPlayerCount: 2 });
        await guest.join({ signalingUrl: url, lobbyCode: host.lobbyCode, actorId: 'profile-guest', name: 'Gast', vehicleId: 'manta' });
        await host.setVehicle('arrow', { secondVehicleId: 'drone' });
        guest._processServerStatus(await guest._pollStatusOnce());
        const hostMember = buildSessionState(guest.sessionState, { localPeerId: guest.getLocalPeerId() })
            .members.find((member) => member.isHost);
        assert.equal(hostMember.vehicleId, 'arrow');
        assert.equal(hostMember.secondVehicleId, 'drone');

        await host.setVehicle('orb');
        guest._processServerStatus(await guest._pollStatusOnce());
        const unchanged = buildSessionState(guest.sessionState, { localPeerId: guest.getLocalPeerId() })
            .members.find((member) => member.isHost);
        assert.equal(unchanged.secondVehicleId, 'drone', 'a change of the host ship alone keeps the second seat');
    } finally {
        guest.dispose(); host.dispose();
        await closeLanTestServer(server);
    }
});

function createHostBridge(lobbyMember) {
    const calls = [];
    return {
        calls,
        getSessionState: () => ({
            joined: true,
            localPlayerCount: 2,
            members: [{ peerId: 'host', isHost: true, isLocal: true, ...lobbyMember }],
        }),
        setLobbyVehicle(vehicleId, options) {
            calls.push([vehicleId, options?.secondVehicleId]);
            return Promise.resolve({ ok: true });
        },
    };
}

test('a host with two seats announces both ships and stays quiet once the lobby knows them', () => {
    const settings = { vehicles: { PLAYER_1: 'arrow', PLAYER_2: 'drone' } };
    const unknown = createHostBridge({ vehicleId: 'arrow' });
    syncLocalLobbyVehicle({ settings, menuMultiplayerBridge: unknown });
    assert.deepEqual(unknown.calls, [['arrow', 'drone']]);

    const known = createHostBridge({ vehicleId: 'arrow', secondVehicleId: 'drone' });
    syncLocalLobbyVehicle({ settings, menuMultiplayerBridge: known });
    assert.deepEqual(known.calls, []);
});
