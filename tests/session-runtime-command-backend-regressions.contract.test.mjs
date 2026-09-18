import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';
import { createSessionRuntimeCommandBackends } from '../src/core/runtime/SessionRuntimeCommandBackendFactory.js';
import { SessionRuntimeCommandExecutor } from '../src/application/session-runtime/SessionRuntimeCommandExecutor.js';
import {
    createApplySettingsCommand,
    createStartMatchCommand,
} from '../src/shared/contracts/SessionRuntimeCommandContract.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

// Moved from tests/core-targeted-regressions.spec.js (P3). Unlike the executor tests in
// runtime-regressions.contract.test.mjs this one wires the REAL Core-composed backends
// around a hand-built facade, so it stays a productive integration seam. The spec could
// not run it at all: `import('/src/...')` does not resolve in the built dist-app.

test('V87.3 SessionRuntimeCommandExecutor routes APPLY_SETTINGS and START_MATCH snapshots through one runtime settings apply path', async () => {
    const callLog = [];
    const facade = {
        game: {
            state: GAME_STATE_IDS.MENU,
            settings: {
                localSettings: {
                    sessionType: 'single',
                    modePath: 'normal',
                },
            },
            uiManager: {
                showStartValidationError() { },
                clearStartValidationError() {
                    callLog.push('clearValidation');
                },
            },
        },
        _clearMatchPrewarmTimer() {
            callLog.push('clearPrewarm');
        },
        _recordMenuTelemetry(type, payload = {}) {
            callLog.push(`${type}:${payload.reason || ''}`);
        },
        _resolveStartValidationIssue() {
            return null;
        },
        _applyAuthoritativeMultiplayerMatchSettings(snapshot) {
            callLog.push(`applySnapshot:${snapshot?.mapKey || ''}`);
        },
        _applySettingsToRuntimeInternal(options = {}) {
            callLog.push(`applyRuntime:${options.schedulePrewarm !== false}`);
            return {
                schedulePrewarm: options.schedulePrewarm !== false,
            };
        },
        getUiManager() {
            return this.game.uiManager;
        },
        getPorts() {
            return {
                runtimeProjectionPort: {
                    getSessionRuntimeSnapshot: () => ({
                        lifecycleState: 'menu',
                        finalizeState: 'idle',
                        pendingFinalizeTrigger: '',
                    }),
                },
                matchUiPort: {
                    prepareMatchStartProjection: () => {
                        callLog.push('applyStart');
                        return true;
                    },
                    startRound() { },
                },
                lifecyclePort: {
                    initializeSession: () => true,
                    waitForAllPlayersLoaded: () => true,
                },
            };
        },
        getRuntimeHandle() {
            return { createMatchSession: () => ({}) };
        },
    };
    facade.sessionHandler = new GameRuntimeSessionHandler({ facade, logger: console });

    // Keep this as a productive integration seam: both settings apply and start-match
    // must traverse the same Core-composed backends used by GameRuntimeFacade.
    const executor = new SessionRuntimeCommandExecutor({
        facade,
        backends: createSessionRuntimeCommandBackends({ facade }),
    });
    const applyResult = executor.execute(createApplySettingsCommand({
        schedulePrewarm: false,
        source: 'settings_menu',
    }));
    const rawStartResult = executor.execute(createStartMatchCommand({
        source: 'menu_multiplayer_bridge',
        settingsSnapshot: {
            mapKey: 'maze',
        },
    }));
    const startResult = rawStartResult && typeof rawStartResult.then === 'function'
        ? await rawStartResult
        : rawStartResult;

    const result = {
        applyResult,
        startResult,
        startResultIsPromise: !!(rawStartResult && typeof rawStartResult.then === 'function'),
        callLog,
    };

    assert.strictEqual(result.applyResult?.schedulePrewarm, false);
    assert.strictEqual(result.startResult, true);
    assert.strictEqual(result.startResultIsPromise, true);
    assert.strictEqual(result.callLog.filter((entry) => entry === 'applyRuntime:false').length, 2);
    for (const expected of [
        'applySnapshot:maze',
        'clearPrewarm',
        'clearValidation',
        'applyStart',
    ]) {
        assert.ok(result.callLog.includes(expected), `callLog should contain ${expected}`);
    }
});
