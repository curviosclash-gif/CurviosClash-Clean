import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuMultiplayerBridge } from '../src/ui/menu/MenuMultiplayerBridge.js';

function createClock(initialNow = 1_700_000_000_000) {
    let current = initialNow;
    return {
        read() {
            return current;
        },
        advance(ms = 0) {
            current += Number(ms) || 0;
            return current;
        },
    };
}

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        },
    };
}

function createLockOnlyStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            if (String(key).endsWith('.lock')) {
                store.set(String(key), String(value));
            }
        },
        removeItem(key) {
            store.delete(String(key));
        },
    };
}

function createListenerHarness() {
    const listeners = new Map();
    return {
        target: {
            addEventListener(type, handler) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(handler);
            },
            removeEventListener(type, handler) {
                listeners.get(type)?.delete(handler);
            },
        },
        dispatch(type, event = {}) {
            for (const handler of Array.from(listeners.get(type) || [])) {
                handler({ type, ...event });
            }
        },
        count(type) {
            return (listeners.get(type) || new Set()).size;
        },
    };
}

function createRuntimeHarness(options = {}) {
    const clock = options.clock || createClock(options.initialNow);
    const tickMs = Number(options.tickMs) || 0;
    const eventHarness = createListenerHarness();
    const documentHarness = options.withDocument ? createListenerHarness() : null;
    let visibilityState = 'visible';
    let addCalls = 0;
    let removeCalls = 0;
    let intervalCount = 0;
    let clearIntervalCount = 0;
    let timeoutCount = 0;
    let clearTimeoutCount = 0;
    let intervalCursor = 0;
    let timeoutCursor = 0;
    const intervals = new Map();
    const timeouts = new Map();
    const eventTarget = {
        addEventListener(type, handler) {
            addCalls += 1;
            eventHarness.target.addEventListener(type, handler);
        },
        removeEventListener(type, handler) {
            removeCalls += 1;
            eventHarness.target.removeEventListener(type, handler);
        },
    };
    const documentTarget = documentHarness
        ? {
            addEventListener(type, handler) {
                documentHarness.target.addEventListener(type, handler);
            },
            removeEventListener(type, handler) {
                documentHarness.target.removeEventListener(type, handler);
            },
            get visibilityState() {
                return visibilityState;
            },
        }
        : undefined;

    return {
        runtime: {
            global: documentTarget ? { document: documentTarget } : {},
            document: documentTarget,
            eventTarget,
            createBroadcastChannel: () => null,
            now: () => {
                if (tickMs > 0) {
                    clock.advance(tickMs);
                }
                return clock.read();
            },
            random: () => options.randomValue ?? 0.123456,
            setInterval(fn) {
                intervalCount += 1;
                const id = `i-${++intervalCursor}`;
                intervals.set(id, fn);
                return id;
            },
            clearInterval(id) {
                clearIntervalCount += 1;
                intervals.delete(id);
            },
            setTimeout(fn) {
                timeoutCount += 1;
                const id = `t-${++timeoutCursor}`;
                timeouts.set(id, fn);
                return id;
            },
            clearTimeout(id) {
                clearTimeoutCount += 1;
                timeouts.delete(id);
            },
        },
        advance(ms = 0) {
            return clock.advance(ms);
        },
        setVisibility(nextState) {
            if (!documentHarness) return;
            visibilityState = String(nextState);
            documentHarness.dispatch('visibilitychange', { visibilityState });
        },
        dispatchResume() {
            eventHarness.dispatch('focus');
        },
        listenerCount(type) {
            return eventHarness.count(type);
        },
        counts() {
            return {
                addCalls,
                removeCalls,
                intervalCount,
                clearIntervalCount,
                timeoutCount,
                clearTimeoutCount,
            };
        },
    };
}

function readLobbySnapshot(storage, lobbyCode) {
    const raw = storage.getItem(`cuviosclash.multiplayer.lobby.${lobbyCode}`);
    return raw ? JSON.parse(raw) : null;
}

test('T41c: MenuMultiplayerBridge akzeptiert Runtime-DI ohne implizite Browser-Globals', () => {
    const runtimeHarness = createRuntimeHarness({ randomValue: 0.123456789 });
    const sharedStorage = createMemoryStorage();
    const hostBridge = new MenuMultiplayerBridge({
        peerId: 'peer-host',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: runtimeHarness.runtime,
    });
    const clientBridge = new MenuMultiplayerBridge({
        peerId: 'peer-client',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: runtimeHarness.runtime,
    });

    const hostResult = hostBridge.host({ actorId: 'host', lobbyCode: 'qa-lobby' });
    const joinResult = clientBridge.join({ actorId: 'client', lobbyCode: 'qa-lobby' });
    hostBridge.toggleReady({ ready: true });
    clientBridge.toggleReady({ ready: true });
    const startResult = hostBridge.requestMatchStart({
        settingsSnapshot: { mapKey: 'maze' },
    });

    hostBridge.dispose();
    clientBridge.dispose();

    const counts = runtimeHarness.counts();
    assert.equal(hostResult?.ok, true);
    assert.equal(joinResult?.ok, true);
    assert.equal(startResult?.ok, true);
    assert.match(String(startResult?.commandId || ''), /^match-/);
    assert.ok(counts.addCalls >= 4);
    assert.ok(counts.removeCalls >= 4);
    assert.equal(runtimeHarness.listenerCount('storage'), 0);
    assert.equal(runtimeHarness.listenerCount('beforeunload'), 0);
    assert.ok(counts.intervalCount >= 2);
    assert.ok(counts.clearIntervalCount >= 2);
    assert.ok(counts.timeoutCount >= 1);
    assert.ok(counts.clearTimeoutCount >= 1);
});

test('T41c2: MenuMultiplayerBridge meldet fehlgeschlagene Host-Persistenz als Fehler', () => {
    const bridge = new MenuMultiplayerBridge({
        peerId: 'peer-host',
        storage: createLockOnlyStorage(),
        sessionStorage: createMemoryStorage(),
        runtime: createRuntimeHarness().runtime,
    });

    const hostResult = bridge.host({ actorId: 'host', lobbyCode: 'persist-fail' });
    const sessionState = bridge.getSessionState();
    bridge.dispose();

    assert.equal(hostResult?.ok, false);
    assert.equal(hostResult?.code, 'lobby_persist_failed');
    assert.equal(sessionState?.joined, false);
    assert.equal(sessionState?.lobbyCode, '');
});

test('T41c1: MenuMultiplayerBridge haelt Revisionen bei ready/heartbeat/match_start Mutationen monoton', () => {
    const runtimeHarness = createRuntimeHarness({
        tickMs: 11,
        randomValue: 0.123456,
    });
    const sharedStorage = createMemoryStorage();
    const hostBridge = new MenuMultiplayerBridge({
        peerId: 'peer-host',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: runtimeHarness.runtime,
    });
    const clientBridge = new MenuMultiplayerBridge({
        peerId: 'peer-client',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: runtimeHarness.runtime,
    });
    const lobbyCode = 'CAS-LOBBY';
    const revisions = [];
    const pendingCommandIds = [];

    const recordRevision = () => {
        const snapshot = readLobbySnapshot(sharedStorage, lobbyCode);
        if (!snapshot) return;
        revisions.push(Number(snapshot.revision || 0));
        pendingCommandIds.push(String(snapshot.pendingMatchStart?.commandId || ''));
    };

    const hostResult = hostBridge.host({ actorId: 'host', lobbyCode });
    const joinResult = clientBridge.join({ actorId: 'client', lobbyCode });
    recordRevision();

    hostBridge.toggleReady({ ready: true });
    recordRevision();
    clientBridge.toggleReady({ ready: true });
    recordRevision();

    hostBridge._updateHeartbeat();
    clientBridge._updateHeartbeat();
    recordRevision();

    const startResult = hostBridge.requestMatchStart({
        settingsSnapshot: { mapKey: 'maze', winsNeeded: 3 },
    });
    recordRevision();

    hostBridge._updateHeartbeat();
    clientBridge._updateHeartbeat();
    recordRevision();

    const finalSnapshot = readLobbySnapshot(sharedStorage, lobbyCode);
    hostBridge.dispose();
    clientBridge.dispose();

    assert.equal(hostResult?.ok, true);
    assert.equal(joinResult?.ok, true);
    assert.equal(startResult?.ok, true);
    assert.ok(revisions.length >= 5);
    assert.ok(revisions.every((revision, index) => index === 0 || revision >= revisions[index - 1]));
    assert.ok(Number(finalSnapshot?.revision || 0) >= revisions[0]);
    assert.match(String(finalSnapshot?.pendingMatchStart?.commandId || ''), /^match-/);
    assert.ok(pendingCommandIds.filter(Boolean).length >= 1);
});

test('T41c3: MenuMultiplayerBridge weist zusaetzliche Joiner bei voller Lobby ab', () => {
    const clock = createClock();
    const sharedStorage = createMemoryStorage();
    const bridges = [];
    const lobbyCode = 'FULL-QA';

    const createBridge = (peerId, randomValue) => {
        const runtimeHarness = createRuntimeHarness({
            clock,
            tickMs: 1,
            randomValue,
        });
        return new MenuMultiplayerBridge({
            peerId,
            storage: sharedStorage,
            sessionStorage: createMemoryStorage(),
            runtime: runtimeHarness.runtime,
        });
    };

    const hostBridge = createBridge('peer-host', 0.654321);
    bridges.push(hostBridge);
    const hostResult = hostBridge.host({ actorId: 'host', lobbyCode });

    for (let index = 1; index < 10; index += 1) {
        const bridge = createBridge(`peer-${index}`, 0.654321 + index);
        bridges.push(bridge);
        bridge.join({ actorId: `player-${index}`, lobbyCode });
    }

    const overflowBridge = createBridge('peer-overflow', 0.999999);
    bridges.push(overflowBridge);
    const overflowResult = overflowBridge.join({ actorId: 'overflow', lobbyCode });
    const snapshot = readLobbySnapshot(sharedStorage, lobbyCode);

    while (bridges.length > 0) {
        bridges.pop()?.dispose?.();
    }

    assert.equal(hostResult?.ok, true);
    assert.equal(overflowResult?.ok, false);
    assert.equal(overflowResult?.code, 'lobby_full');
    assert.equal(Array.isArray(snapshot?.members) ? snapshot.members.length : 0, 10);
});

test('T41c4: MenuMultiplayerBridge verlaengert Presence-Leases bei visibilitychange und Resume', () => {
    const clock = createClock();
    const sharedStorage = createMemoryStorage();
    const hostHarness = createRuntimeHarness({
        clock,
        randomValue: 0.111111,
        withDocument: true,
    });
    const clientHarness = createRuntimeHarness({
        clock,
        randomValue: 0.222222,
        withDocument: true,
    });
    const hostBridge = new MenuMultiplayerBridge({
        peerId: 'peer-host',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: hostHarness.runtime,
    });
    const clientBridge = new MenuMultiplayerBridge({
        peerId: 'peer-client',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: clientHarness.runtime,
    });
    const lobbyCode = 'LEASE-QA';

    hostBridge.host({ actorId: 'host', lobbyCode });
    clientBridge.join({ actorId: 'client', lobbyCode });

    const hostLeaseAt = () => Number(
        readLobbySnapshot(sharedStorage, lobbyCode)?.members?.find((member) => member.peerId === 'peer-host')?.leaseExpiresAt || 0
    );

    const initialLease = hostLeaseAt();
    clock.advance(1);
    hostHarness.setVisibility('hidden');
    const hiddenLease = hostLeaseAt();

    clock.advance(20_000);
    clientBridge._syncStateFromSnapshot(clientBridge._getSnapshot(lobbyCode), { preserveLobbyCode: true });
    const backgroundState = clientBridge.getSessionState();

    clock.advance(1);
    hostHarness.setVisibility('visible');
    hostHarness.dispatchResume();
    const resumedLease = hostLeaseAt();

    hostBridge.dispose();
    clientBridge.dispose();

    assert.ok(hiddenLease > initialLease);
    assert.ok(resumedLease > hiddenLease);
    assert.equal(backgroundState.memberCount, 2);
    assert.equal(backgroundState.hostConnected, true);
    assert.equal(backgroundState.isHost, false);
    assert.equal(backgroundState.role, 'client');
});

test('T41c5: MenuMultiplayerBridge verhindert implizite Host-Promotion nach Host-Stale und erlaubt nur manuelles Re-Hosting', () => {
    const clock = createClock(1_700_000_100_000);
    const sharedStorage = createMemoryStorage();

    const createBridge = (peerId, randomValue) => {
        const runtimeHarness = createRuntimeHarness({
            clock,
            randomValue,
        });
        return new MenuMultiplayerBridge({
            peerId,
            storage: sharedStorage,
            sessionStorage: createMemoryStorage(),
            runtime: runtimeHarness.runtime,
        });
    };

    const hostBridge = createBridge('peer-host', 0.111111);
    const clientBridge = createBridge('peer-client', 0.222222);
    const lobbyCode = 'STALE-QA';

    hostBridge.host({ actorId: 'host', lobbyCode });
    clientBridge.join({ actorId: 'client', lobbyCode });

    clock.advance(30_000);
    clientBridge._updateHeartbeat();

    clock.advance(35_000);
    clientBridge._updateHeartbeat();
    const staleState = clientBridge.getSessionState();

    const blockedJoinBridge = createBridge('peer-join', 0.333333);
    const blockedJoin = blockedJoinBridge.join({ actorId: 'late-client', lobbyCode });

    const recoveryBridge = createBridge('peer-rehost', 0.444444);
    const rehostResult = recoveryBridge.host({ actorId: 'rehost', lobbyCode });
    const recoveredState = recoveryBridge.getSessionState();
    const recoveredSnapshot = readLobbySnapshot(sharedStorage, lobbyCode);

    recoveryBridge.dispose();
    blockedJoinBridge.dispose();
    clientBridge.dispose();
    hostBridge.dispose();

    assert.equal(staleState.isHost, false);
    assert.equal(staleState.role, 'client');
    assert.equal(staleState.hostConnected, false);
    assert.equal(staleState.hostPeerId, 'peer-host');
    assert.equal(staleState.memberCount, 1);
    assert.equal(blockedJoin?.ok, false);
    assert.equal(blockedJoin?.code, 'host_unavailable');
    assert.equal(rehostResult?.ok, true);
    assert.equal(recoveredState.isHost, true);
    assert.equal(recoveredSnapshot?.hostPeerId, 'peer-rehost');
    assert.equal(
        recoveredSnapshot?.members?.find((member) => member.role === 'host')?.peerId,
        'peer-rehost'
    );
});
