import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createLANSignalingServer } from '../server/lan-signaling.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';

// The LAN start command expires after 2.5 s so the next match can start; from
// then until the host reports the match over, latecomers must stay outside
// instead of joining a running match the host adapter keeps offering to.

async function startLanServer(options = {}) {
    const bundle = createLANSignalingServer(0, options);
    await once(bundle.server, 'listening');
    return { ...bundle, baseUrl: `http://127.0.0.1:${bundle.server.address().port}` };
}

async function postJson(baseUrl, path, body = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
}

test('LAN lobby stays closed during the match and reopens once the host ends it', async () => {
    let currentTime = 1_000_000;
    const lan = await startLanServer({ now: () => currentTime, ghostCleanupIntervalMs: 0 });
    try {
        const created = await postJson(lan.baseUrl, '/lobby/create', { maxPlayers: 3 });
        const hostToken = created.payload.hostToken;
        const lobbyCode = created.payload.lobbyCode;
        const joined = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode, actorId: 'Guest' });
        await postJson(lan.baseUrl, '/lobby/ready', {
            playerId: joined.payload.playerId, playerToken: joined.payload.playerToken, ready: true,
        });
        await postJson(lan.baseUrl, '/lobby/match-start', { hostPeerId: 'host', hostToken, commandId: 'match-first' });

        currentTime += 10_000;
        const midMatch = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode, actorId: 'Latecomer' });
        assert.equal(midMatch.status, 409, 'a latecomer cannot join a LAN match that is still running');
        assert.equal(midMatch.payload.message, 'match_in_progress');

        const forged = await postJson(lan.baseUrl, '/lobby/match-end', { hostPeerId: 'host', hostToken: 'forged', commandId: 'match-first' });
        assert.equal(forged.status, 403, 'only the host ends a match');

        const ended = await postJson(lan.baseUrl, '/lobby/match-end', { hostPeerId: 'host', hostToken, commandId: 'match-first' });
        assert.equal(ended.ok, true);
        const afterMatch = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode, actorId: 'Latecomer' });
        assert.equal(afterMatch.ok, true, 'the lobby accepts players again after the match');

        for (const player of [joined.payload, afterMatch.payload]) {
            await postJson(lan.baseUrl, '/lobby/ready', { playerId: player.playerId, playerToken: player.playerToken, ready: true });
        }
        const second = await postJson(lan.baseUrl, '/lobby/match-start', { hostPeerId: 'host', hostToken, commandId: 'match-second' });
        assert.equal(second.payload.pendingMatchStart?.commandId, 'match-second');
    } finally {
        await closeLanTestServer(lan.server);
    }
});

test('LAN lobby client reports the match over and the lobby takes players again', async () => {
    const lan = await startLanServer({ ghostCleanupIntervalMs: 0 });
    const host = new LANMatchLobby({ signalingUrl: lan.baseUrl });
    host._startPolling = () => {};
    try {
        await host.create({ maxPlayers: 3 });
        const joined = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode: host.lobbyCode, actorId: 'Guest' });
        await postJson(lan.baseUrl, '/lobby/ready', {
            playerId: joined.payload.playerId, playerToken: joined.payload.playerToken, ready: true,
        });
        const started = await host.startMatch({ settingsSnapshot: {} });
        const blocked = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode: host.lobbyCode, actorId: 'Latecomer' });
        assert.equal(blocked.status, 409);
        await host.endMatch(started.pendingMatchStart.commandId);
        const joinedAfter = await postJson(lan.baseUrl, '/lobby/join', { lobbyCode: host.lobbyCode, actorId: 'Latecomer' });
        assert.equal(joinedAfter.ok, true, 'the host report reopens the LAN lobby');
    } finally {
        host.dispose();
        await closeLanTestServer(lan.server);
    }
});
