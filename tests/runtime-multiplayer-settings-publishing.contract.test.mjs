import assert from 'node:assert/strict';
import test from 'node:test';

import { requestNetworkLobbyMatchStart } from '../src/application/session-runtime/NetworkLobbyMutationActions.js';
import { syncRuntimeMultiplayerContext } from '../src/core/runtime/RuntimeMultiplayerFlowService.js';

test('multiplayer publishes snapshots for settings outside the legacy match key list', () => {
    const published = [];
    const game = {
        settings: { localSettings: { sessionType: 'multiplayer' } },
        playerProfileManager: { getActiveProfile: () => ({ id: 'host' }) },
    };
    const bridge = {
        syncActorIdentity: () => {},
        publishHostSettings: (snapshot) => published.push(snapshot),
    };
    syncRuntimeMultiplayerContext({
        game,
        changedKeys: ['gameplay.nextCheckpointGlowIntensity'],
        menuMultiplayerBridge: bridge,
        captureSettingsSnapshot: () => ({ gameplay: { nextCheckpointGlowIntensity: 0.8 } }),
    });
    assert.deepEqual(published, [{ gameplay: { nextCheckpointGlowIntensity: 0.8 } }]);
});

test('a stale host snapshot starts a settings transfer instead of remaining blocked', () => {
    const published = [];
    let starts = 0;
    const sessionState = {
        joined: true, isHost: true, settingsRevision: 2,
        settingsSyncPending: false, settingsSyncError: '', memberCount: 2, allReady: true,
    };
    const service = {
        _hostSettingsSnapshot: { mapKey: 'old' },
        _transportSession: {
            hasLobby: () => true,
            startMatch: () => { starts += 1; },
        },
        getSessionState: () => sessionState,
        publishHostSettings: (snapshot) => { published.push(snapshot); return Promise.resolve({ ok: true }); },
        _fail: (message, code) => ({ ok: false, message, code }),
    };
    const snapshot = { mapKey: 'new' };
    const result = requestNetworkLobbyMatchStart(service, { settingsSnapshot: snapshot });
    assert.equal(result.code, 'settings_sync_pending');
    assert.deepEqual(published, [snapshot]);
    assert.equal(starts, 0);
});
