import assert from 'node:assert/strict';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';

async function startLanServer(options) {
    const bundle = createLANSignalingServer(0, options);
    await new Promise((resolve) => bundle.server.once('listening', resolve));
    return { ...bundle, baseUrl: `http://127.0.0.1:${bundle.server.address().port}` };
}

async function postJson(baseUrl, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
}

test('LAN: a guest that drops and rejoins keeps the lobby name it chose', async () => {
    // The clock is injected so the ghost cleanup can drop the guest without waiting.
    let currentTime = 1_000_000;
    const lanServer = await startLanServer({
        now: () => currentTime,
        ghostPlayerTimeoutMs: 1_000,
        ghostCleanupIntervalMs: 0,
        reconnectLeaseMs: 60_000,
    });
    try {
        const created = await postJson(lanServer.baseUrl, '/lobby/create', { maxPlayers: 4 });
        const joined = await postJson(lanServer.baseUrl, '/lobby/join', {
            lobbyCode: created.payload?.lobbyCode || '',
            lobbyName: 'Falke',
            vehicleId: 'manta',
        });
        const playerId = String(joined.payload?.playerId || '');
        const playerToken = String(joined.payload?.playerToken || '');
        // A later rename is what the lease has to keep, not only the name sent with the join.
        const renamed = await postJson(lanServer.baseUrl, '/lobby/name', {
            playerId,
            playerToken,
            lobbyName: 'Habicht',
        });
        assert.equal(renamed.ok, true, 'the guest renames itself');

        currentTime += 2_000;
        lanServer.cleanupGhostPlayers();

        const rejoined = await postJson(lanServer.baseUrl, '/lobby/rejoin', { playerId, playerToken });
        assert.equal(rejoined.ok, true, 'the rejoin lease is honoured');
        const member = rejoined.payload?.sessionState?.players?.find((entry) => entry.playerId === playerId);
        assert.ok(member, 'the guest is back in the lobby');
        assert.equal(member.lobbyName, 'Habicht', 'the rejoined guest keeps its lobby name');
        assert.equal(member.vehicleId, 'manta', 'the rejoined guest keeps its ship as before');
    } finally {
        await closeLanTestServer(lanServer.server);
    }
});
