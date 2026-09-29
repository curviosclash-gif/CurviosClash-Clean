import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { createSignalingServer } from '../server/signaling-server.js';
import { finalizeMatchFlow } from '../src/core/runtime/MatchFinalizeFlowService.js';
import { NetworkLobbyService } from '../src/application/session-runtime/NetworkLobbyService.js';
import { listOpenOnlineLobbies } from '../src/network/OnlineLobbyDirectoryClient.js';
import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';

// A lobby outlives its matches: after the host returns to the lobby, the same
// lobby must accept joins, settings changes and a second match start again.

async function startOnlineServer() {
    const wss = createSignalingServer(0);
    if (!wss.address()) await once(wss, 'listening');
    return { wss, url: `ws://127.0.0.1:${wss.address().port}` };
}

async function stopOnlineServer(wss) {
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
}

/**
 * Raw signaling socket with an inbox. Broadcasts arrive between our own
 * requests, so every expectation searches the inbox instead of taking the
 * next message.
 */
async function openInboxClient(url) {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    const inbox = [];
    const waiters = [];
    socket.on('message', (raw) => {
        inbox.push(JSON.parse(raw.toString()));
        for (const waiter of [...waiters]) waiter();
    });
    await once(socket, 'open');
    return {
        send(type, payload = null) {
            socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
        },
        next(types, label = types.join('|')) {
            return new Promise((resolve, reject) => {
                const take = () => {
                    const index = inbox.findIndex((msg) => types.includes(msg.type));
                    if (index < 0) return false;
                    const [msg] = inbox.splice(index, 1);
                    waiters.splice(waiters.indexOf(take), 1);
                    clearTimeout(timer);
                    resolve(msg);
                    return true;
                };
                const timer = setTimeout(() => {
                    waiters.splice(waiters.indexOf(take), 1);
                    reject(new Error(`Timed out waiting for ${label}`));
                }, 2_000);
                waiters.push(take);
                take();
            });
        },
    };
}

async function createReadyOnlineLobby(url) {
    const host = await openInboxClient(url);
    host.send(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: 4, actorId: 'Host' });
    const created = await host.next([SIGNALING_EVENT_TYPES.LOBBY_CREATED]);
    const client = await openInboxClient(url);
    client.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: created.lobbyCode, actorId: 'Guest' });
    await client.next([SIGNALING_EVENT_TYPES.LOBBY_JOINED]);
    client.send(SIGNALING_COMMAND_TYPES.READY, { ready: true });
    await client.next([SIGNALING_EVENT_TYPES.PLAYER_READY]);
    return { host, client, lobbyCode: created.lobbyCode };
}

test('online lobby runs a second match after the host ended the first one', async () => {
    const { wss, url } = await startOnlineServer();
    try {
        const { host, client, lobbyCode } = await createReadyOnlineLobby(url);
        host.send(SIGNALING_COMMAND_TYPES.START_MATCH, { commandId: 'match-first' });
        await host.next([SIGNALING_EVENT_TYPES.MATCH_START]);

        host.send(SIGNALING_COMMAND_TYPES.END_MATCH, { commandId: 'match-first' });

        const late = await openInboxClient(url);
        late.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode, actorId: 'Latecomer' });
        const lateJoin = await late.next([SIGNALING_EVENT_TYPES.LOBBY_JOINED, SIGNALING_EVENT_TYPES.ERROR]);
        assert.equal(lateJoin.type, SIGNALING_EVENT_TYPES.LOBBY_JOINED,
            `a player can join once the first match is over (got ${lateJoin.code || lateJoin.type})`);

        const ended = await client.next([SIGNALING_EVENT_TYPES.MATCH_ENDED]);
        assert.equal(ended.sessionState.pendingMatchStart, null, 'members learn that the lobby is open again');

        const openLobbies = await listOpenOnlineLobbies(url, {
            WebSocketImpl: WebSocket, timeoutMs: 2_000, forceRefresh: true,
        });
        assert.ok(openLobbies.some((entry) => entry.lobbyCode === lobbyCode), 'the lobby is listed publicly again');

        host.send(SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, { metadata: { mapKey: 'maze' } });
        const metadata = await host.next([SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED, SIGNALING_EVENT_TYPES.ERROR]);
        assert.equal(metadata.type, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED, 'the host can change settings between matches');
        const settingsRevision = metadata.sessionState.settingsRevision;

        client.send(SIGNALING_COMMAND_TYPES.READY, { ready: true, settingsRevision });
        late.send(SIGNALING_COMMAND_TYPES.READY, { ready: true, settingsRevision });
        await client.next([SIGNALING_EVENT_TYPES.PLAYER_READY]);
        await late.next([SIGNALING_EVENT_TYPES.PLAYER_READY]);
        host.send(SIGNALING_COMMAND_TYPES.START_MATCH, { commandId: 'match-second', settingsRevision });
        const second = await host.next([SIGNALING_EVENT_TYPES.MATCH_START, SIGNALING_EVENT_TYPES.ERROR]);
        assert.equal(second.pendingMatchStart?.commandId, 'match-second', 'the second match gets its own start command');
    } finally {
        await stopOnlineServer(wss);
    }
});

test('online end_match only counts from the host and for the running match', async () => {
    const { wss, url } = await startOnlineServer();
    try {
        const { host, client, lobbyCode } = await createReadyOnlineLobby(url);
        host.send(SIGNALING_COMMAND_TYPES.START_MATCH, { commandId: 'match-running' });
        await host.next([SIGNALING_EVENT_TYPES.MATCH_START]);

        client.send(SIGNALING_COMMAND_TYPES.END_MATCH, { commandId: 'match-running' });
        host.send(SIGNALING_COMMAND_TYPES.END_MATCH, { commandId: 'match-stale' });
        const answer = await host.next([SIGNALING_EVENT_TYPES.MATCH_ENDED]);
        assert.equal(answer.sessionState.pendingMatchStart?.commandId, 'match-running', 'a stale end leaves the match running');

        const late = await openInboxClient(url);
        late.send(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode });
        const rejected = await late.next([SIGNALING_EVENT_TYPES.LOBBY_JOINED, SIGNALING_EVENT_TYPES.ERROR]);
        assert.equal(rejected.code, 'match_start_pending', 'nobody joins a running match');
    } finally {
        await stopOnlineServer(wss);
    }
});

test('online lobby client ends the match and starts the next one', async () => {
    const previousSocket = globalThis.WebSocket;
    globalThis.WebSocket = WebSocket;
    const { wss, url } = await startOnlineServer();
    const host = new OnlineMatchLobby({ signalingUrl: url });
    const client = new OnlineMatchLobby({ signalingUrl: url });
    try {
        await host.create({ maxPlayers: 2 });
        await client.join(host.lobbyCode, { name: 'Echo', maxConnectAttempts: 1, connectTimeoutMs: 2000 });
        await client.setReady(true);
        const first = await host.startMatch({ settingsSnapshot: {} });
        await host.endMatch(first.pendingMatchStart.commandId);
        assert.equal(host.sessionState.pendingMatchStart, null, 'the host lobby state is open again');
        const second = await host.startMatch({ settingsSnapshot: {} });
        assert.notEqual(second.pendingMatchStart.commandId, first.pendingMatchStart.commandId);
    } finally {
        client.dispose(); host.dispose();
        await stopOnlineServer(wss);
        globalThis.WebSocket = previousSocket;
    }
});

/** Stands for the transport session: records which match the service reports as over. */
function createEndMatchRecorder() {
    const ended = [];
    return {
        ended,
        transportSession: {
            hasLobby: () => true,
            endMatch: (commandId) => { ended.push(commandId); return Promise.resolve({ ok: true }); },
            dispose() {},
        },
    };
}

test('the lobby service reports the started match as over exactly once and only as host', async () => {
    const service = new NetworkLobbyService({ discoveryPort: null });
    const { ended, transportSession } = createEndMatchRecorder();
    service._transportSession = transportSession;
    service.getSessionState = () => ({ isHost: true, joined: true });
    assert.equal(service.notifyMatchEnded(), null, 'without a started match there is nothing to end');
    service._notifyMatchStart({ commandId: 'match-7' });
    await service.notifyMatchEnded();
    await service.notifyMatchEnded();
    assert.deepEqual(ended, ['match-7']);

    const guest = new NetworkLobbyService({ discoveryPort: null });
    const guestRecorder = createEndMatchRecorder();
    guest._transportSession = guestRecorder.transportSession;
    guest.getSessionState = () => ({ isHost: false, joined: true });
    guest._notifyMatchStart({ commandId: 'match-7' });
    guest.notifyMatchEnded();
    assert.deepEqual(guestRecorder.ended, [], 'a guest never ends the match for everyone');
});

test('finalizing a match tells the menu lobby that the match is over', async () => {
    let notified = 0;
    const facade = {
        menuMultiplayerBridge: { notifyMatchEnded: () => { notified += 1; } },
        ports: { sessionPort: { finalizeMatchSession: () => true } },
    };
    await finalizeMatchFlow(facade, { applyReturnToMenuUi: false, schedulePrewarm: false });
    assert.equal(notified, 1);
});
