import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchStartRuntimeService } from '../src/core/runtime/MatchStartRuntimeService.js';
import { teardownRuntimeSession, waitForRuntimePlayersLoaded } from '../src/core/runtime/RuntimeSessionLifecycleService.js';

function createSession({ isHost = false, extraPeerIds = [] } = {}) {
    const listeners = new Map();
    return {
        isHost,
        localPlayerId: isHost ? 'host' : 'client',
        loadedSignals: [],
        getPlayers: () => [{ peerId: 'host' }, { peerId: 'client' }, ...extraPeerIds.map((peerId) => ({ peerId }))],
        notifyArenaLoaded(playerId) {
            this.loadedSignals.push(playerId);
        },
        on(event, handler) {
            const entries = listeners.get(event) || [];
            entries.push(handler);
            listeners.set(event, entries);
        },
        off(event, handler) {
            listeners.set(event, (listeners.get(event) || []).filter((entry) => entry !== handler));
        },
        emit(event, payload) {
            for (const handler of [...(listeners.get(event) || [])]) handler(payload);
        },
        listenerCount(event) {
            return (listeners.get(event) || []).length;
        },
        dispose() {},
    };
}

function createFacade(session) {
    return {
        session,
        _arenaLoadedPeers: new Set(),
        _pendingStateUpdates: [],
    };
}

test('network client remains before round start until its host round-start gate arrives', async () => {
    const session = createSession();
    const facade = createFacade(session);
    let startRoundCalls = 0;
    let projectionCalls = 0;
    facade.getRuntimeHandle = () => ({ createMatchSession: () => ({}) });
    facade.getPorts = () => ({
        lifecyclePort: {
            initializeSession: () => true,
            waitForAllPlayersLoaded: () => waitForRuntimePlayersLoaded(facade),
        },
        matchUiPort: {
            prepareMatchStartProjection: () => true,
            startRound: () => { startRoundCalls += 1; },
            completeMatchStartProjection: () => { projectionCalls += 1; },
        },
    });
    const service = new MatchStartRuntimeService({ facade });

    const start = service.execute();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(session.loadedSignals, ['client']);
    assert.equal(startRoundCalls, 0);
    assert.equal(projectionCalls, 0);

    session.emit('roundStartGate', {
        expectedPeerIds: ['host', 'client'],
        timestamp: Date.now(),
    });
    assert.equal(await start, true);
    assert.equal(startRoundCalls, 1);
    assert.equal(projectionCalls, 1);
    assert.equal(session.listenerCount('roundStartGate'), 0);
});

test('MatchStartRuntimeService cancellation removes the pending client gate wait', async () => {
    const session = createSession();
    const facade = createFacade(session);
    let startRoundCalls = 0;
    facade.getRuntimeHandle = () => ({ createMatchSession: () => ({}) });
    facade.getPorts = () => ({
        lifecyclePort: {
            initializeSession: () => true,
            waitForAllPlayersLoaded: () => waitForRuntimePlayersLoaded(facade),
        },
        matchUiPort: {
            prepareMatchStartProjection: () => true,
            startRound: () => { startRoundCalls += 1; },
        },
    });
    const service = new MatchStartRuntimeService({ facade });

    const start = service.execute();
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.cancel();

    assert.equal(await start, false);
    assert.equal(startRoundCalls, 0);
    assert.equal(session.listenerCount('roundStartGate'), 0);
});

test('client gate wait fails closed on timeout, cancellation, and teardown', async () => {
    const session = createSession();
    const facade = createFacade(session);
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const timers = new Map();
    let nextTimerId = 1;
    globalThis.setTimeout = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay, interval: false });
        return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
    globalThis.setInterval = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay, interval: true });
        return id;
    };
    globalThis.clearInterval = (id) => timers.delete(id);

    try {
        const timedOut = waitForRuntimePlayersLoaded(facade);
        assert.equal(session.loadedSignals.length, 1);
        const gateTimer = [...timers.entries()].find(([, timer]) => !timer.interval);
        assert.ok(gateTimer);
        const retryTimer = [...timers.values()].find((timer) => timer.interval);
        assert.ok(retryTimer);
        retryTimer.callback();
        assert.equal(session.loadedSignals.length, 2);
        gateTimer[1].callback();
        await assert.rejects(timedOut, /ROUND_START_GATE/);
        assert.equal(session.listenerCount('roundStartGate'), 0);
        assert.equal(timers.size, 0);

        const cancelled = waitForRuntimePlayersLoaded(facade);
        facade._cancelRuntimePlayersLoadedWait();
        assert.equal(await cancelled, false);
        assert.equal(session.listenerCount('roundStartGate'), 0);
        assert.equal(timers.size, 0);

        const tornDown = waitForRuntimePlayersLoaded(facade);
        teardownRuntimeSession(facade);
        assert.equal(await tornDown, false);
        assert.equal(session.listenerCount('roundStartGate'), 0);
        assert.equal(timers.size, 0);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

test('client gate wait outlasts the host wait for the slowest peer', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const timers = new Map();
    let nextTimerId = 1;
    globalThis.setTimeout = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay, interval: false });
        return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
    globalThis.setInterval = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay, interval: true });
        return id;
    };
    globalThis.clearInterval = (id) => timers.delete(id);
    const gateDelay = () => [...timers.values()].find((timer) => !timer.interval)?.delay;

    try {
        for (const extraPeerIds of [[], ['third', 'fourth']]) {
            const hostFacade = createFacade(createSession({ isHost: true, extraPeerIds }));
            const hostWait = waitForRuntimePlayersLoaded(hostFacade);
            const hostDelay = gateDelay();
            hostFacade._arenaLoadedHostWait.cancel();
            await hostWait;
            timers.clear();

            const clientFacade = createFacade(createSession({ extraPeerIds }));
            const clientWait = waitForRuntimePlayersLoaded(clientFacade);
            const clientDelay = gateDelay();
            clientFacade._cancelRuntimePlayersLoadedWait();
            assert.equal(await clientWait, false);
            timers.clear();

            assert.ok(Number.isFinite(hostDelay) && hostDelay > 0);
            assert.ok(
                clientDelay > hostDelay,
                `client gives up after ${clientDelay} ms while the host may wait ${hostDelay} ms`
            );
        }
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

test('client ignores malformed and stale-session round-start gates', async () => {
    const session = createSession();
    const replacementSession = createSession();
    const facade = createFacade(session);
    const wait = waitForRuntimePlayersLoaded(facade);
    session.emit('roundStartGate', { expectedPeerIds: ['host', 'client'] });
    session.emit('roundStartGate', { expectedPeerIds: ['host'], timestamp: Date.now() });
    facade.session = replacementSession;
    session.emit('roundStartGate', { expectedPeerIds: ['host', 'client'], timestamp: Date.now() });

    assert.equal(await wait, false);
    assert.equal(session.listenerCount('roundStartGate'), 0);
    assert.equal(replacementSession.listenerCount('roundStartGate'), 0);
});
