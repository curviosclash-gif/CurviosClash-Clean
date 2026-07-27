import assert from 'node:assert/strict';
import test from 'node:test';

import { createLobbyLifecycleEventEmitter } from '../src/application/session-runtime/LobbyLifecycleEventEmitter.js';
import { NetworkLobbyService } from '../src/application/session-runtime/NetworkLobbyService.js';
import { resolveDefaultJoinSignalingUrl } from '../src/application/session-runtime/NetworkLobbyServiceDiscovery.js';
import { createNetworkLobbySessionStateProjection } from '../src/application/session-runtime/NetworkLobbySessionStateProjection.js';
import {
    normalizeLobbyCode,
    normalizeSignalingUrl,
    tryParseManualSignalingUrl,
} from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';
import { NetworkLobbyTransportSession } from '../src/application/session-runtime/NetworkLobbyTransportSession.js';
import { StorageLobbyService } from '../src/application/session-runtime/StorageLobbyService.js';
import { createStorageLobbySessionStateProjection } from '../src/application/session-runtime/StorageLobbySessionStateProjection.js';
import { StorageLobbyTransportRuntime } from '../src/application/session-runtime/StorageLobbyTransportRuntime.js';
import { LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION } from '../src/shared/contracts/LobbyLifecycleEventContract.js';
import {
    LOBBY_SERVICE_EVENT_TYPES,
    LOBBY_SERVICE_TRANSPORTS,
} from '../src/shared/contracts/LobbyServiceContract.js';
import { normalizeLobbySessionState } from '../src/network/MatchLobbySessionState.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';

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
            return store.has(String(key)) ? store.get(String(key)) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        },
    };
}

function createStorageRuntime() {
    const intervals = new Map();
    const timeouts = new Map();
    let cursor = 0;
    return {
        global: {},
        createBroadcastChannel: () => null,
        setInterval(fn) {
            const id = `i-${++cursor}`;
            intervals.set(id, fn);
            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        setTimeout(fn) {
            const id = `t-${++cursor}`;
            timeouts.set(id, fn);
            return id;
        },
        clearTimeout(id) {
            timeouts.delete(id);
        },
    };
}

class FakeNetworkLobby {
    constructor(signalingUrl, options = {}) {
        this.signalingUrl = signalingUrl;
        this.localPeerId = options.localPeerId || 'peer-host';
        this.handlers = new Map();
        this.sessionState = null;
        this.disposeCalls = 0;
    }

    on(type, handler) {
        this.handlers.set(type, handler);
    }

    getLocalPeerId() {
        return this.localPeerId;
    }

    async create() {
        this.sessionState = {
            lobbyCode: 'LAN-QA',
            hostPeerId: 'peer-host',
            members: [
                {
                    peerId: 'peer-host',
                    actorId: 'Host',
                    ready: true,
                },
            ],
        };
        this.handlers.get('sessionStateChanged')?.({ sessionState: this.sessionState });
    }

    async join(options = {}) {
        this.sessionState = {
            lobbyCode: options.lobbyCode || 'LAN-QA',
            hostPeerId: 'peer-host',
            members: [
                { peerId: 'peer-host', actorId: 'Host', ready: true },
                { peerId: this.localPeerId, actorId: 'Client', ready: false },
            ],
        };
        this.handlers.get('sessionStateChanged')?.({ sessionState: this.sessionState });
    }

    async setReady(ready) {
        this.sessionState = {
            ...this.sessionState,
            members: this.sessionState.members.map((member) => (
                member.peerId === this.localPeerId ? { ...member, ready } : member
            )),
        };
        this.handlers.get('sessionStateChanged')?.({ sessionState: this.sessionState });
    }

    dispose() {
        this.disposeCalls += 1;
    }
}

function createTrackedEventTarget() {
    const handlers = new Map();
    const added = [];
    const removed = [];
    return {
        handlers,
        added,
        removed,
        addEventListener(type, handler) {
            added.push(type);
            handlers.set(type, handler);
        },
        removeEventListener(type, handler) {
            removed.push(type);
            if (handlers.get(type) === handler) handlers.delete(type);
        },
    };
}

test('V96.6 LobbyLifecycleEventEmitter keeps callback order and the latest 60 events', () => {
    let now = 1000;
    const callbackOrder = [];
    const emitter = createLobbyLifecycleEventEmitter({ now: () => ++now });

    for (let index = 0; index < 62; index += 1) {
        const event = emitter.emit(LOBBY_SERVICE_EVENT_TYPES.READY_TOGGLE, {
            contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
            payload: { index },
            onEvent(value) {
                callbackOrder.push({
                    index: value.payload.index,
                    buffered: emitter.getEvents().length,
                });
            },
        });
        assert.equal(event.payload.index, index);
    }

    const events = emitter.getEvents();
    assert.equal(callbackOrder.length, 62);
    assert.deepEqual(callbackOrder.map((entry) => entry.index), Array.from({ length: 62 }, (_, index) => index));
    assert.equal(callbackOrder[0].buffered, 1);
    assert.equal(callbackOrder[59].buffered, 60);
    assert.equal(callbackOrder[61].buffered, 60);
    assert.equal(events.length, 60);
    assert.equal(events[0].payload.index, 2);
    assert.equal(events[59].payload.index, 61);
    assert.ok(events.every((event) => event.contractVersion === LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION));
});

test('V96.6 Network lobby transport and projection keep delegation, state and dispose contracts', async () => {
    const calls = [];
    const callbacks = [];
    const lobbies = [];
    const createLobby = (signalingUrl, context) => {
        const handlers = new Map();
        const lobby = {
            sessionState: { lobbyCode: 'LAN-QA' },
            on: (type, handler) => handlers.set(type, handler),
            getLocalPeerId: () => 'peer-local',
            create: (options) => calls.push(['create', options]),
            setReady: (ready) => calls.push(['setReady', ready]),
            invalidateReadyForAll: () => calls.push(['invalidateReadyForAll']),
            updateSettings: (snapshot) => calls.push(['updateSettings', snapshot]),
            startMatch: (options) => calls.push(['startMatch', options]),
            dispose: () => calls.push(['dispose', signalingUrl]),
            handlers,
        };
        calls.push(['createLobby', signalingUrl, context]);
        lobbies.push(lobby);
        return lobby;
    };
    const session = new NetworkLobbyTransportSession({
        transport: LOBBY_SERVICE_TRANSPORTS.LAN,
        runtime: { id: 'runtime' },
        platformCapabilities: { id: 'capabilities' },
        createLobby,
        joinLobby: (lobby, options) => calls.push(['join', lobby, options]),
        onSessionStateChanged: (payload) => callbacks.push(['state', payload]),
        onError: (payload) => callbacks.push(['error', payload]),
        onClosed: (payload) => callbacks.push(['closed', payload]),
        onMatchStart: (payload) => callbacks.push(['matchStart', payload]),
    });

    session.replace('ws://first');
    session.create({ maxPlayers: 4 });
    session.join({ lobbyCode: 'LAN-QA' });
    session.setReady(true);
    session.invalidateReadyForAll();
    session.updateSettings({ mapKey: 'maze' });
    session.startMatch({ settingsSnapshot: { mapKey: 'maze' } });
    lobbies[0].handlers.get('sessionStateChanged')?.({ sessionState: { lobbyCode: 'LAN-QA' } });
    lobbies[0].handlers.get('error')?.({ message: 'boom' });
    lobbies[0].handlers.get('closed')?.({ reason: 'closed' });
    lobbies[0].handlers.get('matchStart')?.({ pendingMatchStart: { commandId: 'cmd-1' } });

    assert.equal(session.hasLobby(), true);
    assert.equal(session.getLobbyState().lobbyCode, 'LAN-QA');
    assert.equal(session.getLocalPeerId(), 'peer-local');
    assert.equal(session.getSignalingUrl(), 'ws://first');
    assert.deepEqual(callbacks.map(([type]) => type), ['state', 'error', 'closed', 'matchStart']);
    assert.deepEqual(callbacks[0][1], {
        sessionState: { lobbyCode: 'LAN-QA' },
        signalingUrl: 'ws://first',
        localPeerId: 'peer-local',
    });

    session.replace('ws://second');
    assert.deepEqual(calls.filter(([type]) => type === 'dispose'), [['dispose', 'ws://first']]);
    session.dispose();
    assert.deepEqual(calls.filter(([type]) => type === 'dispose'), [
        ['dispose', 'ws://first'],
        ['dispose', 'ws://second'],
    ]);
    assert.equal(session.hasLobby(), false);
    assert.equal(session.getSignalingUrl(), '');
    assert.deepEqual(calls.filter(([type]) => type === 'join')[0]?.[2], { lobbyCode: 'LAN-QA' });

    const projection = createNetworkLobbySessionStateProjection({ transport: LOBBY_SERVICE_TRANSPORTS.LAN });
    const lobbyState = {
        lobbyCode: 'LAN-QA',
        hostPeerId: 'peer-host',
        members: [
            { peerId: 'peer-host', actorId: 'Host', ready: true },
            { peerId: 'peer-client', actorId: 'Old Client', ready: false },
        ],
        pendingMatchStart: { commandId: 'cmd-1' },
    };

    const state = projection.projectLobbyState(lobbyState, {
        signalingUrl: 'ws://lan',
        localPeerId: 'peer-client',
        actorId: 'Client',
    });
    const snapshot = projection.getSnapshot({
        signalingUrl: 'ws://lan',
        hostSettingsSnapshot: { mapKey: 'maze' },
    });

    assert.equal(state.joined, true);
    assert.equal(state.role, 'client');
    assert.equal(state.members[1].actorId, 'Client');
    assert.equal(state.pendingMatchCommandId, 'cmd-1');
    assert.deepEqual(snapshot, {
        lobbyCode: 'LAN-QA',
        signalingUrl: 'ws://lan',
        hostSettingsSnapshot: { mapKey: 'maze' },
        transport: LOBBY_SERVICE_TRANSPORTS.LAN,
    });
    assert.deepEqual(projection.getConnectionContext({ signalingUrl: 'ws://lan' }), {
        isHost: false,
        playerId: 'peer-client',
        peerToken: '',
        lobbyCode: 'LAN-QA',
        signalingUrl: 'ws://lan',
        transport: LOBBY_SERVICE_TRANSPORTS.LAN,
    });

    state.members[0].actorId = 'mutated';
    snapshot.hostSettingsSnapshot.mapKey = 'mutated';
    assert.equal(projection.getSessionState().members[0].actorId, 'Host');
    assert.equal(projection.getSnapshot({ hostSettingsSnapshot: { mapKey: 'maze' } }).hostSettingsSnapshot.mapKey, 'maze');
    assert.equal(projection.reset().joined, false);
});

test('V96.6 Storage lobby projection dedupes commands and transport dispose releases resources', () => {
    const clock = createClock();
    const calls = [];
    const projection = createStorageLobbySessionStateProjection({
        peerId: 'peer-client',
        now: () => clock.read(),
        startHeartbeat: () => calls.push(['heartbeat', 'start']),
        stopHeartbeat: () => calls.push(['heartbeat', 'stop']),
        onStateChanged: (state) => calls.push(['state', state.pendingMatchCommandId]),
        onMatchStart: (command, state) => calls.push(['match', command.commandId, state.role]),
    });
    const snapshot = {
        schemaVersion: 'multiplayer-session.v1',
        lobbyCode: 'QA-LOBBY',
        hostPeerId: 'peer-host',
        hostActorId: 'Host',
        revision: 1,
        updatedAt: clock.read(),
        members: [
            { peerId: 'peer-host', actorId: 'Host', role: 'host', ready: true, joinedAt: clock.read(), lastSeenAt: clock.read() },
            { peerId: 'peer-client', actorId: 'Client', role: 'client', ready: true, joinedAt: clock.read(), lastSeenAt: clock.read() },
        ],
        pendingMatchStart: {
            commandId: 'cmd-1',
            issuedAt: clock.read(),
            settingsSnapshot: { mapKey: 'maze' },
        },
    };

    projection.syncSnapshot(snapshot);
    projection.syncSnapshot(snapshot);

    assert.equal(projection.getActiveLobbyCode(), 'QA-LOBBY');
    assert.equal(projection.getSessionState().role, 'client');
    assert.equal(projection.getSessionState().canStart, false);
    assert.equal(projection.getSnapshot().pendingMatchStart.commandId, 'cmd-1');
    assert.deepEqual(calls.slice(0, 3), [
        ['heartbeat', 'start'],
        ['state', 'cmd-1'],
        ['match', 'cmd-1', 'client'],
    ]);
    assert.equal(calls.filter(([type]) => type === 'match').length, 1);

    projection.syncSnapshot(null, { preserveLobbyCode: true });
    assert.equal(projection.getSessionState().joined, false);
    assert.equal(projection.getSessionState().lobbyCode, 'QA-LOBBY');
    assert.deepEqual(calls.slice(-2), [
        ['heartbeat', 'stop'],
        ['state', ''],
    ]);

    const eventTarget = createTrackedEventTarget();
    const documentTarget = createTrackedEventTarget();
    const channelTarget = createTrackedEventTarget();
    const clearedIntervals = [];
    let channelCloseCalls = 0;
    const channel = {
        ...channelTarget,
        postMessage() {},
        close() {
            channelCloseCalls += 1;
        },
    };
    const runtime = new StorageLobbyTransportRuntime({
        serviceOptions: {
            peerId: 'peer-runtime',
            storage: createMemoryStorage(),
            sessionStorage: createMemoryStorage(),
            now: () => 1_700_000_000_000,
            random: () => 0.123456,
            runtime: {
                global: {},
                eventTarget,
                document: documentTarget,
                createBroadcastChannel: () => channel,
                setInterval: () => 'heartbeat-1',
                clearInterval: (id) => clearedIntervals.push(id),
                setTimeout: () => 'timeout-1',
                clearTimeout() {},
            },
        },
        getActiveLobbyCode: () => 'QA-LOBBY',
    });

    runtime.startHeartbeat();
    runtime.dispose();

    assert.deepEqual(eventTarget.added, ['storage', 'beforeunload', 'focus', 'pageshow']);
    assert.deepEqual(eventTarget.removed, ['storage', 'beforeunload', 'focus', 'pageshow']);
    assert.deepEqual(documentTarget.added, ['visibilitychange']);
    assert.deepEqual(documentTarget.removed, ['visibilitychange']);
    assert.deepEqual(channelTarget.added, ['message']);
    assert.deepEqual(channelTarget.removed, ['message']);
    assert.deepEqual(clearedIntervals, ['heartbeat-1']);
    assert.equal(channelCloseCalls, 1);
});

test('LAN lobby session normalization preserves pending match-start commands', () => {
    const normalized = normalizeLobbySessionState({
        lobbyCode: 'LAN-LIVE',
        hostPeerId: 'host',
        members: [
            { peerId: 'host', role: 'host', ready: true },
            { peerId: 'player-1', role: 'client', ready: true },
        ],
        pendingMatchStart: {
            commandId: 'match-live',
            settingsSnapshot: {
                localSettings: {
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'lan',
                },
            },
        },
    });

    assert.equal(normalized.pendingMatchStart.commandId, 'match-live');
    assert.equal(normalized.memberCount, 2);
    assert.equal(normalized.allReady, true);
});

test('LANMatchLobby projects pending match-start status and emits it once', () => {
    const lobby = new LANMatchLobby({ signalingUrl: 'http://localhost:9090' });
    const starts = [];
    const stateCommands = [];
    const serverState = {
        sessionState: {
            lobbyCode: 'LAN-LIVE',
            hostPeerId: 'host',
            hostReady: true,
            maxPlayers: 10,
            players: [
                { playerId: 'player-1', ready: true },
            ],
            pendingMatchStart: {
                commandId: 'match-live',
                settingsSnapshot: {
                    localSettings: {
                        sessionType: 'multiplayer',
                        multiplayerTransport: 'lan',
                    },
                },
            },
        },
    };
    lobby.on('sessionStateChanged', ({ sessionState }) => {
        stateCommands.push(sessionState.pendingMatchStart?.commandId || '');
    });
    lobby.on('matchStart', ({ pendingMatchStart }) => {
        starts.push(pendingMatchStart.commandId);
    });

    lobby._processServerStatus(serverState);
    lobby._processServerStatus(serverState);

    assert.equal(lobby.sessionState.pendingMatchStart.commandId, 'match-live');
    assert.deepEqual(stateCommands.slice(-1), ['match-live']);
    assert.deepEqual(starts, ['match-live']);
});

test('NetworkLobbyService forwards pending match-start state once even without a transport event', async () => {
    const starts = [];
    const lobbies = [];
    const service = new NetworkLobbyService({
        runtime: { global: {} },
        discoveryPort: null,
        resolveJoinSignalingUrl: () => 'http://localhost:9090',
        createLobby: (signalingUrl) => {
            const lobby = new FakeNetworkLobby(signalingUrl, { localPeerId: 'player-1' });
            lobbies.push(lobby);
            return lobby;
        },
        onMatchStart: (command, state) => starts.push([command.commandId, state.role]),
    });

    await service.join({ lobbyCode: 'LAN-LIVE' });
    const lobby = lobbies[0];
    lobby.sessionState = {
        ...lobby.sessionState,
        pendingMatchStart: {
            commandId: 'match-live',
            settingsSnapshot: {
                localSettings: {
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'lan',
                },
            },
        },
    };

    lobby.handlers.get('sessionStateChanged')?.({ sessionState: lobby.sessionState });
    lobby.handlers.get('sessionStateChanged')?.({ sessionState: lobby.sessionState });

    assert.deepEqual(starts, [['match-live', 'client']]);
    assert.equal(service.getSessionState().pendingMatchCommandId, 'match-live');
});

test('V96.2 NetworkLobbyService emits lifecycle events without UI runtime helpers', async () => {
    const events = [];
    const service = new NetworkLobbyService({
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
        runtime: { global: {} },
        discoveryPort: null,
        resolveHostSignalingUrl: () => 'ws://127.0.0.1:4567',
        createLobby: (signalingUrl) => new FakeNetworkLobby(signalingUrl),
        onEvent: (event) => events.push(event),
    });

    const result = await service.host({ actorId: 'Host', maxPlayers: 2 });
    const hostReadyResult = await service.toggleReady({ actorId: 'Host', ready: false });

    assert.equal(result.ok, true);
    assert.equal(result.event.eventType, LOBBY_SERVICE_EVENT_TYPES.HOST);
    assert.equal(result.event.contractVersion, LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION);
    assert.equal(result.event.channel, 'multiplayer');
    assert.equal(result.event.payload.actorId, 'Host');
    assert.equal(result.event.payload.lobbyCode, 'LAN-QA');
    assert.equal(result.sessionState.lobbyCode, 'LAN-QA');
    assert.equal(result.sessionState.isHost, true);
    assert.equal(result.sessionState.localReady, true);
    assert.equal(hostReadyResult.sessionState.localReady, true);
    assert.equal(hostReadyResult.event, null);
    assert.equal(events.length, 1);
});

test('LAN join with explicit signalingUrl uses the manual host address without discovery', async () => {
    const calls = [];
    const service = new NetworkLobbyService({
        runtime: { global: {} },
        discoveryPort: {
            isAvailable: () => {
                calls.push(['discovery', 'isAvailable']);
                return true;
            },
            start: () => calls.push(['discovery', 'start']),
            getHosts: () => {
                calls.push(['discovery', 'getHosts']);
                return [];
            },
            stop: () => calls.push(['discovery', 'stop']),
        },
        createLobby: (signalingUrl) => {
            calls.push(['createLobby', signalingUrl]);
            return new FakeNetworkLobby(signalingUrl, { localPeerId: 'peer-client' });
        },
    });

    const result = await service.join({
        actorId: 'Client',
        lobbyCode: 'lan-qa',
        signalingUrl: 'localhost:9090',
    });

    assert.equal(result.ok, true);
    assert.equal(result.sessionState.signalingUrl, 'http://localhost:9090');
    assert.deepEqual(calls, [
        ['createLobby', 'http://localhost:9090'],
    ]);
});

test('LAN join without signalingUrl continues through discovery fallback', async () => {
    const calls = [];
    const discoveryPort = {
        isAvailable: () => {
            calls.push(['discovery', 'isAvailable']);
            return true;
        },
        start: () => calls.push(['discovery', 'start']),
        getHosts: () => {
            calls.push(['discovery', 'getHosts']);
            return [{ ip: '192.168.0.22', port: 9090, lobbyCode: 'LAN-QA', lastSeen: 100 }];
        },
        stop: () => calls.push(['discovery', 'stop']),
    };

    const resolved = await resolveDefaultJoinSignalingUrl({
        lobbyCode: 'lan-qa',
        explicitSignalingUrl: '',
        normalizeSignalingUrl,
        normalizeLobbyCode,
        tryParseManualSignalingUrl,
        discoveryPort,
        clearJoinDiscoveryIssue: () => calls.push(['issue', 'clear']),
        setJoinDiscoveryIssue: (code, message, details) => {
            calls.push(['issue', code, message, details]);
            return { code, message, details };
        },
        delay: async () => calls.push(['delay']),
        collectMatchingDiscoveryHosts: (hosts, lobbyCode) => {
            calls.push(['discovery', 'collect', lobbyCode]);
            return hosts;
        },
        selectJoinSignalingUrlFromDiscoveredHosts: async ({ hosts, lobbyCode }) => {
            calls.push(['discovery', 'select', lobbyCode, hosts.length]);
            return { signalingUrl: 'http://192.168.0.22:9090' };
        },
        runtimeGlobal: {},
    });

    assert.equal(resolved, 'http://192.168.0.22:9090');
    assert.deepEqual(calls, [
        ['discovery', 'isAvailable'],
        ['issue', 'clear'],
        ['discovery', 'start'],
        ['discovery', 'getHosts'],
        ['discovery', 'collect', 'LAN-QA'],
        ['discovery', 'select', 'LAN-QA', 1],
        ['issue', 'clear'],
        ['discovery', 'stop'],
    ]);
});

test('LAN join with malformed explicit signalingUrl reports host-address validation before discovery', async () => {
    const calls = [];
    const resolved = await resolveDefaultJoinSignalingUrl({
        lobbyCode: 'lan-qa',
        explicitSignalingUrl: 'not a host',
        normalizeSignalingUrl,
        normalizeLobbyCode,
        tryParseManualSignalingUrl,
        discoveryPort: {
            isAvailable: () => {
                calls.push(['discovery', 'isAvailable']);
                return true;
            },
            start: () => calls.push(['discovery', 'start']),
            stop: () => calls.push(['discovery', 'stop']),
        },
        clearJoinDiscoveryIssue: () => calls.push(['issue', 'clear']),
        setJoinDiscoveryIssue: (code, message, details) => {
            calls.push(['issue', code, message, details]);
            return { code, message, details };
        },
        delay: async () => calls.push(['delay']),
        collectMatchingDiscoveryHosts: () => [],
        selectJoinSignalingUrlFromDiscoveredHosts: async () => ({ signalingUrl: '' }),
        runtimeGlobal: {},
    });

    assert.equal(resolved, '');
    assert.equal(calls[0]?.[0], 'issue');
    assert.equal(calls[0]?.[1], 'manual_signaling_url_invalid');
    assert.match(calls[0]?.[2], /Host-Adresse/);
    assert.equal(calls.some(([type]) => type === 'discovery'), false);
});

test('V96.2 StorageLobbyService keeps host, join and ready mutations application-owned', () => {
    const clock = createClock();
    const sharedStorage = createMemoryStorage();
    const hostService = new StorageLobbyService({
        peerId: 'peer-host',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: createStorageRuntime(),
        now: () => clock.read(),
        random: () => 0.123456,
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
    });
    const clientService = new StorageLobbyService({
        peerId: 'peer-client',
        storage: sharedStorage,
        sessionStorage: createMemoryStorage(),
        runtime: createStorageRuntime(),
        now: () => clock.read(),
        random: () => 0.654321,
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
    });

    const hostResult = hostService.host({ actorId: 'Host', lobbyCode: 'qa-lobby' });
    clock.advance(5);
    const joinResult = clientService.join({ actorId: 'Client', lobbyCode: 'qa-lobby' });
    const readyResult = clientService.toggleReady({ actorId: 'Client', ready: true });

    hostService.dispose();
    clientService.dispose();

    assert.equal(hostResult.ok, true);
    assert.equal(hostResult.event.eventType, LOBBY_SERVICE_EVENT_TYPES.HOST);
    assert.equal(hostResult.event.contractVersion, LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION);
    assert.equal(hostResult.sessionState.isHost, true);
    assert.equal(hostResult.sessionState.localReady, true);
    assert.equal(joinResult.ok, true);
    assert.equal(joinResult.event.eventType, LOBBY_SERVICE_EVENT_TYPES.JOIN);
    assert.equal(joinResult.sessionState.role, 'client');
    assert.equal(joinResult.sessionState.memberCount, 2);
    assert.equal(readyResult.ok, true);
    assert.equal(readyResult.event.eventType, LOBBY_SERVICE_EVENT_TYPES.READY_TOGGLE);
    assert.equal(readyResult.sessionState.localReady, true);
    assert.equal(readyResult.sessionState.readyCount, 2);
});
