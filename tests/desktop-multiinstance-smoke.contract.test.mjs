/**
 * Desktop Multi-Instance Smoke Contract Tests (V64 64.8.2)
 *
 * Focused characterization of the Host / Join / Start / Disconnect protocol
 * at the contract layer.  Actual Electron multi-process execution requires
 * Playwright; that path is blocked by P24 (spawn EPERM on Windows) and is
 * deferred to the 64.99 closure gate once the harness blocker is resolved.
 *
 * Covered scenarios:
 *   1. Host role: signaling commands, host-authoritative messages, role map
 *   2. Join/client role: client-only messages, join signaling contract
 *   3. Match start sequence: PLAYER_ARENA_LOADED -> ROUND_START_GATE protocol
 *   4. Disconnect / lifecycle kernel: attach, hostDisconnected, match_finalized, detach
 *   5. Cross-instance consistency: signaling routes, leave symmetry
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MULTIPLAYER_MESSAGE_TYPES,
    MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES,
    MULTIPLAYER_HOST_AUTHORITATIVE_MESSAGE_TYPES,
    MULTIPLAYER_CLIENT_ONLY_MESSAGE_TYPES,
    isHostAuthoritativeMessageType,
    isClientOnlyMessageType,
    buildMultiplayerSessionMessage,
    isMultiplayerMessageType,
} from '../src/shared/contracts/MultiplayerSessionContract.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    SIGNALING_COMMAND_ROLE_MAP,
    SIGNALING_HTTP_ROUTES,
    resolveSignalingCommandRole,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';
import {
    MULTIPLAYER_SESSION_ROLES,
    RUNTIME_SESSION_TYPES,
    resolveRuntimeSessionCapabilities,
} from '../src/shared/contracts/RuntimeSessionContract.js';
import {
    attachMultiplayerLifecycleKernel,
    detachMultiplayerLifecycleKernel,
} from '../src/core/runtime/MultiplayerMatchLifecycleKernel.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

// ── stubs ─────────────────────────────────────────────────────────────────────

function createMinimalSession() {
    const listeners = new Map();
    return {
        on(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        off(event, handler) {
            const list = listeners.get(event);
            if (!list) return;
            const idx = list.indexOf(handler);
            if (idx >= 0) list.splice(idx, 1);
        },
        emit(event, data) {
            for (const h of listeners.get(event) ?? []) h(data);
        },
        listenerCount(event) {
            return (listeners.get(event) ?? []).length;
        },
    };
}

function createMinimalFacade(gameState = GAME_STATE_IDS.PLAYING) {
    const calls = [];
    const facade = {
        game: { state: gameState },
        _pendingMatchFinalize: false,
        returnToMenu(opts) {
            calls.push(opts);
        },
        calls,
    };
    return facade;
}

// ── 1. Host role: signaling commands and host-authoritative messages ───────────

test('64.8.2 host: CREATE_LOBBY signaling command is host-only', () => {
    assert.equal(
        resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.CREATE_LOBBY),
        'host'
    );
    assert.equal(SIGNALING_COMMAND_ROLE_MAP[SIGNALING_COMMAND_TYPES.CREATE_LOBBY], 'host');
});

test('64.8.2 host: ANSWER signaling command is host-only (host replies to client offer)', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.ANSWER), 'host');
});

test('64.8.2 host: MATCH_LIFECYCLE_SIGNAL is host-authoritative', () => {
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL));
    assert.ok(MULTIPLAYER_HOST_AUTHORITATIVE_MESSAGE_TYPES.has(MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL));
});

test('64.8.2 host: ROUND_START_GATE is host-authoritative', () => {
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE));
});

test('64.8.2 host: FULL_STATE_SYNC and STATE_SNAPSHOT are host-authoritative', () => {
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.FULL_STATE_SYNC));
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT));
});

test('64.8.2 host: HOST_LEAVING and PLAYER_DISCONNECTED are host-authoritative', () => {
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING));
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.PLAYER_DISCONNECTED));
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.PLAYER_RECONNECTED));
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.PLAYER_REMOVED));
});

test('64.8.2 host: LAN host has canHost=true and isNetworkSession=true', () => {
    const caps = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.LAN,
        multiplayerSessionRole: MULTIPLAYER_SESSION_ROLES.HOST,
    });
    assert.equal(caps.canHost, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.isLegacyTransport, false);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.LAN);
});

// ── 2. Join / client role: client-only messages and join signaling ─────────────

test('64.8.2 join: JOIN_LOBBY signaling command is client-only', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.JOIN_LOBBY), 'client');
});

test('64.8.2 join: OFFER signaling command is client-only (client initiates WebRTC)', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.OFFER), 'client');
});

test('64.8.2 join: JOIN message type is client-only', () => {
    assert.ok(isClientOnlyMessageType(MULTIPLAYER_MESSAGE_TYPES.JOIN));
    assert.ok(MULTIPLAYER_CLIENT_ONLY_MESSAGE_TYPES.has(MULTIPLAYER_MESSAGE_TYPES.JOIN));
});

test('64.8.2 join: RECONNECT message type is client-only', () => {
    assert.ok(isClientOnlyMessageType(MULTIPLAYER_MESSAGE_TYPES.RECONNECT));
});

test('64.8.2 join: client-only types are not host-authoritative', () => {
    for (const type of MULTIPLAYER_CLIENT_ONLY_MESSAGE_TYPES) {
        assert.ok(
            !isHostAuthoritativeMessageType(type),
            `${type} must not be host-authoritative`
        );
    }
});

test('64.8.2 join: LAN client has canJoin=true and isNetworkSession=true', () => {
    const caps = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.LAN,
        multiplayerSessionRole: MULTIPLAYER_SESSION_ROLES.CLIENT,
    });
    assert.equal(caps.canJoin, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.LAN);
});

// ── 3. Match start sequence: arena loaded -> round start gate ──────────────────

test('64.8.2 start: PLAYER_ARENA_LOADED is NOT host-authoritative (clients send it)', () => {
    assert.ok(!isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED));
    assert.ok(!isClientOnlyMessageType(MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED));
});

test('64.8.2 start: ROUND_START_GATE is valid multiplayer message type', () => {
    assert.ok(isMultiplayerMessageType(MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE));
    assert.ok(isHostAuthoritativeMessageType(MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE));
});

test('64.8.2 start: MATCH_LIFECYCLE_SIGNAL envelope includes match_finalized signal type', () => {
    assert.equal(
        MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED,
        'match_finalized'
    );
    const envelope = buildMultiplayerSessionMessage(
        MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL,
        { signal: MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED }
    );
    assert.equal(envelope.type, MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL);
    assert.equal(envelope.signal, MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED);
});

test('64.8.2 start: signaling lobby-create HTTP route exists', () => {
    assert.equal(typeof SIGNALING_HTTP_ROUTES.LOBBY_CREATE, 'string');
    assert.ok(SIGNALING_HTTP_ROUTES.LOBBY_CREATE.startsWith('/'));
    assert.equal(typeof SIGNALING_HTTP_ROUTES.LOBBY_JOIN, 'string');
    assert.equal(typeof SIGNALING_HTTP_ROUTES.LOBBY_MATCH_START, 'string');
});

// ── 4. Disconnect / lifecycle kernel ──────────────────────────────────────────

test('64.8.2 disconnect: attachMultiplayerLifecycleKernel returns handlers for valid session+facade', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade();
    const handlers = attachMultiplayerLifecycleKernel(facade, session);

    assert.ok(handlers !== null);
    assert.equal(typeof handlers.onHostDisconnected, 'function');
    assert.equal(typeof handlers.onMatchLifecycleSignal, 'function');
});

test('64.8.2 disconnect: kernel reacts to hostDisconnected by calling facade.returnToMenu', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade(GAME_STATE_IDS.PLAYING);
    attachMultiplayerLifecycleKernel(facade, session);

    session.emit('hostDisconnected');

    assert.equal(facade.calls.length, 1);
    assert.equal(facade.calls[0].reason, 'host_disconnected');
});

test('64.8.2 disconnect: kernel reacts to match_finalized lifecycle signal by calling facade.returnToMenu', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade(GAME_STATE_IDS.PLAYING);
    attachMultiplayerLifecycleKernel(facade, session);

    session.emit('matchLifecycleSignal', { signal: MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED });

    assert.equal(facade.calls.length, 1);
    assert.equal(facade.calls[0].reason, 'host_match_finalized');
});

test('64.8.2 disconnect: kernel ignores unknown lifecycle signals', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade(GAME_STATE_IDS.PLAYING);
    attachMultiplayerLifecycleKernel(facade, session);

    session.emit('matchLifecycleSignal', { signal: 'some_other_signal' });

    assert.equal(facade.calls.length, 0);
});

test('64.8.2 disconnect: kernel does not fire returnToMenu if game is already in menu', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade(GAME_STATE_IDS.MENU);
    attachMultiplayerLifecycleKernel(facade, session);

    session.emit('hostDisconnected');

    assert.equal(facade.calls.length, 0, 'returnToMenu must not be called when already in menu');
});

test('64.8.2 disconnect: detachMultiplayerLifecycleKernel removes both handlers', () => {
    const session = createMinimalSession();
    const facade = createMinimalFacade(GAME_STATE_IDS.PLAYING);
    const handlers = attachMultiplayerLifecycleKernel(facade, session);

    detachMultiplayerLifecycleKernel(session, handlers);

    session.emit('hostDisconnected');
    session.emit('matchLifecycleSignal', { signal: MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED });

    assert.equal(facade.calls.length, 0, 'no calls after detach');
});

// ── 5. Cross-instance consistency ─────────────────────────────────────────────

test('64.8.2 consistency: LEAVE signaling command is valid for both host and client', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.LEAVE), 'both');
});

test('64.8.2 consistency: ICE signaling command is valid for both (star topology)', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.ICE), 'both');
});

test('64.8.2 consistency: READY signaling command is valid for both host and client', () => {
    assert.equal(resolveSignalingCommandRole(SIGNALING_COMMAND_TYPES.READY), 'both');
});

test('64.8.2 consistency: createSignalingEnvelope wraps lobby-join with correct version', () => {
    const envelope = createSignalingEnvelope(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: 'ABC1' });
    assert.equal(envelope.type, SIGNALING_COMMAND_TYPES.JOIN_LOBBY);
    assert.equal(envelope.lobbyCode, 'ABC1');
    assert.equal(typeof envelope.contractVersion, 'string');
    assert.ok(envelope.contractVersion.startsWith('signaling-session'));
});

test('64.8.2 consistency: online host and LAN host have symmetric canHost/canJoin caps', () => {
    const lan = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.LAN,
        multiplayerSessionRole: MULTIPLAYER_SESSION_ROLES.HOST,
    });
    const online = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.ONLINE,
        multiplayerSessionRole: MULTIPLAYER_SESSION_ROLES.HOST,
    });

    assert.equal(lan.canHost, online.canHost);
    assert.equal(lan.canJoin, online.canJoin);
    assert.equal(lan.isNetworkSession, online.isNetworkSession);
    assert.equal(lan.isLegacyTransport, online.isLegacyTransport);
});

test('64.8.2 consistency: LOBBY_STATUS and DISCOVERY_INFO HTTP routes are available for diagnostics', () => {
    assert.equal(typeof SIGNALING_HTTP_ROUTES.LOBBY_STATUS, 'string');
    assert.equal(typeof SIGNALING_HTTP_ROUTES.DISCOVERY_INFO, 'string');
    assert.equal(SIGNALING_HTTP_ROUTES.DISCOVERY_INFO, '/discovery/info');
});
