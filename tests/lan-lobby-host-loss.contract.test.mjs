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

test('guest status polling keeps reconnecting after its first failed poll', async () => {
    const lobby = createJoinedGuest();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = [];
    let reconnects = 0;

    globalThis.setTimeout = (callback) => {
        const timer = { callback };
        timers.push(timer);
        return timer;
    };
    globalThis.clearTimeout = (timer) => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
    };

    try {
        lobby._pollStatusOnce = async () => { throw new Error('connect ECONNREFUSED'); };
        lobby._attemptReconnect = async () => { reconnects += 1; };
        lobby._startPolling();
        const timer = timers.shift();
        assert.ok(timer, 'the guest poll is scheduled');
        await timer.callback();
        assert.equal(reconnects, 1, 'guest reconnect behavior is unchanged');
    } finally {
        lobby.dispose();
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('host status polling reconnects only after three consecutive failures and resets after success', async () => {
    const lobby = createJoinedGuest();
    lobby.isHost = true;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = [];
    let timerId = 0;
    let reconnects = 0;
    const outcomes = ['failure', 'failure', 'success', 'failure', 'failure', 'failure'];

    globalThis.setTimeout = (callback) => {
        const timer = { id: ++timerId, callback };
        timers.push(timer);
        return timer;
    };
    globalThis.clearTimeout = (timer) => {
        const index = timers.findIndex((entry) => entry === timer);
        if (index >= 0) timers.splice(index, 1);
    };

    try {
        lobby._pollStatusOnce = async () => {
            const outcome = outcomes.shift();
            if (outcome === 'failure') throw new Error('connect ECONNREFUSED');
            return {};
        };
        lobby._processServerStatus = () => {};
        lobby._attemptReconnect = async () => { reconnects += 1; };
        lobby._startPolling();

        const pollNext = async () => {
            const timer = timers.shift();
            assert.ok(timer, 'the next poll is scheduled');
            await timer.callback();
        };

        await pollNext();
        assert.equal(lobby._consecutivePollFailures, 1);
        assert.equal(reconnects, 0);
        await pollNext();
        assert.equal(lobby._consecutivePollFailures, 2);
        assert.equal(reconnects, 0);

        await pollNext();
        assert.equal(lobby._consecutivePollFailures, 0, 'a successful status poll resets the failure count');
        assert.equal(reconnects, 0);
        await pollNext();
        await pollNext();
        assert.equal(lobby._consecutivePollFailures, 2);
        assert.equal(reconnects, 0, 'two post-success failures still do not reconnect');
        await pollNext();
        assert.equal(lobby._consecutivePollFailures, 3);
        assert.equal(reconnects, 1, 'the third consecutive failure starts reconnection');
    } finally {
        lobby.dispose();
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
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
