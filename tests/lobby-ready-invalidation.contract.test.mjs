import assert from 'node:assert/strict';
import test from 'node:test';

import { invalidateMultiplayerReadyIfHostChangedSettings } from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { MATCH_SETTING_CHANGE_KEY_SET } from '../src/core/runtime/GameRuntimeSettingsKeySets.js';
import { StorageLobbyService } from '../src/application/session-runtime/StorageLobbyService.js';
import { createLobbyStorageKey } from '../src/application/session-runtime/StorageLobbyServiceSupport.js';
import { LOBBY_SERVICE_EVENT_TYPES } from '../src/shared/contracts/LobbyServiceContract.js';
import { LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION } from '../src/shared/contracts/LobbyLifecycleEventContract.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';

/**
 * Replaces the Playwright test T75 ("Host-Settings invalidieren Ready-Status per Event-Contract",
 * formerly tests/stress.spec.js, cluster gpu-stress), which could not hold its promise in Electron:
 *
 * - A second lobby member needs a second tab, and Electron refuses `context.newPage()`
 *   ("Target.createTarget: Not supported"), so T75 ran with the host alone.
 * - Without `__CURVIOS_E2E_LOBBY_TRANSPORT__` the desktop app picks the LAN transport
 *   (PlatformCapabilityData.js:72 `defaultLobbyTransport`). The LAN service declares
 *   `handlesSettingsReadiness = true` (NetworkLobbyService.js:96), so the runtime step below
 *   returns early (MenuRuntimeMultiplayerService.js:282) and the LAN path resets readiness through
 *   the transport alone (NetworkLobbySettingsPublisher.js:34-36) — `multiplayer_ready_invalidated`
 *   is never emitted there. That gap is a product finding of its own, not something these tests fix.
 *
 * The storage-bridge path does emit the event, and it is reachable from node end to end, so the
 * statement T75 wanted to make lives here now: the runtime entry point that reacts to a host
 * settings change (`invalidateMultiplayerReadyIfHostChangedSettings`, called from
 * GameRuntimeSettingsHandler.js:69) drives a real lobby service pair over one shared storage.
 *
 * `bots.count` is the key the bot-count slider of T75 produces (MenuGameplayBindings.js:120), and it
 * is part of MATCH_SETTING_CHANGE_KEY_SET (GameRuntimeSettingsKeySets.js:11).
 *
 * The emitted event carries `eventType`; Game._handleMenuLifecycleEvent (main.js:366-368) records it
 * as `type`, which is the field T75 read back through `getMenuLifecycleEvents()`.
 */

const LOBBY_CODE = 'qa-lobby';
const BOT_COUNT_CHANGE_KEYS = [SETTINGS_CHANGE_KEYS.BOTS_COUNT];

test('every team rule invalidates multiplayer readiness', () => {
    for (const key of [
        SETTINGS_CHANGE_KEYS.HUNT_TEAM_MODE,
        SETTINGS_CHANGE_KEYS.HUNT_TEAM_OBJECTIVE,
        SETTINGS_CHANGE_KEYS.HUNT_TEAM_SIZE,
        SETTINGS_CHANGE_KEYS.HUNT_TEAM_BOT_DIFFICULTY,
    ]) {
        assert.equal(MATCH_SETTING_CHANGE_KEY_SET.has(key), true, key);
    }
});

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

function createEventTarget() {
    const handlers = new Map();
    return {
        addEventListener(type, handler) {
            handlers.set(type, handler);
        },
        removeEventListener(type) {
            handlers.delete(type);
        },
        dispatch(type, event) {
            handlers.get(type)?.(event);
        },
    };
}

function createStorageRuntime(eventTarget = null) {
    const intervals = new Map();
    const timeouts = new Map();
    let cursor = 0;
    return {
        global: {},
        eventTarget,
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

function createLobbyMember({ peerId, clock, storage, events = null, eventTarget = null, random = 0.123456 }) {
    return new StorageLobbyService({
        peerId,
        storage,
        sessionStorage: createMemoryStorage(),
        runtime: createStorageRuntime(eventTarget),
        now: () => clock.read(),
        random: () => random,
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
        onEvent: (event) => events?.push(event),
    });
}

function findMember(snapshot, peerId) {
    return (snapshot?.members || []).find((member) => member.peerId === peerId) || null;
}

test('host match change invalidates a ready client and emits the ready-invalidated lifecycle event', async () => {
    const clock = createClock();
    const sharedStorage = createMemoryStorage();
    const hostEvents = [];
    const clientEventTarget = createEventTarget();
    const hostService = createLobbyMember({
        peerId: 'peer-host',
        clock,
        storage: sharedStorage,
        events: hostEvents,
    });
    const clientService = createLobbyMember({
        peerId: 'peer-client',
        clock,
        storage: sharedStorage,
        eventTarget: clientEventTarget,
        random: 0.654321,
    });
    const settingsChangeNotifications = [];

    try {
        const hostResult = hostService.host({ actorId: 'Host', lobbyCode: LOBBY_CODE });
        assert.equal(hostResult.sessionState.joined, true);
        assert.equal(hostResult.sessionState.isHost, true);
        clock.advance(5);
        clientService.join({ actorId: 'Client', lobbyCode: LOBBY_CODE });
        const readyResult = clientService.toggleReady({ actorId: 'Client', ready: true });
        assert.equal(readyResult.sessionState.localReady, true);
        assert.equal(readyResult.sessionState.readyCount, 2);

        const invalidation = await invalidateMultiplayerReadyIfHostChangedSettings({
            changedKeys: BOT_COUNT_CHANGE_KEYS,
            matchSettingChangeKeySet: MATCH_SETTING_CHANGE_KEY_SET,
            resolveMenuAccessContext: () => ({ isOwner: true }),
            menuMultiplayerBridge: hostService,
            game: null,
            onSettingsChanged: (payload) => settingsChangeNotifications.push(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });

        // The assertion T75 made: the lifecycle contract carries the invalidation.
        assert.equal(invalidation?.ok, true);
        assert.equal(invalidation.event.eventType, 'multiplayer_ready_invalidated');
        assert.equal(invalidation.event.eventType, LOBBY_SERVICE_EVENT_TYPES.READY_INVALIDATED);
        assert.equal(invalidation.event.contractVersion, 'lifecycle.v1');
        assert.equal(invalidation.event.contractVersion, LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION);
        assert.equal(invalidation.event.payload.reason, 'host_settings_changed');
        assert.equal(invalidation.event.payload.lobbyCode, 'QA-LOBBY');

        // The runtime listener that Game._handleMenuLifecycleEvent is wired to sees the same event.
        assert.deepEqual(
            hostEvents.map((event) => event.eventType),
            ['multiplayer_host', 'multiplayer_ready_invalidated']
        );

        // The menu is told to refresh the multiplayer status after the invalidation.
        assert.deepEqual(settingsChangeNotifications, [{ changedKeys: [SETTINGS_CHANGE_KEYS.MULTIPLAYER_STATUS] }]);

        // The client is not ready any more, the host stays ready.
        assert.equal(findMember(invalidation.snapshot, 'peer-client')?.ready, false);
        assert.equal(findMember(invalidation.snapshot, 'peer-host')?.ready, true);
        assert.equal(invalidation.sessionState.readyCount, 1);
        assert.equal(invalidation.sessionState.memberCount, 2);
        assert.equal(invalidation.sessionState.localReady, true);

        // And the client sees it once the shared storage change reaches it.
        clientEventTarget.dispatch('storage', { key: createLobbyStorageKey(LOBBY_CODE) });
        const clientState = clientService.getSessionState();
        assert.equal(clientState.localReady, false);
        assert.equal(clientState.readyCount, 1);
    } finally {
        hostService.dispose();
        clientService.dispose();
    }
});

test('host match change without a ready client emits nothing and keeps the host ready', async () => {
    const clock = createClock();
    const sharedStorage = createMemoryStorage();
    const hostEvents = [];
    const hostService = createLobbyMember({
        peerId: 'peer-host',
        clock,
        storage: sharedStorage,
        events: hostEvents,
    });
    const settingsChangeNotifications = [];

    try {
        const hostResult = hostService.host({ actorId: 'Host', lobbyCode: LOBBY_CODE });
        assert.equal(hostResult.sessionState.joined, true);
        assert.equal(hostResult.sessionState.isHost, true);
        assert.equal(hostResult.sessionState.localReady, true);
        assert.equal(hostResult.sessionState.memberCount, 1);

        const invalidation = await invalidateMultiplayerReadyIfHostChangedSettings({
            changedKeys: BOT_COUNT_CHANGE_KEYS,
            matchSettingChangeKeySet: MATCH_SETTING_CHANGE_KEY_SET,
            resolveMenuAccessContext: () => ({ isOwner: true }),
            menuMultiplayerBridge: hostService,
            game: null,
            onSettingsChanged: (payload) => settingsChangeNotifications.push(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });

        // Deliberate since 70f76d36: the host is always ready, so resetting its own flag would
        // only produce a pointless toast (main.js:405) without a single other member to warn.
        assert.equal(invalidation, null);
        assert.deepEqual(hostEvents.map((event) => event.eventType), ['multiplayer_host']);
        assert.deepEqual(settingsChangeNotifications, []);

        const hostState = hostService.getSessionState();
        assert.equal(hostState.localReady, true);
        assert.equal(hostState.readyCount, 1);
    } finally {
        hostService.dispose();
    }
});
