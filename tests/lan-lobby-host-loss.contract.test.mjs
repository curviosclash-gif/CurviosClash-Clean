import assert from 'node:assert/strict';
import test from 'node:test';

import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { syncLobbyScreen } from '../src/ui/start-setup/LobbyScreenUi.js';

function createJoinedGuest(options = {}) {
    const lobby = new LANMatchLobby({ signalingUrl: 'http://127.0.0.1:9', pollIntervalMs: 100, pollTimeoutMs: 250, ...options });
    lobby.isHost = false;
    lobby._localPeerId = 'peer-b';
    lobby._localPeerToken = 'token-b';
    return lobby;
}

test('the first failed status poll already reports the reconnect instead of staying "connected"', async () => {
    const lobby = createJoinedGuest();
    let polls = 0;
    lobby._pollStatusOnce = async () => { polls += 1; throw new Error('connect ECONNREFUSED'); };
    lobby._attemptReconnect = async () => {};
    const originalHandle = lobby._handleSignalingClosed.bind(lobby);
    const handled = new Promise((resolve) => {
        lobby._handleSignalingClosed = (error) => { originalHandle(error); resolve(); };
    });
    lobby._startPolling();
    await handled;
    lobby.dispose();
    assert.equal(polls, 1, 'one lost poll is enough; the reconnect attempts are the tolerance');
});

test('a rejoin request to a vanished host gives up within the poll timeout', async (t) => {
    const lobby = createJoinedGuest();
    const originalFetch = globalThis.fetch;
    // A dead host on Windows answers nothing for seconds; simulate a request that never settles on its own.
    globalThis.fetch = (url, init = {}) => new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    t.after(() => { lobby.dispose(); globalThis.fetch = originalFetch; });
    const closed = new Promise((resolve) => lobby.on('closed', resolve));
    const started = Date.now();
    await lobby._attemptReconnect(new Error('lost'));
    const event = await closed;
    assert.equal(event.reason, 'signaling_unavailable');
    // 3 attempts x 250 ms timeout + 1500 ms + 2250 ms pauses, with headroom.
    assert.ok(Date.now() - started < 6000, `gave up after ${Date.now() - started} ms`);
});

test('losing the lobby connection clears the stale lobby list once', () => {
    const resets = [];
    const panel = { dataset: {} };
    const ui = { multiplayerPanel: panel, openLobbyTable: { reset: (message) => resets.push(message) } };
    syncLobbyScreen(ui, { joined: true, connectionPhase: 'connected', members: [] }, true);
    assert.equal(resets.length, 0, 'a working lobby keeps the list');

    syncLobbyScreen(ui, { joined: false, connectionPhase: 'disconnected', members: [] }, true);
    assert.equal(resets.length, 1);
    assert.match(resets[0], /Verbindung verloren/);

    // A search after the loss must survive the next sync while the phase is still "disconnected".
    syncLobbyScreen(ui, { joined: false, connectionPhase: 'disconnected', members: [] }, true);
    assert.equal(resets.length, 1);
});