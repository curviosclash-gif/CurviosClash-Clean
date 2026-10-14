import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createLANSignalingServer } from '../server/lan-signaling.js';
import { LANSessionAdapter } from '../src/network/LANSessionAdapter.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';

async function post(baseUrl, route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.ok, true);
    return response.json();
}

test('each runtime attach re-arms the authenticated LAN member before waiting for its host offer', async () => {
    const lan = createLANSignalingServer(0, { ghostCleanupIntervalMs: 0 });
    await once(lan.server, 'listening');
    const baseUrl = `http://127.0.0.1:${lan.server.address().port}`;
    const adapters = [];
    try {
        const { lobbyCode, hostToken } = await post(baseUrl, '/lobby/create', { maxPlayers: 3 });
        const { playerId, playerToken } = await post(baseUrl, '/lobby/join', {
            lobbyCode, actorId: 'same-profile', lobbyName: 'Falke', vehicleId: 'ship5',
        });
        await post(baseUrl, '/lobby/ready', { playerId, playerToken, ready: true });
        const status = async () => (await fetch(`${baseUrl}/lobby/status?playerId=host&token=${encodeURIComponent(hostToken)}`)).json();
        for (let round = 0; round < 2; round += 1) {
            await post(baseUrl, '/lobby/ack-pending', { playerId, hostToken });
            assert.deepEqual((await status()).pendingPlayers, []);
            const adapter = new LANSessionAdapter({ isHost: false, signalingUrl: baseUrl, playerId, peerToken: playerToken });
            adapters.push(adapter);
            let attached = false;
            adapter._attachExistingClient = async (id) => {
                assert.equal(id, playerId);
                const state = await status();
                assert.deepEqual(state.pendingPlayers.map((entry) => entry.playerId), [playerId]);
                const member = state.sessionState.players.find((entry) => entry.playerId === playerId);
                assert.equal(member.ready, true);
                assert.equal(member.actorId, 'same-profile');
                assert.equal(member.lobbyName, 'Falke');
                assert.equal(member.vehicleId, 'ship5');
                attached = true;
            };
            await adapter.connect();
            assert.equal(attached, true);
            assert.equal((await status()).sessionState.players.length, 1, 'reattach keeps exactly the original guest');
            adapter.dispose();
            adapters.pop();
        }
        const invalid = new LANSessionAdapter({ isHost: false, signalingUrl: baseUrl, playerId, peerToken: 'invalid' });
        adapters.push(invalid);
        invalid._attachExistingClient = async () => assert.fail('invalid credentials must not begin a handshake');
        await assert.rejects(invalid.connect(), /LAN reconnect rejected \(403\)/);
    } finally {
        for (const adapter of adapters) adapter.dispose();
        await closeLanTestServer(lan.server);
    }
});
