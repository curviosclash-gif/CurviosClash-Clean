import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { buildSessionState } from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';
import { SIGNALING_HTTP_ROUTES } from '../src/shared/contracts/SignalingSessionContract.js';
import {
    PLAYER_PROFILE_RECORD_KINDS,
    getPlayerProfileRecordDefinitionByKind,
} from '../src/shared/contracts/PlayerProfileStorageContract.js';

const namesOf = (lobby) => buildSessionState(lobby.sessionState, { localPeerId: lobby.getLocalPeerId() })
    .members.map((member) => member.name);

async function withLobbies(run) {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    const guest = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = guest._startPolling = () => {};
    try {
        // actorId is the internal profile id, name the profile display name.
        await host.create({ actorId: 'profile-host', name: 'Spieler 1' });
        await guest.join({ signalingUrl: url, lobbyCode: host.lobbyCode, actorId: 'profile-guest', name: 'Spieler 1' });
        await run({ url, host, guest });
    } finally {
        guest.dispose(); host.dispose();
        await new Promise((resolve) => server.close(resolve));
    }
}

test('without a chosen name each player shows the profile name plus the seat', async () => {
    await withLobbies(async ({ host, guest }) => {
        host._processServerStatus(await host._pollStatusOnce());
        assert.deepEqual(namesOf(host), ['Spieler 1 1', 'Spieler 1 2']);
        assert.deepEqual(namesOf(guest), ['Spieler 1 1', 'Spieler 1 2']);
    });
});

test('a guest renames itself and the host sees the new name', async () => {
    await withLobbies(async ({ host, guest }) => {
        await guest.setLobbyName('  Blitz  ');
        host._processServerStatus(await host._pollStatusOnce());
        assert.deepEqual(namesOf(host), ['Spieler 1 1', 'Blitz']);
        await host.setLobbyName('x'.repeat(30));
        guest._processServerStatus(await guest._pollStatusOnce());
        assert.deepEqual(namesOf(guest), ['x'.repeat(16), 'Blitz']);
        await guest.setLobbyName('   ');
        assert.deepEqual(namesOf(guest), ['x'.repeat(16), 'Spieler 1 2'], 'an empty name falls back to the default');
    });
});

test('nobody can rename another player', async () => {
    await withLobbies(async ({ url, host, guest }) => {
        const response = await fetch(`${url}${SIGNALING_HTTP_ROUTES.LOBBY_NAME}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: 'host', lobbyName: 'Gekapert', hostToken: guest._localPeerToken }),
        });
        assert.equal(response.status, 403);
        host._processServerStatus(await host._pollStatusOnce());
        assert.equal(namesOf(host)[0], 'Spieler 1 1');
    });
});

test('each player profile remembers its own lobby name', () => {
    const entry = getPlayerProfileRecordDefinitionByKind(PLAYER_PROFILE_RECORD_KINDS.LOBBY_NAME);
    assert.ok(entry, 'lobby name is a player profile record');
    assert.match(entry.suffix, /lobby-name/);
});
