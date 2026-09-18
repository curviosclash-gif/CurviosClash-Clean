import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): the handler only ever sees a
// hand-built facade here, so no window and no running match are involved. The spec
// pulled the module through `import('/src/...')`, which fails against dist-app.

test('V87.2 GameRuntimeSessionHandler waits for pending finalize and deduplicates concurrent starts', async () => {
    let startCalls = 0;
    let resolveFinalize = null;
    let resolveStart = null;
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
        _pendingMatchFinalizePlan: {
            reason: 'return_to_menu',
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
            callLog.push(`applySnapshot:${snapshot?.lobbyCode || ''}`);
        },
        _applySettingsToRuntimeInternal(options) {
            callLog.push(`applyRuntime:${options?.schedulePrewarm !== false}`);
        },
        getUiManager() {
            return this.game.uiManager;
        },
        getPorts() {
            return {
                runtimeProjectionPort: {
                    getSessionRuntimeSnapshot: () => ({
                        lifecycleState: 'menu',
                        finalizeState: this._pendingMatchFinalize ? 'finalizing' : 'idle',
                        pendingFinalizeTrigger: this._pendingMatchFinalizePlan?.reason || '',
                    }),
                },
                matchUiPort: {
                    prepareMatchStartProjection: () => {
                        startCalls += 1;
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
            return {
                createMatchSession: () => new Promise((resolve) => {
                    resolveStart = () => resolve({});
                }),
            };
        },
    };
    facade._pendingMatchFinalize = new Promise((resolve) => {
        resolveFinalize = () => {
            facade._pendingMatchFinalize = null;
            facade._pendingMatchFinalizePlan = null;
            resolve(true);
        };
    });

    const handler = new GameRuntimeSessionHandler({ facade, logger: console });
    const firstPromise = handler.startMatch({ settingsSnapshot: { lobbyCode: 'ABCD' } });
    const secondPromise = handler.startMatch();
    const samePromise = firstPromise === secondPromise;
    const startCallsBeforeFinalize = startCalls;
    resolveFinalize();
    for (let attempt = 0; attempt < 10 && typeof resolveStart !== 'function'; attempt += 1) {
        await Promise.resolve();
    }
    const startCallsAfterFinalize = startCalls;
    resolveStart();
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    const result = {
        samePromise,
        startCallsBeforeFinalize,
        startCallsAfterFinalize,
        startCalls,
        firstResult,
        secondResult,
        callLog,
    };

    assert.strictEqual(result.samePromise, true);
    assert.strictEqual(result.startCallsBeforeFinalize, 0);
    assert.strictEqual(result.startCallsAfterFinalize, 1);
    assert.strictEqual(result.startCalls, 1);
    assert.strictEqual(result.firstResult, true);
    assert.strictEqual(result.secondResult, true);
    assert.ok(result.callLog.includes('applySnapshot:ABCD'));
    assert.ok(result.callLog.includes('applyRuntime:false'));
    assert.strictEqual(result.callLog.filter((entry) => entry === 'applyStart').length, 1);
});

test('V87.2 GameRuntimeSessionHandler dispose waits for finalize before clearing menu refs', async () => {
    let finalizeState = 'finalizing';
    let resolveFinalize = null;
    const callLog = [];
    const facade = {
        game: {
            menuController: {
                dispose() {
                    callLog.push('disposeMenuController');
                },
            },
            menuMultiplayerBridge: {
                dispose() {
                    callLog.push('disposeMenuBridge');
                },
            },
        },
        _clearMatchPrewarmTimer() {
            callLog.push('clearPrewarm');
        },
        finalizeMatch(options) {
            callLog.push(`finalize:${options?.reason || 'none'}`);
            return new Promise((resolve) => {
                resolveFinalize = (value = false) => {
                    finalizeState = value === false ? 'error' : 'finalized';
                    resolve(value);
                };
            });
        },
        getPorts() {
            return {
                runtimeProjectionPort: {
                    getSessionRuntimeSnapshot: () => ({
                        lifecycleState: finalizeState === 'finalized' ? 'menu' : 'playing',
                        finalizeState,
                        finalizeErrorMessage: finalizeState === 'error' ? 'dispose-finalize-failed' : '',
                    }),
                },
            };
        },
    };

    const handler = new GameRuntimeSessionHandler({ facade, logger: console });
    const firstPromise = handler.dispose();
    const secondPromise = handler.dispose();
    const samePromise = firstPromise === secondPromise;
    const callLogBeforeFinalize = [...callLog];
    resolveFinalize(false);
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    const result = {
        samePromise,
        callLogBeforeFinalize,
        callLog,
        firstResult,
        secondResult,
        menuControllerCleared: facade.game.menuController === null,
        menuBridgeCleared: facade.game.menuMultiplayerBridge === null,
    };

    assert.strictEqual(result.samePromise, true);
    assert.deepStrictEqual(result.callLogBeforeFinalize, [
        'clearPrewarm',
        'finalize:game_dispose',
    ]);
    assert.ok(!result.callLogBeforeFinalize.includes('disposeMenuController'));
    assert.ok(!result.callLogBeforeFinalize.includes('disposeMenuBridge'));
    assert.strictEqual(result.callLog.filter((entry) => entry === 'disposeMenuController').length, 1);
    assert.strictEqual(result.callLog.filter((entry) => entry === 'disposeMenuBridge').length, 1);
    assert.strictEqual(result.firstResult, false);
    assert.strictEqual(result.secondResult, false);
    assert.strictEqual(result.menuControllerCleared, true);
    assert.strictEqual(result.menuBridgeCleared, true);
});

for (const [label, transition] of [
    ['Five Portals', { requiresSessionRebuild: true, toMap: 'portal_map_2', botCount: 0, fivePortals: true }],
    ['Five Fronts', { requiresSessionRebuild: true, toMap: 'notre_dame_fire_arena', botCount: 12, arenaWaves: true }],
]) {
    test(`${label} sector rebuild re-applies the next map after the settings refresh`, async () => {
        const callLog = [];
        const facade = {
            game: {
                state: GAME_STATE_IDS.MENU,
                settings: { localSettings: { sessionType: 'single', modePath: 'arcade' } },
            },
            _clearMatchPrewarmTimer() { },
            _recordMenuTelemetry() { },
            _resolveStartValidationIssue() { return null; },
            _applySettingsToRuntimeInternal() { callLog.push('refreshFromSettings'); },
            _applyArcadeSectorRuntimeProfile(profile) { callLog.push(`applyProfile:${profile?.toMap}`); },
            prepareArcadeMatchStartRuntime() { callLog.push('prepare'); },
            getUiManager() { return null; },
            getPorts() {
                return {
                    runtimeProjectionPort: {
                        getSessionRuntimeSnapshot: () => ({ lifecycleState: 'menu', finalizeState: 'idle' }),
                    },
                    matchUiPort: { prepareMatchStartProjection: () => true, startRound() { } },
                    lifecyclePort: { initializeSession: () => true, waitForAllPlayersLoaded: () => true },
                };
            },
            getRuntimeHandle() { return { createMatchSession: () => ({}) }; },
        };
        const handler = new GameRuntimeSessionHandler({ facade, logger: console });

        await handler.startMatch({ source: 'arcade_sector_transition', arcadeSectorTransition: transition });

        const refreshAt = callLog.indexOf('refreshFromSettings');
        const applyAt = callLog.indexOf(`applyProfile:${transition.toMap}`);
        assert.ok(refreshAt >= 0, callLog.join(','));
        assert.ok(applyAt > refreshAt, `next map must win over the settings map: ${callLog.join(',')}`);
        assert.ok(applyAt < callLog.indexOf('prepare'), callLog.join(','));
    });
}

test('V87.4 GameRuntimeSessionHandler returns a fresh promise after a settled synchronous start', async () => {
    const handler = new GameRuntimeSessionHandler({ facade: {}, logger: console });
    let startCalls = 0;
    handler._startMatchAfterGuards = () => {
        startCalls += 1;
        return true;
    };

    const firstPromise = handler.startMatch();
    let nextPromise = null;
    const secondResultPromise = firstPromise.then(() => {
        nextPromise = handler.startMatch();
        return nextPromise;
    });
    const firstResult = await firstPromise;
    const secondResult = await secondResultPromise;

    const result = {
        firstIsPromise: !!firstPromise && typeof firstPromise.then === 'function',
        samePromiseAfterSettle: firstPromise === nextPromise,
        firstResult,
        secondResult,
        startCalls,
    };

    assert.strictEqual(result.firstIsPromise, true);
    assert.strictEqual(result.samePromiseAfterSettle, false);
    assert.strictEqual(result.firstResult, true);
    assert.strictEqual(result.secondResult, true);
    assert.strictEqual(result.startCalls, 2);
});

test('V87.4 GameRuntimeSessionHandler allows a retry after a rejected finalize leaves an error snapshot behind', async () => {
    let currentSnapshot = {
        lifecycleState: 'menu',
        finalizeState: 'idle',
    };
    const rejectedFinalize = Promise.reject(new Error('finalize_barrier_failed'));
    rejectedFinalize.catch(() => {});

    const facade = {
        _pendingMatchFinalize: rejectedFinalize,
        _pendingMatchFinalizePlan: {
            reason: 'return_to_menu',
        },
        getPorts() {
            return {
                runtimeProjectionPort: {
                    getSessionRuntimeSnapshot() {
                        return { ...currentSnapshot };
                    },
                },
            };
        },
    };

    const handler = new GameRuntimeSessionHandler({ facade, logger: console });
    const firstResult = await handler._awaitPendingFinalizeForStart({ source: 'test' });
    currentSnapshot = {
        lifecycleState: 'menu',
        finalizeState: 'error',
    };
    const retryResult = handler._awaitPendingFinalizeForStart({ source: 'test' });

    const result = {
        firstResult,
        retryResult,
        pendingFinalizeCleared: facade._pendingMatchFinalize === null,
        pendingFinalizePlanCleared: facade._pendingMatchFinalizePlan === null,
    };

    assert.strictEqual(result.firstResult, false);
    assert.strictEqual(result.retryResult, true);
    assert.strictEqual(result.pendingFinalizeCleared, true);
    assert.strictEqual(result.pendingFinalizePlanCleared, true);
});
