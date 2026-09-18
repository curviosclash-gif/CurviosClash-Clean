import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLANSignalingServer } from '../server/lan-signaling.js';
import { closeLanTestServer } from './lan-server-teardown.mjs';
import { createSignalingServer } from '../server/signaling-server.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';
import { createNetworkLobbySettingsPublisher } from '../src/application/session-runtime/NetworkLobbySettingsPublisher.js';
import { createPublicLobbyMetadata } from '../src/application/session-runtime/NetworkLobbyExperienceSupport.js';
import { buildSessionState } from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';
import { createLobbyMatchSummary, normalizeLobbyMatchSummary } from '../src/shared/contracts/LobbyMatchSummaryContract.js';
import { resolveLobbyMatchFacts, resolveLobbyStatus } from '../src/ui/start-setup/LobbyScreenUi.js';
import { handleQuickStartLastStartAction } from '../src/core/runtime/MenuRuntimeQuickStartService.js';

const settings = (mapKey = 'standard') => ({ mapKey, numBots: 3, botDifficulty: 'HARD', winsNeeded: 7,
    gameMode: 'CLASSIC', localSettings: { modePath: 'normal' } });

test('multiplayer quickstart opens the lobby without bypassing readiness or launching a local match', async () => {
    const calls = [];
    await handleQuickStartLastStartAction({
        game: { settings: { localSettings: { sessionType: 'multiplayer' } }, uiManager: { menuNavigationRuntime: { showPanel: (panel) => calls.push(panel) } } },
        startMatch: () => calls.push('start'),
        recordMenuTelemetry: () => calls.push('started'),
    });
    assert.deepEqual(calls, ['submenu-multiplayer']);
});

test('public lobby facts describe actual objectives and keep legacy unknowns explicit', () => {
    assert.deepEqual(createLobbyMatchSummary(settings()), { numBots: 3, botDifficulty: 'HARD', targetKind: 'wins', targetValue: 7 });
    assert.equal(createLobbyMatchSummary({ ...settings(), gameMode: 'HUNT', hunt: { respawnEnabled: true, deathmatchKillLimit: 20 } }).targetValue, 20);
    assert.equal(createLobbyMatchSummary({ localSettings: { modePath: 'arcade' }, arcade: { sectorCount: 4 } }).targetKind, 'sectors');
    assert.deepEqual(normalizeLobbyMatchSummary({ numBots: -4, botDifficulty: 'script', targetValue: Infinity }),
        { numBots: 0, botDifficulty: null, targetKind: null, targetValue: null });
    assert.equal(resolveLobbyMatchFacts({ mapKey: 'maze', modePath: 'normal' })[2][1], 'Nicht verfügbar');
    assert.match(resolveLobbyMatchFacts(createPublicLobbyMetadata(settings()))[2][1], /3 · Schwer/);
    assert.match(resolveLobbyStatus({ joined: true, connected: true, settingsSyncPending: true }), /übertragen/);
});

test('LAN publishes summary and readiness atomically, rejects stale Ready/Start, and preserves projection', async () => {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    const client = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = client._startPolling = () => {};
    try {
        await host.create({ metadata: createPublicLobbyMetadata(settings()) });
        await client.join({ signalingUrl: url, lobbyCode: host.lobbyCode, name: 'Echo' });
        await client.setReady(true);
        const staleState = structuredClone(client.sessionState);
        const updated = await host.updateSettings({ metadata: createPublicLobbyMetadata(settings('maze')) });
        assert.equal(updated.sessionState.settingsRevision, 2);
        assert.ok(updated.sessionState.players.every((player) => !player.ready));
        await assert.rejects(client.setReady(true), (error) => error.code === 'settings_revision_mismatch');
        await assert.rejects(host.startMatch({ settingsRevision: 1, settingsSnapshot: settings() }), (error) => error.code === 'settings_revision_mismatch');
        client._processServerStatus(updated);
        client._processServerStatus({ sessionState: { ...updated.sessionState, settingsRevision: 1, metadata: staleState.metadata } });
        assert.equal(client.sessionState.metadata.mapKey, 'maze');
        const projection = buildSessionState(client.sessionState, { localPeerId: client.getLocalPeerId() });
        assert.equal(projection.settingsRevision, 2);
        assert.equal(projection.metadata.matchSummary.botDifficulty, 'HARD');
        await client.setReady(true);
        const started = await host.startMatch({ settingsRevision: 2, settingsSnapshot: settings('maze') });
        assert.equal(started.pendingMatchStart.settingsRevision, 2);
        assert.equal(started.pendingMatchStart.settingsSnapshot.mapKey, 'maze');
        await assert.rejects(host.updateSettings({ metadata: createPublicLobbyMetadata(settings()) }), (error) => error.code === 'match_start_pending');
    } finally {
        client.dispose(); host.dispose();
        await closeLanTestServer(server);
    }
});

test('online transport awaits metadata confirmation and rejects a stale client revision', async () => {
    const previousSocket = globalThis.WebSocket;
    globalThis.WebSocket = WebSocket;
    const server = createSignalingServer(0);
    if (!server.address()) await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const host = new OnlineMatchLobby({ signalingUrl: url });
    const client = new OnlineMatchLobby({ signalingUrl: url });
    try {
        await host.create({ metadata: createPublicLobbyMetadata(settings()) });
        await client.join(host.lobbyCode, { name: 'Echo', maxConnectAttempts: 1, connectTimeoutMs: 2000 });
        await client.setReady(true);
        const metadata = createPublicLobbyMetadata(settings('maze'));
        await host.updateSettings({ metadata });
        assert.equal(host.sessionState.settingsRevision, 2);
        assert.equal(host.sessionState.metadata.mapKey, 'maze');
        assert.ok(host.sessionState.members.filter((member) => !member.isHost).every((member) => !member.ready));
        await assert.rejects(client._sendMutationWithAck({ commandType: 'ready', payload: { ready: true, settingsRevision: 1 }, ackMatcher: () => false }),
            (error) => error.code === 'settings_revision_mismatch');
        await client.setReady(true);
        const result = await host.startMatch({ settingsSnapshot: settings('maze') });
        assert.equal(result.pendingMatchStart.settingsRevision, 2);
        await assert.rejects(host.updateSettings({ metadata: createPublicLobbyMetadata(settings()) }), (error) => error.code === 'match_start_pending');
    } finally {
        client.dispose(); host.dispose();
        for (const socket of server.clients) socket.terminate();
        await new Promise((resolve) => server.close(resolve));
        globalThis.WebSocket = previousSocket;
    }
});

function publisherHarness() {
    const requests = [];
    const service = {
        _hostSettingsSnapshot: settings(), _name: 'Host',
        getSessionState: () => ({ isHost: true, settingsRevision: 1 }),
        getSnapshot: () => ({ hostSettingsSnapshot: service._hostSettingsSnapshot }),
        _fail: (message, code) => ({ ok: false, message, code }),
        _transportSession: { updateSettings: (snapshot) => new Promise((resolve, reject) => requests.push({ snapshot, resolve, reject })) },
    };
    return { service, requests, publisher: createNetworkLobbySettingsPublisher(service) };
}

test('rapid host edits publish in order and remain pending until the latest acknowledgment', async () => {
    const { publisher, requests, service } = publisherHarness();
    const first = publisher.publish(settings('maze'));
    const second = publisher.publish(settings('pyramid'));
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(publisher.getState().settingsSyncPending, true);
    requests[0].resolve(); await first; await Promise.resolve();
    assert.equal(requests.length, 2);
    assert.equal(publisher.getState().settingsSyncPending, true);
    requests[1].resolve(); await second;
    assert.equal(publisher.getState().settingsSyncPending, false);
    assert.equal(service._hostSettingsSnapshot.mapKey, 'pyramid');
});

test('failed publishing can be retried and late acknowledgments cannot alter a new lobby', async () => {
    const { publisher, requests, service } = publisherHarness();
    const failed = publisher.publish(settings('maze')); await Promise.resolve();
    requests[0].reject(new Error('offline')); assert.equal((await failed).ok, false);
    assert.equal(publisher.getState().settingsSyncError, 'offline');
    assert.equal(service._hostSettingsSnapshot.mapKey, 'standard');
    const retry = publisher.publish(settings('maze')); await Promise.resolve();
    requests[1].resolve(); await retry;
    assert.equal(publisher.getState().settingsSyncError, '');
    const obsolete = publisher.publish(settings('pyramid')); await Promise.resolve();
    publisher.reset(); requests[2].resolve(); await obsolete;
    assert.equal(service._hostSettingsSnapshot.mapKey, 'maze');
    assert.equal(publisher.getState().settingsSyncPending, false);
});
