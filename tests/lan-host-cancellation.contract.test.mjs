import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { NetworkLobbyService } from '../src/application/session-runtime/NetworkLobbyService.js';
import { createLANSignalingServer } from '../server/lan-signaling.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';

test('cancelled LAN host creation closes a late server lobby', async () => {
    const bundle = createLANSignalingServer(0, { ghostCleanupIntervalMs: 0 });
    await once(bundle.server, 'listening');
    const signalingUrl = `http://127.0.0.1:${bundle.server.address().port}`;
    const originalFetch = globalThis.fetch;
    let releaseCreateResponse;
    let resolveCreateStarted;
    let resolveCleanupCompleted;
    const createStarted = new Promise((resolve) => { resolveCreateStarted = resolve; });
    const cleanupCompleted = new Promise((resolve) => { resolveCleanupCompleted = resolve; });
    const createResponseGate = new Promise((resolve) => { releaseCreateResponse = resolve; });
    let createPayload = null;
    let cleanupResult = null;
    const events = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith('/lobby/create')) {
            const response = await originalFetch(input, init);
            createPayload = await response.json();
            resolveCreateStarted();
            await createResponseGate;
            return { ok: response.ok, status: response.status, json: async () => createPayload };
        }
        if (url.endsWith('/lobby/leave')) {
            const body = JSON.parse(init.body);
            const response = await originalFetch(input, init);
            const payload = await response.json();
            if (body.hostToken) {
                cleanupResult = { body, status: response.status, payload };
                resolveCleanupCompleted();
            }
            return { ok: response.ok, status: response.status, json: async () => payload };
        }
        return originalFetch(input, init);
    };

    const service = new NetworkLobbyService({
        runtime: { global: {} },
        discoveryPort: null,
        resolveHostSignalingUrl: () => signalingUrl,
        createLobby: (url) => new LANMatchLobby({ signalingUrl: url }),
        onEvent: (event) => events.push(event),
    });

    try {
        const pendingHost = service.host({ actorId: 'Host' });
        await createStarted;
        service.leave();
        releaseCreateResponse();

        const result = await pendingHost;
        assert.equal(result.ok, false);
        assert.equal(result.code, 'host_cancelled');
        await cleanupCompleted;
        assert.equal(cleanupResult.status, 200);
        assert.deepEqual(cleanupResult.body, { playerId: 'host', hostToken: createPayload.hostToken });
        assert.equal(events.some((event) => event.eventType === 'host'), false);
        assert.equal(service.getSessionState().lobbyCode, '');
    } finally {
        globalThis.fetch = originalFetch;
        service.leave();
        await closeLanTestServer(bundle.server);
    }
});
