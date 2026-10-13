import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';

test('cancelled LAN join removes late server member', async () => {
    const bundle = createLANSignalingServer(0, { ghostCleanupIntervalMs: 0 });
    await once(bundle.server, 'listening');
    const signalingUrl = `http://127.0.0.1:${bundle.server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl });
    host._startPolling = () => {};
    const guest = new LANMatchLobby({ signalingUrl });
    const originalFetch = globalThis.fetch;
    let releaseJoinResponse;
    let resolveJoinStarted;
    let resolveLeaveCompleted;
    const joinStarted = new Promise((resolve) => { resolveJoinStarted = resolve; });
    const leaveCompleted = new Promise((resolve) => { resolveLeaveCompleted = resolve; });
    const joinResponseGate = new Promise((resolve) => { releaseJoinResponse = resolve; });
    let joinPayload = null;
    let leavePayload = null;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/lobby/join')) {
            const response = await originalFetch(input, init);
            joinPayload = await response.json();
            resolveJoinStarted();
            await joinResponseGate;
            return { ok: response.ok, status: response.status, json: async () => joinPayload };
        }
        if (url.endsWith('/lobby/leave')) {
            leavePayload = JSON.parse(init.body);
            const response = await originalFetch(input, init);
            resolveLeaveCompleted(await response.json());
            return { ok: response.ok, status: response.status, json: async () => leavePayload };
        }
        return originalFetch(input, init);
    };

    try {
        await host.create({ maxPlayers: 3, actorId: 'Host' });
        const pendingJoin = guest.join({ signalingUrl, lobbyCode: host.lobbyCode, actorId: 'Guest' });
        await joinStarted;
        guest.leave();
        releaseJoinResponse();

        await assert.rejects(pendingJoin, (error) => error?.code === 'join_cancelled');
        await leaveCompleted;
        assert.deepEqual(leavePayload, {
            playerId: joinPayload.playerId,
            playerToken: joinPayload.playerToken,
        });
        assert.equal(guest._localPeerId, '');
        assert.equal(guest._localPeerToken, '');
        assert.equal(guest._pollingTimer, null);
        const status = await host._pollStatusOnce();
        assert.equal(status.players.some((player) => player.playerId === joinPayload.playerId), false);
    } finally {
        globalThis.fetch = originalFetch;
        guest.dispose();
        host.dispose();
        await closeLanTestServer(bundle.server);
    }
});
