import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createMenuMultiplayerBridge,
    createMultiplayerMatchSettingsSnapshot,
    handleMultiplayerHostAction,
    invalidateMultiplayerReadyIfHostChangedSettings,
} from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { MATCH_SETTING_CHANGE_KEY_SET } from '../src/core/runtime/GameRuntimeSettingsKeySets.js';
import { StorageLobbyService } from '../src/application/session-runtime/StorageLobbyService.js';
import { createLobbyStorageKey } from '../src/application/session-runtime/StorageLobbyServiceSupport.js';
import { LOBBY_SERVICE_EVENT_TYPES } from '../src/shared/contracts/LobbyServiceContract.js';
import { MULTIPLAYER_TRANSPORTS, RUNTIME_SESSION_TYPES } from '../src/shared/contracts/RuntimeSessionContract.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';

// A storage lobby mutation counts as done only after the lobby key reads back exactly what this
// peer wrote. Until then nothing is projected locally, announced to other tabs or reported as a
// success. The fakes below share one value map between peers; each peer gets its own view with
// hooks, so foreign writes, dropped writes and thrown reads interleave deterministically.

const LOBBY_CODE = 'CAS-LOBBY';
const LOBBY_KEY = createLobbyStorageKey(LOBBY_CODE);
const NOW = 1_700_000_000_000;

function createSharedValues() {
    return new Map();
}

function createStorageView(values, hooks = {}) {
    return {
        hooks,
        getItem(key) {
            const normalizedKey = String(key);
            hooks.beforeGet?.(normalizedKey);
            return values.has(normalizedKey) ? values.get(normalizedKey) : null;
        },
        setItem(key, value) {
            const normalizedKey = String(key);
            const normalizedValue = String(value);
            if (hooks.beforeSet?.(normalizedKey, normalizedValue) === 'drop') return;
            values.set(normalizedKey, normalizedValue);
            hooks.afterSet?.(normalizedKey, normalizedValue);
        },
        removeItem(key) {
            const normalizedKey = String(key);
            if (hooks.beforeRemove?.(normalizedKey) === 'drop') return;
            values.delete(normalizedKey);
        },
    };
}

function createSessionStorage() {
    return createStorageView(new Map());
}

function createRuntime(channelLog) {
    const timeouts = [];
    return {
        timeouts,
        runtime: {
            global: {},
            createBroadcastChannel: () => ({
                postMessage: (message) => channelLog.push(message),
                addEventListener() {},
                removeEventListener() {},
                close() {},
            }),
            setInterval: () => 'interval',
            clearInterval() {},
            setTimeout: (fn) => {
                timeouts.push(fn);
                return `timeout-${timeouts.length}`;
            },
            clearTimeout() {},
        },
    };
}

function createPeer(values, peerId, random) {
    const broadcasts = [];
    const events = [];
    const states = [];
    const matchStarts = [];
    const hooks = {};
    const runtimeHarness = createRuntime(broadcasts);
    const service = new StorageLobbyService({
        peerId,
        storage: createStorageView(values, hooks),
        sessionStorage: createSessionStorage(),
        runtime: runtimeHarness.runtime,
        now: () => NOW,
        random: () => random,
        onEvent: (event) => events.push(event),
        onStateChanged: (state) => states.push(state),
        onMatchStart: (command) => matchStarts.push(command),
    });
    return { service, hooks, broadcasts, events, states, matchStarts, timeouts: runtimeHarness.timeouts };
}

function readStoredLobby(values) {
    const raw = values.get(LOBBY_KEY);
    return raw ? JSON.parse(raw) : null;
}

function findMember(snapshot, peerId) {
    return (snapshot?.members || []).find((member) => member.peerId === peerId) || null;
}

function dropLobbyWrites(hooks) {
    hooks.beforeSet = (key) => (key === LOBBY_KEY ? 'drop' : undefined);
}

function throwOnLobbyWrites(hooks) {
    hooks.beforeSet = (key) => {
        if (key === LOBBY_KEY) throw new Error('QuotaExceededError');
        return undefined;
    };
}

function createReadyLobby() {
    const values = createSharedValues();
    const host = createPeer(values, 'peer-host', 0.11);
    const client = createPeer(values, 'peer-client', 0.77);
    assert.equal(host.service.host({ actorId: 'Host', lobbyCode: LOBBY_CODE }).ok, true);
    assert.equal(client.service.join({ actorId: 'Client', lobbyCode: LOBBY_CODE }).ok, true);
    assert.equal(client.service.toggleReady({ ready: true }).ok, true);
    for (const peer of [host, client]) {
        peer.broadcasts.length = 0;
        peer.events.length = 0;
        peer.states.length = 0;
        peer.timeouts.length = 0;
    }
    return { values, host, client };
}

function disposeAll(...peers) {
    for (const peer of peers) {
        for (const key of Object.keys(peer.hooks)) delete peer.hooks[key];
        peer.service.dispose();
    }
}

for (const revisionOffset of [0, 1]) {
    test(`CAS rejects foreign readback content at expected revision +${revisionOffset} and retries on top of it`, () => {
        const { values, host, client } = createReadyLobby();
        try {
            const baseRevision = readStoredLobby(values).revision;
            let interfered = false;
            host.hooks.afterSet = (key) => {
                if (key !== LOBBY_KEY || interfered) return;
                interfered = true;
                const foreign = readStoredLobby(values);
                values.set(LOBBY_KEY, JSON.stringify({
                    ...foreign,
                    revision: baseRevision + 1 + revisionOffset,
                    hostSettingsSnapshot: { mapKey: 'foreign' },
                }));
            };

            const result = host.service.publishHostSettings({ mapKey: 'standard' });
            const stored = readStoredLobby(values);

            assert.equal(interfered, true);
            assert.ok(result, 'the retry on top of the foreign write succeeds');
            assert.deepEqual(stored.hostSettingsSnapshot, { mapKey: 'standard' });
            assert.deepEqual(result.hostSettingsSnapshot, stored.hostSettingsSnapshot, 'result must match storage');
            assert.equal(result.revision, stored.revision);
            assert.equal(stored.revision, baseRevision + 2 + revisionOffset);
            assert.deepEqual(host.broadcasts.map((message) => message.revision), [stored.revision]);
        } finally {
            disposeAll(host, client);
        }
    });
}

test('CAS reports a failure when every readback shows foreign content', () => {
    const { values, host, client } = createReadyLobby();
    try {
        host.hooks.afterSet = (key) => {
            if (key !== LOBBY_KEY) return;
            const foreign = readStoredLobby(values);
            values.set(LOBBY_KEY, JSON.stringify({ ...foreign, hostSettingsSnapshot: { mapKey: 'foreign' } }));
        };

        const result = host.service.publishHostSettings({ mapKey: 'standard' });

        assert.equal(result?.ok, false);
        assert.equal(result?.code, 'host_settings_persist_failed');
        assert.equal(host.broadcasts.length, 0);
        assert.deepEqual(readStoredLobby(values).hostSettingsSnapshot, { mapKey: 'foreign' });
        assert.deepEqual(host.service.getSnapshot().hostSettingsSnapshot, { mapKey: 'foreign' },
            'the stored foreign state may still be projected as read state');
    } finally {
        disposeAll(host, client);
    }
});

test('dropped lobby writes fail hosting without local projection or broadcasts', () => {
    const values = createSharedValues();
    const host = createPeer(values, 'peer-host', 0.11);
    dropLobbyWrites(host.hooks);
    try {
        const result = host.service.host({ actorId: 'Host', lobbyCode: LOBBY_CODE });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'lobby_persist_failed');
        assert.equal(host.broadcasts.length, 0);
        assert.equal(host.states.some((state) => state.joined === true), false);
        assert.equal(host.events.some((event) => event.eventType === LOBBY_SERVICE_EVENT_TYPES.HOST), false);
        assert.equal(values.has(LOBBY_KEY), false);
    } finally {
        disposeAll(host);
    }
});

test('thrown lobby writes fail join and ready without success events', () => {
    const { values, host, client } = createReadyLobby();
    const late = createPeer(values, 'peer-late', 0.55);
    try {
        throwOnLobbyWrites(late.hooks);
        const joinResult = late.service.join({ actorId: 'Late', lobbyCode: LOBBY_CODE });
        assert.equal(joinResult.ok, false);
        assert.equal(joinResult.code, 'join_persist_failed');
        assert.equal(late.broadcasts.length, 0);
        assert.equal(late.states.some((state) => state.joined === true), false);

        throwOnLobbyWrites(client.hooks);
        const readyResult = client.service.toggleReady({ ready: false });
        assert.equal(readyResult.ok, false);
        assert.equal(readyResult.code, 'ready_persist_failed');
        assert.equal(client.broadcasts.length, 0);
        assert.equal(client.events.some((event) => event.eventType === LOBBY_SERVICE_EVENT_TYPES.READY_TOGGLE), false);
        assert.equal(client.states.some((state) => state.localReady === false), false);
        assert.equal(findMember(readStoredLobby(values), 'peer-client')?.ready, true);
    } finally {
        disposeAll(host, client, late);
    }
});

test('dropped match-start writes never project, announce or schedule an unconfirmed command', () => {
    const { values, host, client } = createReadyLobby();
    try {
        dropLobbyWrites(host.hooks);
        const result = host.service.requestMatchStart({ settingsSnapshot: { mapKey: 'standard' } });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'match_start_conflict');
        assert.deepEqual(host.matchStarts, []);
        assert.equal(host.events.some((event) => event.eventType === LOBBY_SERVICE_EVENT_TYPES.MATCH_START), false);
        assert.equal(host.broadcasts.length, 0);
        assert.equal(host.timeouts.length, 0, 'no pending-command clear is scheduled');
        assert.equal(host.states.some((state) => state.pendingMatchCommandId), false);
        assert.equal(readStoredLobby(values).pendingMatchStart, null);
    } finally {
        disposeAll(host, client);
    }
});

test('a failed read never lets host() overwrite an existing foreign lobby', () => {
    const { values, host, client } = createReadyLobby();
    const intruder = createPeer(values, 'peer-intruder', 0.33);
    const before = values.get(LOBBY_KEY);
    intruder.hooks.beforeGet = (key) => {
        if (key === LOBBY_KEY) throw new Error('SecurityError');
    };
    try {
        const result = intruder.service.host({ actorId: 'Intruder', lobbyCode: LOBBY_CODE });

        assert.equal(result.ok, false);
        assert.equal(values.get(LOBBY_KEY), before, 'stored lobby is untouched');
        assert.equal(intruder.broadcasts.length, 0);
    } finally {
        delete intruder.hooks.beforeGet;
        disposeAll(host, client, intruder);
    }
});

for (const deleteMode of ['dropped', 'thrown']) {
    test(`${deleteMode} lobby deletes are not announced even when the readback throws`, () => {
        const { values, host, client } = createReadyLobby();
        let removeAttempted = false;
        host.hooks.beforeRemove = (key) => {
            if (key !== LOBBY_KEY) return undefined;
            removeAttempted = true;
            if (deleteMode === 'thrown') throw new Error('removeItem failed');
            return 'drop';
        };
        host.hooks.beforeGet = (key) => {
            if (key === LOBBY_KEY && removeAttempted) throw new Error('getItem failed');
        };
        try {
            host.service.leave({ silent: true });

            assert.equal(removeAttempted, true);
            assert.equal(values.has(LOBBY_KEY), true);
            assert.deepEqual(host.broadcasts, []);
        } finally {
            disposeAll(host, client);
        }
    });
}

test('a deleted lobby whose raw value stays behind is not confirmed, a real delete is', () => {
    const { values, host, client } = createReadyLobby();
    try {
        host.hooks.beforeRemove = (key) => {
            if (key !== LOBBY_KEY) return undefined;
            values.set(LOBBY_KEY, '{broken');
            return 'drop';
        };
        host.service.leave({ silent: true });
        assert.equal(values.get(LOBBY_KEY), '{broken');
        assert.deepEqual(host.broadcasts, []);

        const second = createReadyLobby();
        second.host.service.leave({ silent: true });
        assert.equal(second.values.has(LOBBY_KEY), false);
        assert.deepEqual(second.host.broadcasts.map((message) => [message.reason, message.revision]), [['leave', 0]]);
        disposeAll(second.host, second.client);
    } finally {
        disposeAll(host, client);
    }
});

test('a single failed first read is retried without touching the foreign lobby', () => {
    const { values, host, client } = createReadyLobby();
    const intruder = createPeer(values, 'peer-intruder', 0.33);
    const before = values.get(LOBBY_KEY);
    let failedReads = 0;
    intruder.hooks.beforeGet = (key) => {
        if (key === LOBBY_KEY && failedReads === 0) {
            failedReads += 1;
            throw new Error('SecurityError');
        }
    };
    try {
        const result = intruder.service.host({ actorId: 'Intruder', lobbyCode: LOBBY_CODE });

        assert.equal(failedReads, 1);
        assert.equal(result.code, 'lobby_taken');
        assert.equal(values.get(LOBBY_KEY), before);
        assert.equal(intruder.broadcasts.length, 0);
    } finally {
        disposeAll(host, client, intruder);
    }
});

function throwOnceAfterEachLobbyWrite(hooks) {
    let throwNextRead = false;
    hooks.afterSet = (key) => {
        if (key === LOBBY_KEY) throwNextRead = true;
    };
    hooks.beforeGet = (key) => {
        if (key === LOBBY_KEY && throwNextRead) {
            throwNextRead = false;
            throw new Error('getItem failed');
        }
    };
}

test('a landed write with a thrown readback is confirmed on the next attempt instead of reapplied', () => {
    const { values, host, client } = createReadyLobby();
    const storedCommandIds = [];
    try {
        throwOnceAfterEachLobbyWrite(host.hooks);
        const afterSet = host.hooks.afterSet;
        host.hooks.afterSet = (key, value) => {
            afterSet(key, value);
            if (key === LOBBY_KEY) storedCommandIds.push(JSON.parse(value).pendingMatchStart?.commandId || '');
        };

        const result = host.service.requestMatchStart({ settingsSnapshot: { mapKey: 'standard' } });

        assert.equal(result.ok, true);
        assert.equal(storedCommandIds.length, 1, 'the mutation is written once');
        assert.equal(readStoredLobby(values).pendingMatchStart.commandId, result.commandId);
        assert.deepEqual(host.broadcasts.map((message) => message.reason), ['match_start']);
        assert.equal(host.timeouts.length, 1, 'the pending-command clear is scheduled');
        assert.deepEqual(host.matchStarts.map((command) => command.commandId), [result.commandId]);

        throwOnceAfterEachLobbyWrite(client.hooks);
        const toggled = client.service.toggleReady();
        assert.equal(toggled.ok, true);
        assert.equal(toggled.ready, false);
        assert.equal(findMember(readStoredLobby(values), 'peer-client')?.ready, false, 'the toggle is not applied twice');
    } finally {
        disposeAll(host, client);
    }
});

test('a lost host-settings write is reported as an explicit failure', () => {
    const { values, host, client } = createReadyLobby();
    const statuses = [];
    host.service.onStatus = (message) => statuses.push(message);
    try {
        dropLobbyWrites(host.hooks);
        const result = host.service.publishHostSettings({ mapKey: 'lost' });

        assert.equal(result?.ok, false);
        assert.equal(result?.code, 'host_settings_persist_failed');
        assert.equal(statuses.length, 1);
        assert.equal(readStoredLobby(values).hostSettingsSnapshot ?? null, null);
    } finally {
        disposeAll(host, client);
    }
});

test('ready invalidation without a ready client stays a no-op while another tab holds the lock', () => {
    const values = createSharedValues();
    const host = createPeer(values, 'peer-host', 0.11);
    try {
        assert.equal(host.service.host({ actorId: 'Host', lobbyCode: LOBBY_CODE }).ok, true);
        values.set(`${LOBBY_KEY}.lock`, JSON.stringify({ ownerToken: 'foreign:tab', expiresAt: NOW + 60_000 }));

        assert.equal(host.service.invalidateReadyForAll('host_settings_changed'), null);
    } finally {
        values.delete(`${LOBBY_KEY}.lock`);
        disposeAll(host);
    }
});

test('semantically equal host settings keep revision, readiness and the broadcast channel untouched', () => {
    const { values, host, client } = createReadyLobby();
    try {
        assert.ok(host.service.publishHostSettings({ mapKey: 'maze', rules: { bots: 2, teams: false } }));
        const revision = readStoredLobby(values).revision;
        host.broadcasts.length = 0;

        const result = host.service.publishHostSettings({ rules: { teams: false, bots: 2 }, mapKey: 'maze' });

        assert.ok(result);
        assert.equal(readStoredLobby(values).revision, revision);
        assert.equal(host.broadcasts.length, 0);
        assert.equal(findMember(readStoredLobby(values), 'peer-client')?.ready, true);
    } finally {
        disposeAll(host, client);
    }
});

test('two peers: a host mutation blocked by the client lease fails instead of returning the old snapshot', () => {
    const { values, host, client } = createReadyLobby();
    const before = readStoredLobby(values);
    let hostPublish;
    client.hooks.afterSet = (key) => {
        if (key !== LOBBY_KEY || hostPublish !== undefined) return;
        hostPublish = host.service.publishHostSettings({ mapKey: 'during-client-write' });
    };
    try {
        const readyResult = client.service.toggleReady({ ready: false });
        const stored = readStoredLobby(values);

        assert.equal(readyResult.ok, true);
        assert.equal(hostPublish?.ok, false, 'blocked by the client lease, reported instead of the old snapshot');
        assert.equal(hostPublish?.code, 'host_settings_persist_failed');
        assert.equal(host.broadcasts.length, 0);
        assert.equal(stored.revision, before.revision + 1);
        assert.deepEqual(stored.hostSettingsSnapshot, before.hostSettingsSnapshot);
        assert.equal(findMember(stored, 'peer-client')?.ready, false);
        assert.deepEqual(client.broadcasts.map((message) => message.reason), ['ready_toggle']);
    } finally {
        disposeAll(host, client);
    }
});

test('host readiness invalidation returns the explicit failure when the write is lost', async () => {
    const { values, host, client } = createReadyLobby();
    const notifications = [];
    try {
        dropLobbyWrites(host.hooks);
        const result = await invalidateMultiplayerReadyIfHostChangedSettings({
            changedKeys: [SETTINGS_CHANGE_KEYS.BOTS_COUNT],
            matchSettingChangeKeySet: MATCH_SETTING_CHANGE_KEY_SET,
            resolveMenuAccessContext: () => ({ isOwner: true }),
            menuMultiplayerBridge: host.service,
            game: null,
            onSettingsChanged: (payload) => notifications.push(payload),
            settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        });

        assert.equal(result?.ok, false);
        assert.equal(result?.code, 'ready_invalidation_failed');
        assert.deepEqual(notifications, []);
        assert.equal(host.events.some((event) => event.eventType === LOBBY_SERVICE_EVENT_TYPES.READY_INVALIDATED), false);
        assert.equal(host.broadcasts.length, 0);
        assert.equal(findMember(readStoredLobby(values), 'peer-client')?.ready, true);
    } finally {
        disposeAll(host, client);
    }
});

test('storage-bridge host publishes the settings captured after the awaited host call', async () => {
    const previousAppMarker = globalThis.__CURVIOS_APP__;
    globalThis.__CURVIOS_APP__ = true;
    const hostBridge = createMenuMultiplayerBridge({
        transport: MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE,
        peerId: 'peer-host',
        storage: createStorageView(createSharedValues()),
        sessionStorage: createSessionStorage(),
        runtime: createRuntime([]).runtime,
        now: () => NOW,
    });
    const game = {
        settings: {
            gameMode: 'CLASSIC',
            mapKey: 'maze',
            localSettings: {
                sessionType: RUNTIME_SESSION_TYPES.SINGLE,
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
                modePath: 'normal',
            },
        },
        ui: {},
    };
    const captured = [];
    const captureSettingsSnapshot = () => {
        const snapshot = createMultiplayerMatchSettingsSnapshot(game.settings);
        captured.push(snapshot);
        return snapshot;
    };
    try {
        const result = await handleMultiplayerHostAction({
            game,
            event: { lobbyCode: LOBBY_CODE },
            resolveMenuAccessContext: () => ({ actorId: 'Host' }),
            menuMultiplayerBridge: hostBridge,
            captureSettingsSnapshot,
        });

        assert.equal(result.ok, true);
        assert.equal(captured.length, 2, 'settings are captured again after the awaited host call');
        assert.equal(captured[0].localSettings.multiplayerTransport, MULTIPLAYER_TRANSPORTS.LAN);
        assert.equal(captured[1].localSettings.multiplayerTransport, MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE);
        assert.deepEqual(hostBridge.getSnapshot().hostSettingsSnapshot, captured[1]);
    } finally {
        hostBridge.dispose();
        if (typeof previousAppMarker === 'undefined') delete globalThis.__CURVIOS_APP__;
        else globalThis.__CURVIOS_APP__ = previousAppMarker;
    }
});
