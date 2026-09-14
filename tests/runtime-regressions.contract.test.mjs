import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    mountGameInstanceForTests,
    resetAppInitializerForTests,
} from '../src/core/AppInitializerTestHooks.js';
import { SessionRuntimeCommandExecutor } from '../src/application/session-runtime/SessionRuntimeCommandExecutor.js';
import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { GameRuntimeCoordinator } from '../src/core/runtime/GameRuntimeCoordinator.js';
import { createGameRuntimeBundle } from '../src/core/runtime/GameRuntimeBundle.js';
import { InputManager } from '../src/core/InputManager.js';
import { toggleCinematicRecordingFromHotkey } from '../src/core/runtime/GameRuntimeRecordingSupport.js';
import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { MatchStartRuntimeService } from '../src/core/runtime/MatchStartRuntimeService.js';
import {
    clearActiveRuntimeConfig,
    createActiveRuntimeConfigReadPort,
    setActiveRuntimeConfig,
} from '../src/core/runtime/ActiveRuntimeConfigStore.js';
import {
    applyRuntimeNetworkPlayerSlotContext,
    resolveRuntimeNetworkPlayerSlots,
} from '../src/core/runtime/RuntimeNetworkPlayerSlots.js';
import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';
import {
    deriveMatchStartUiState,
    deriveReturnToMenuUiState,
} from '../src/shared/contracts/MatchUiStateContract.js';
import { RECORDING_CAPTURE_PROFILE } from '../src/shared/contracts/RecordingCaptureContract.js';
import {
    classifyMatchRuntimeProjectionVersion,
    MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
    MATCH_RUNTIME_PROJECTION_TRAVERSAL_COMPATIBILITY,
    MATCH_RUNTIME_PROJECTION_VERSION_POLICY,
    createMatchRuntimeProjection,
} from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import {
    createApplySettingsCommand,
    createFinalizeMatchCommand,
    createHostLobbyCommand,
    createJoinLobbyCommand,
    createReturnToMenuCommand,
    createStartMatchCommand,
} from '../src/shared/contracts/SessionRuntimeCommandContract.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../src/shared/contracts/SessionRuntimeEventContract.js';
import { createSessionRuntimeCommandBackends } from '../src/core/runtime/SessionRuntimeCommandBackendFactory.js';
import { createArcadePort } from '../src/shared/runtime/GameRuntimeFeaturePorts.js';
import {
    createUiFeedbackPort,
    createLifecyclePort,
    createRuntimeIntentPort,
    createRuntimeProjectionPort,
} from '../src/shared/runtime/GameRuntimePorts.js';
import { createFallbackSessionRuntimeState } from '../src/state/MatchLifecycleSessionRuntimeState.js';
import { createMatchFlowUiControllerPort } from '../src/shared/runtime/UiControllerRuntimePorts.js';
import { MatchKernelInteractiveAdapter } from '../src/core/MatchKernelInteractiveAdapter.js';
import { MatchKernel } from '../src/state/MatchKernel.js';
import { MATCH_KERNEL_CONSUMER_IDS, createMatchKernelConsumerRegistry } from '../src/state/MatchKernelConsumerAdapters.js';
import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';
import { MatchFlowArcadeOverlayController } from '../src/ui/MatchFlowArcadeOverlayController.js';
import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';
import { requestArcadeReplayPlayback } from '../src/ui/MatchFlowTransitionHotspots.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { UIManager } from '../src/ui/UIManager.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';
import { UIStartSyncController } from '../src/ui/UIStartSyncController.js';
import { renderStartSetupSummaryAndPreview, syncStartSetupMultiplayerUi } from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';
import { syncStartSetupSelectionState } from '../src/ui/start-setup/StartSetupSelectionSync.js';
import { resolveDeveloperReleaseState, resolveMenuUiSyncContext } from '../src/ui/menu/MenuUiSyncContext.js';

function withMockRuntimeGlobals(run, options = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalCurviosApp = globalThis.curviosApp;
    const lifecycle = options.lifecycle || null;
    const window = {
        __CURVIOS_E2E__: false,
    };
    if (lifecycle) {
        window.curviosApp = {
            contracts: {
                lifecycle,
            },
        };
        globalThis.curviosApp = window.curviosApp;
    }
    globalThis.window = window;
    globalThis.document = {};
    return Promise.resolve()
        .then(() => run({ window }))
        .finally(() => {
            if (typeof originalWindow === 'undefined') {
                delete globalThis.window;
            } else {
                globalThis.window = originalWindow;
            }
            if (typeof originalDocument === 'undefined') {
                delete globalThis.document;
            } else {
                globalThis.document = originalDocument;
            }
            if (typeof originalCurviosApp === 'undefined') {
                delete globalThis.curviosApp;
            } else {
                globalThis.curviosApp = originalCurviosApp;
            }
        });
}

test('MatchFlow UI controller port forwards runtime projections when provided', () => {
    const runtimeSnapshot = { tickIndex: 12 };
    const runtimeProjection = { lifecycle: 'running' };
    const port = createMatchFlowUiControllerPort({
        runtimeProjectionPort: {
            getSessionRuntimeSnapshot: () => runtimeSnapshot,
            getMatchRuntimeProjection: () => runtimeProjection,
        },
    });

    assert.equal(port.getSessionRuntimeSnapshot(), runtimeSnapshot);
    assert.equal(port.getMatchRuntimeProjection(), runtimeProjection);
});

test('MatchFlowUiController projects split-screen layout state and clears it on menu return', () => {
    const createClassList = () => {
        const values = new Set();
        return {
            contains: (value) => values.has(value),
            toggle(value, force) {
                if (force) values.add(value);
                else values.delete(value);
            },
        };
    };
    const splitCalls = [];
    const hudClassList = createClassList();
    const p2ClassList = createClassList();
    const controller = new MatchFlowUiController({
        game: {
            ui: {
                hud: { classList: hudClassList },
                p2Hud: { classList: p2ClassList },
            },
        },
        runtimePort: {
            setSplitScreen: (enabled) => splitCalls.push(enabled),
        },
        sessionOrchestrator: {},
    });
    controller._syncArcadeOverlayPanel = () => {};

    controller.applyMatchUiState(deriveMatchStartUiState({ numHumans: 2 }));
    assert.equal(hudClassList.contains('split-screen'), true);
    assert.equal(p2ClassList.contains('hidden'), false);

    controller.applyMatchUiState({ visibility: { pauseOverlayHidden: true } });
    assert.equal(hudClassList.contains('split-screen'), true, 'partial states preserve match layout');

    controller.applyMatchUiState(deriveReturnToMenuUiState());
    assert.equal(hudClassList.contains('split-screen'), false);
    assert.equal(p2ClassList.contains('hidden'), true);
    assert.deepEqual(splitCalls, [true, false]);
});

test('MatchFlowUiController prepares presentation and input without creating a match session', () => {
    let transitionCalls = 0;
    let inputCalls = 0;
    const controller = new MatchFlowUiController({
        game: {
            state: 'MENU',
            ui: {},
            input: null,
            runtimeConfig: { session: { numHumans: 1 } },
        },
        runtimePort: {
            applyLifecycleTransition() {
                transitionCalls += 1;
                return true;
            },
        },
        sessionOrchestrator: {},
    });
    controller.applyMatchUiState = () => {};
    controller._configureInputSourcesForMatch = () => { inputCalls += 1; };
    assert.equal(controller.prepareMatchStartProjection(), true);
    assert.equal(transitionCalls, 1);
    assert.equal(inputCalls, 0);
    controller.configureMatchInputSources();
    assert.equal(inputCalls, 1);
    assert.equal(typeof controller.sessionOrchestrator.createMatchSession, 'undefined');
});

test('MatchFlowUiController shows a generic loading state when a map has no GLB source', () => {
    const controller = new MatchFlowUiController({
        game: {
            runtimeConfig: { session: { mapKey: 'empty' } },
            ui: {},
        },
        sessionOrchestrator: {},
    });

    const state = controller._resolveMatchLoadingUiState();

    assert.equal(state.visibility.messageOverlayHidden, false);
    assert.equal(state.messageSub, 'Arena wird vorbereitet');
});

test('MatchStartRuntimeService ignores a late session init after cancellation', async () => {
    let resolveSessionInit;
    let createMatchCalls = 0;
    let startRoundCalls = 0;
    const orchestrator = {
        createMatchSession() {
            createMatchCalls += 1;
            return { feedbackPlan: null };
        },
    };
    const service = new MatchStartRuntimeService({
        facade: {
            getRuntimeHandle: () => orchestrator,
            getPorts: () => ({
                lifecyclePort: {
                    initializeSession: () => new Promise((resolve) => { resolveSessionInit = resolve; }),
                },
                matchUiPort: {
                    prepareMatchStartProjection: () => true,
                    startRound() {
                        startRoundCalls += 1;
                    },
                },
            }),
        },
    });

    const startPromise = service.execute();
    service.cancel();
    resolveSessionInit(true);

    assert.equal(await startPromise, false);
    assert.equal(createMatchCalls, 0);
    assert.equal(startRoundCalls, 0);
});

test('MatchStartRuntimeService waits for the loading frame and honors cancellation there', async () => {
    let resolveLoadingFrame;
    let initializeCalls = 0;
    const service = new MatchStartRuntimeService({
        facade: {
            getRuntimeHandle: () => ({ createMatchSession: () => ({}) }),
            getPorts: () => ({
                lifecyclePort: {
                    initializeSession() {
                        initializeCalls += 1;
                        return true;
                    },
                },
                matchUiPort: {
                    prepareMatchStartProjection: () => true,
                    waitForMatchLoadingFrame: () => new Promise((resolve) => { resolveLoadingFrame = resolve; }),
                },
            }),
        },
    });

    const startPromise = service.execute();
    service.cancel();
    resolveLoadingFrame();

    assert.equal(await startPromise, false);
    assert.equal(initializeCalls, 0);
});

test('MatchFlowUiController waits through a paint before continuing match initialization', async () => {
    const originalWindow = globalThis.window;
    const frameCallbacks = [];
    globalThis.window = {
        requestAnimationFrame(callback) {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        },
    };
    const controller = new MatchFlowUiController({
        game: { ui: {} },
        sessionOrchestrator: {},
    });

    try {
        let resolved = false;
        const loadingFrame = controller.waitForMatchLoadingFrame().then(() => { resolved = true; });
        assert.equal(frameCallbacks.length, 1);

        frameCallbacks.shift()(0);
        await Promise.resolve();
        assert.equal(resolved, false);
        assert.equal(frameCallbacks.length, 1);

        frameCallbacks.shift()(16);
        await loadingFrame;
        assert.equal(resolved, true);
    } finally {
        if (typeof originalWindow === 'undefined') delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('InputManager clears assigned touch sources on blur-state reset', () => {
    const touchSource = {
        cleared: 0,
        clearInputState() {
            this.cleared += 1;
        },
    };
    const manager = Object.create(InputManager.prototype);
    manager.keys = { Space: true };
    manager.justPressed = { Space: true };
    manager._playerSources = new Map([[0, touchSource]]);

    manager.clearInputState('window-blur');

    assert.deepEqual(manager.keys, {});
    assert.deepEqual(manager.justPressed, {});
    assert.equal(touchSource.cleared, 1);
});

test('V115.4.2 match runtime traversal fields stay additive within projection v1', () => {
    const projection = createMatchRuntimeProjection({
        players: [{
            playerIndex: 0,
            traversal: {
                portalsEnabled: false,
                gateCount: 2,
                exitPortal: {
                    totalCount: 3,
                    activeCount: 5,
                },
                postPortalActive: true,
            },
        }],
    });

    assert.equal(projection.contractVersion, MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION);
    assert.equal(MATCH_RUNTIME_PROJECTION_TRAVERSAL_COMPATIBILITY.introducedIn, 'match-runtime-projection.v1');
    assert.equal(MATCH_RUNTIME_PROJECTION_TRAVERSAL_COMPATIBILITY.policy, 'additive-v1-fields');
    assert.ok(Object.isFrozen(MATCH_RUNTIME_PROJECTION_TRAVERSAL_COMPATIBILITY.fields));
    assert.deepEqual(projection.players[0].traversal, {
        portalsEnabled: false,
        portalCooldownRemaining: 0,
        gateCooldownRemaining: 0,
        gateCount: 2,
        exitPortal: {
            totalCount: 3,
            activeCount: 3,
            inactiveCount: 0,
        },
        exitPortalCooldownRemaining: 0,
        postPortalActive: true,
        postPortalRemainingSeconds: 0,
        lastPortalTravelAtMs: 0,
    });
});

test('V96.7 match runtime projection uses one producer and consumer version contract', () => {
    const legacyState = classifyMatchRuntimeProjectionVersion({
        players: [{ playerIndex: 1, speed: 12 }],
    });
    const currentState = classifyMatchRuntimeProjectionVersion({
        contractVersion: MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION,
        players: [],
    });
    const futureState = classifyMatchRuntimeProjectionVersion({
        contractVersion: 'match-runtime-projection.v99',
        players: [{ playerIndex: 1, speed: 12 }],
    });
    const normalizedFuture = createMatchRuntimeProjection({
        contractVersion: 'match-runtime-projection.v99',
        players: [{ playerIndex: 1, speed: 12 }],
    });

    assert.equal(MATCH_RUNTIME_PROJECTION_VERSION_POLICY.currentVersion, MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION);
    assert.equal(legacyState.shouldFallback, true);
    assert.equal(currentState.decision, 'current');
    assert.equal(futureState.shouldReject, true);
    assert.equal(normalizedFuture.contractVersion, MATCH_RUNTIME_PROJECTION_CONTRACT_VERSION);
    assert.deepEqual(normalizedFuture.players, []);
});

test('V96.7 active runtime config read port wraps transition store access', () => {
    const owner = { id: 'runtime-bundle' };
    const fallback = { PLAYER: { SPEED: 10 } };
    const activeConfig = { PLAYER: { SPEED: 22 } };
    const port = createActiveRuntimeConfigReadPort({ fallback });

    try {
        assert.equal(port.kind, 'ActiveRuntimeConfigStoreReadPort');
        assert.equal(port.getConfig(), fallback);
        setActiveRuntimeConfig(activeConfig, { owner });
        assert.deepEqual(port.getConfig(), activeConfig);
        assert.equal(port.getOwner(), owner);
    } finally {
        clearActiveRuntimeConfig({ owner });
    }
});

test('AppInitializer aborts remount when previous dispose fails before publishing a new runtime (V100)', async () => {
    await withMockRuntimeGlobals(async ({ window }) => {
        resetAppInitializerForTests();
        try {
            let createCalls = 0;
            const previousRuntimeFacade = { id: 'previous-runtime' };
            const previousDebugApi = { id: 'previous-debug' };
            window.GAME_INSTANCE = {
                runtimeFacade: previousRuntimeFacade,
                debugApi: previousDebugApi,
                dispose() {
                    throw new Error('dispose failed hard');
                },
            };
            window.GAME_RUNTIME = previousRuntimeFacade;
            window.GAME_DEBUG = previousDebugApi;

            await assert.rejects(
                () => mountGameInstanceForTests(() => {
                    createCalls += 1;
                    return {
                        runtimeFacade: { id: 'next-runtime' },
                        debugApi: { id: 'next-debug' },
                    };
                }),
                /remount aborted/i
            );

            assert.equal(createCalls, 0);
            assert.equal(window.GAME_INSTANCE, null);
            assert.equal(window.GAME_RUNTIME, null);
            assert.equal(window.GAME_DEBUG, null);
        } finally {
            resetAppInitializerForTests();
        }
    });
});

test('AppInitializer hides the boot screen only after a rendered frame of a successful mount', async () => {
    await withMockRuntimeGlobals(async ({ window }) => {
        resetAppInitializerForTests();
        const bootScreen = {
            hidden: false,
            attributes: new Map(),
            setAttribute(name, value) {
                this.attributes.set(name, value);
            },
        };
        let frameCallback = null;
        globalThis.document = {
            getElementById: (id) => (id === 'app-boot-screen' ? bootScreen : null),
        };
        window.requestAnimationFrame = (callback) => {
            frameCallback = callback;
            return 1;
        };

        try {
            const mount = mountGameInstanceForTests(() => ({
                runtimeFacade: {},
                debugApi: {},
            }));
            await Promise.resolve();

            assert.equal(bootScreen.hidden, false);
            assert.equal(typeof frameCallback, 'function');

            frameCallback();
            await mount;

            assert.equal(bootScreen.hidden, true);
            assert.equal(bootScreen.attributes.get('aria-hidden'), 'true');
        } finally {
            resetAppInitializerForTests();
        }
    });
});

test('AppInitializer detaches stale graceful-close handlers before remounting (V100)', async () => {
    const callbacks = [];
    let unsubscribeCalls = 0;
    let confirmCalls = 0;
    const lifecycle = {
        contractVersion: 'test.lifecycle.v1',
        onGracefulClose(callback) {
            callbacks.push(callback);
            return () => {
                unsubscribeCalls += 1;
                const index = callbacks.indexOf(callback);
                if (index >= 0) {
                    callbacks.splice(index, 1);
                }
            };
        },
        confirmGracefulClose() {
            confirmCalls += 1;
        },
    };

    await withMockRuntimeGlobals(async ({ window }) => {
        resetAppInitializerForTests();
        try {
            let firstDisposeCalls = 0;
            let secondDisposeCalls = 0;

            await mountGameInstanceForTests(() => ({
                runtimeFacade: { id: 'first-runtime' },
                debugApi: { id: 'first-debug' },
                dispose() {
                    firstDisposeCalls += 1;
                },
            }));

            await mountGameInstanceForTests(() => ({
                runtimeFacade: { id: 'second-runtime' },
                debugApi: { id: 'second-debug' },
                dispose() {
                    secondDisposeCalls += 1;
                },
            }));

            assert.equal(unsubscribeCalls, 1);
            assert.equal(callbacks.length, 1);
            assert.equal(window.GAME_RUNTIME?.id, 'second-runtime');
            assert.equal(firstDisposeCalls, 1);
            assert.equal(secondDisposeCalls, 0);

            await callbacks[0]();

            assert.equal(firstDisposeCalls, 1);
            assert.equal(secondDisposeCalls, 1);
            assert.equal(confirmCalls, 1);
        } finally {
            resetAppInitializerForTests();
        }
    }, { lifecycle });
});

test('MatchFlow UI controller port forwards arcade parcours events when provided', () => {
    const calls = [];
    const payload = { type: 'ghost_start', routeId: 'map_maze' };
    const port = createMatchFlowUiControllerPort({
        arcadePort: {
            applyParcoursEvent(data = null) {
                calls.push(data);
                return 'ok';
            },
        },
    });

    const result = port.applyArcadeParcoursEvent(payload);
    assert.equal(result, 'ok');
    assert.deepEqual(calls, [payload]);
});

test('MatchFlowLifecycleController delegates returnToMenu to the injected runtime port', () => {
    const calls = [];
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: {
            applyLifecycleTransition() {
                throw new Error('fallback applyLifecycleTransition should not run while runtimePort handles returnToMenu');
            },
            applyMatchUiState() {
                throw new Error('fallback applyMatchUiState should not run while runtimePort handles returnToMenu');
            },
            resetCrosshairUi() {
                throw new Error('fallback resetCrosshairUi should not run while runtimePort handles returnToMenu');
            },
        },
        game: {},
        runtimePort: {
            returnToMenu(options = undefined) {
                calls.push(options);
                return 'runtime-port-return';
            },
        },
    });

    const result = lifecycleController.returnToMenu({ reason: 'contract-test' });

    assert.equal(result, 'runtime-port-return');
    assert.deepEqual(calls, [{ reason: 'contract-test' }]);
});

test('MatchFlowLifecycleController applyReturnToMenuUi uses runtime-handle-backed UI feedback ports', () => {
    const uiCalls = [];
    const transition = {
        transitionId: 'return_to_menu',
        uiState: { screen: 'menu' },
    };
    const uiManager = {
        syncAll() {
            uiCalls.push(['syncAll']);
        },
        menuNavigationRuntime: {
            showPanel(panelId, options = undefined) {
                uiCalls.push(['showPanel', panelId, options]);
            },
        },
    };
    const game = {
        _showMainNav() {
            uiCalls.push(['legacyShowMainNav']);
        },
        runtimeBundle: {
            sessionRuntime: {
                handles: {
                    uiManager,
                },
            },
        },
    };
    const lifecycleCalls = [];
    const runtimePort = createMatchFlowUiControllerPort({
        uiFeedbackPort: createUiFeedbackPort(game),
    });
    const lifecycleController = new MatchFlowLifecycleController({
        game,
        runtimePort,
        deriveReturnToMenuTransition: () => transition,
        matchFlowUiController: {
            _clearArcadeOverlayPanel() {
                lifecycleCalls.push('clearArcadeOverlayPanel');
            },
            applyLifecycleTransition(nextTransition) {
                lifecycleCalls.push(['applyLifecycleTransition', nextTransition]);
            },
            applyMatchUiState(nextUiState) {
                lifecycleCalls.push(['applyMatchUiState', nextUiState]);
            },
            resetCrosshairUi() {
                lifecycleCalls.push('resetCrosshairUi');
            },
        },
    });

    const result = lifecycleController.applyReturnToMenuUi({
        panelId: 'submenu-settings',
        trigger: 'contract-test',
    });

    assert.equal(result, transition);
    assert.deepEqual(lifecycleCalls, [
        'clearArcadeOverlayPanel',
        ['applyLifecycleTransition', transition],
        ['applyMatchUiState', transition.uiState],
        'resetCrosshairUi',
    ]);
    assert.deepEqual(uiCalls, [
        ['showPanel', 'submenu-settings', { trigger: 'contract-test' }],
        ['syncAll'],
    ]);
});

test('requestArcadeReplayPlayback falls back to current-route ghost playback when replay player is unavailable', () => {
    const calls = [];
    const game = {
        arena: {
            currentMapDefinition: {
                parcours: {
                    routeId: 'route_sigma',
                },
            },
            currentMapKey: 'trench',
        },
        settings: {
            mapKey: 'trench',
        },
        runtimeConfig: {
            session: {
                mapKey: 'trench',
            },
        },
    };
    const runtimePort = {
        requestArcadeReplayPlayback() {
            calls.push(['replay']);
            return { ok: false, code: 'replay_player_unavailable' };
        },
        applyArcadeParcoursEvent(payload) {
            calls.push(['ghost', payload]);
            return { started: true, routeId: 'route_sigma' };
        },
    };

    const result = requestArcadeReplayPlayback(runtimePort, game);

    assert.equal(result?.ok, true);
    assert.equal(result?.code, 'ghost_fallback_started');
    assert.equal(result?.routeId, 'route_sigma');
    assert.deepEqual(calls, [
        ['replay'],
        ['ghost', {
            type: 'ghost_start',
            routeId: 'route_sigma',
            routeAliases: ['route_sigma', 'trench'],
            source: 'menu_replay_fallback',
        }],
    ]);
});

test('requestArcadeReplayPlayback plays the recorded last round before using the Arcade export fallback', () => {
    const calls = [];
    const clip = {
        sourceDuration: 4,
        displayDuration: 8,
        players: [{ idx: 0 }],
        frames: [{ time: 0 }, { time: 4 }],
    };
    const game = {
        recorder: {
            getLastRoundGhostClip(players, options) {
                calls.push(['clip', players, options]);
                return clip;
            },
        },
        entityManager: {
            players: [{ index: 0 }],
            playLastRoundGhost(requestedClip, options) {
                calls.push(['play', requestedClip, options]);
                return true;
            },
        },
    };
    const replayResult = {
        ok: true,
        code: 'replay_export_ready',
        replayJson: '{"matchId":"arcade-run-replay"}',
    };
    const runtimePort = {
        requestArcadeReplayPlayback() {
            calls.push(['replay']);
            return replayResult;
        },
    };

    const result = requestArcadeReplayPlayback(runtimePort, game);

    assert.equal(result?.ok, true);
    assert.equal(result?.code, 'replay_playback_started');
    assert.equal(result?.replayResult, replayResult);
    assert.deepEqual(result?.playback, {
        frameCount: 2,
        sourceDuration: 4,
        displayDuration: 8,
    });
    assert.deepEqual(calls, [
        ['replay'],
        ['clip', game.entityManager.players, {
            includeBots: true,
            maxSourceDuration: 12,
            displayDuration: 8,
        }],
        ['play', clip, { loop: false }],
    ]);
});

test('requestArcadeReplayPlayback preserves JSON export when no recorded round can be played', () => {
    const replayResult = {
        ok: true,
        code: 'replay_export_ready',
        replayJson: '{"matchId":"arcade-run-replay"}',
    };
    const game = {
        recorder: {
            getLastRoundGhostClip() {
                return null;
            },
        },
        entityManager: {
            players: [],
            playLastRoundGhost() {
                assert.fail('playLastRoundGhost must not run without a clip');
            },
        },
    };

    const result = requestArcadeReplayPlayback({
        requestArcadeReplayPlayback() {
            return replayResult;
        },
    }, game);

    assert.equal(result, replayResult);
});

test('MatchFlowLifecycleController startRound requests ghost playback by active route/map key', () => {
    const arcadeEventCalls = [];
    let resetRoundRuntimeCalls = 0;
    let timeScaleValue = null;
    let updateScoreHudCalls = 0;
    let updateCrosshairCalls = 0;
    const game = {
        arena: {
            currentMapDefinition: {
                parcours: {
                    routeId: 'route_delta',
                },
            },
            currentMapKey: 'maze',
        },
        entityManager: {
            clearLastRoundGhost() {},
        },
        ui: {
            crosshairP1: { style: {} },
            crosshairP2: { style: {} },
        },
        gameLoop: {
            setTimeScale(value) {
                timeScaleValue = value;
            },
        },
        hudRuntimeSystem: {
            updateScoreHud() {
                updateScoreHudCalls += 1;
            },
        },
        crosshairSystem: {
            updateCrosshairs() {
                updateCrosshairCalls += 1;
            },
        },
    };
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: {
            applyLifecycleTransition() {},
            _clearArcadeOverlayPanel() {},
            applyMatchUiState() {},
        },
        game,
        runtimePort: {
            applyArcadeParcoursEvent(data = null) {
                arcadeEventCalls.push(data);
            },
        },
        sessionOrchestrator: {
            resetRoundRuntime() {
                resetRoundRuntimeCalls += 1;
            },
        },
        deriveRoundStartTransition: () => ({ uiState: { visibility: {} } }),
    });

    lifecycleController.startRound();

    assert.equal(resetRoundRuntimeCalls, 1);
    assert.equal(timeScaleValue, 1.0);
    assert.equal(updateScoreHudCalls, 1);
    assert.equal(updateCrosshairCalls, 1);
    assert.equal(game.ui.crosshairP1.style.display, 'none');
    assert.equal(game.ui.crosshairP2.style.display, 'none');
    assert.deepEqual(arcadeEventCalls, [{
        type: 'ghost_start',
        routeId: 'route_delta',
        routeAliases: ['route_delta', 'maze'],
        source: 'match_round_start',
    }]);
});

test('MatchFlowLifecycleController persists longest round ghost per route on round end', () => {
    const arcadeEventCalls = [];
    const playedGhosts = [];
    const telemetryCalls = [];
    const previewGhostClip = {
        frames: [{ time: 0, players: [{ idx: 0 }] }, { time: 2.4, players: [{ idx: 0 }] }],
        players: [{ idx: 0 }],
        sourceDuration: 2.4,
        displayDuration: 2.4,
    };
    const libraryGhostClip = {
        frames: [{ time: 0, players: [{ idx: 0 }] }, { time: 5.6, players: [{ idx: 0 }] }],
        players: [{ idx: 0 }],
        sourceDuration: 5.6,
        displayDuration: 3,
    };
    const game = {
        state: '',
        roundPause: 0,
        arena: {
            currentMapDefinition: {
                parcours: {
                    routeId: 'route_sigma',
                },
            },
            currentMapKey: 'trench',
        },
        entityManager: {
            players: [{ index: 0 }],
            playLastRoundGhost(clip) {
                playedGhosts.push(clip);
            },
            clearLastRoundGhost() {},
            getHumanPlayers() {
                return [{ index: 0 }];
            },
        },
        roundStateController: {},
        numBots: 1,
        winsNeeded: 5,
        hudRuntimeSystem: {
            updateScoreHud() {},
        },
    };
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: {
            _getMatchRuntimeProjection() {
                return null;
            },
            applyMatchUiState() {},
        },
        game,
        runtimePort: {
            enterRoundEnd(roundPause) {
                game.state = 'ROUND_END';
                game.roundPause = roundPause;
            },
            applyRoundEndTransition(transition) {
                game.state = transition.nextState;
                game.roundPause = transition.roundPause;
            },
            getLastRoundGhostClip(_players, options = undefined) {
                if (options?.maxSourceDuration === Number.POSITIVE_INFINITY) {
                    return libraryGhostClip;
                }
                return previewGhostClip;
            },
            applyArcadeParcoursEvent(data = null) {
                arcadeEventCalls.push(data);
                return { ok: true };
            },
        },
        telemetryController: {
            recordRoundEndTelemetry(payload) {
                telemetryCalls.push(payload);
            },
        },
        coordinateRoundEnd: () => ({ transition: { roundPause: 3, nextState: 'ROUND_END' } }),
    });

    lifecycleController.onRoundEnd(null, null);

    assert.equal(game.state, 'ROUND_END');
    assert.equal(game.roundPause, 3);
    assert.equal(playedGhosts.length, 1);
    assert.equal(playedGhosts[0], previewGhostClip);
    assert.equal(telemetryCalls.length, 1);
    assert.equal(arcadeEventCalls.length, 1);
    assert.equal(arcadeEventCalls[0]?.type, 'finish');
    assert.equal(arcadeEventCalls[0]?.routeId, 'route_sigma');
    assert.deepEqual(arcadeEventCalls[0]?.routeAliases, ['route_sigma', 'trench']);
    assert.equal(arcadeEventCalls[0]?.persistLibraryOnly, true);
    assert.equal(arcadeEventCalls[0]?.totalTimeMs, 5600);
    assert.equal(arcadeEventCalls[0]?.ghostClip?.displayDuration, 5.6);
});

test('MatchFlowTelemetryController binds hunt feedback through the extracted telemetry seam', () => {
    const game = {
        huntState: {
            killFeed: [],
        },
    };
    let boundHandlers = null;
    const telemetryController = new MatchFlowTelemetryController({ game });

    telemetryController.bindHuntEventHandlers({
        bindHuntEventHandlers(handlers) {
            boundHandlers = handlers;
        },
    });

    assert.equal(typeof boundHandlers?.onHuntFeedEvent, 'function');
    boundHandlers.onHuntFeedEvent('Sector clear');

    assert.deepEqual(game.huntState.killFeed, ['Sector clear']);
});

test('Runtime intent port resolves bundle adapters before legacy runtime slots', () => {
    const calls = [];
    const game = {
        runtimeBundle: {
            components: {
                runtimeCoordinator: {
                    startMatch(options = undefined) {
                        calls.push(['bundle-coordinator', options]);
                        return 'bundle-coordinator';
                    },
                },
            },
        },
        runtimeCoordinator: {
            startMatch(options = undefined) {
                calls.push(['legacy-coordinator', options]);
                return 'legacy-coordinator';
            },
        },
        runtimeFacade: {
            startMatch(options = undefined) {
                calls.push(['legacy-facade', options]);
                return 'legacy-facade';
            },
        },
    };

    const port = createRuntimeIntentPort(game);
    const result = port.startMatch({ source: 'contract-test' });

    assert.equal(result, 'bundle-coordinator');
    assert.deepEqual(calls, [['bundle-coordinator', { source: 'contract-test' }]]);
});

test('Runtime intent port no longer falls back to legacy runtimeFacade for migrated commands (92.3.1)', () => {
    const calls = [];
    const game = {
        runtimeFacade: {
            returnToMenu(options = undefined) {
                calls.push(options);
                return 'legacy-facade';
            },
        },
    };

    const port = createRuntimeIntentPort(game);
    const result = port.returnToMenu({ reason: 'contract-test' });

    assert.equal(result, undefined);
    assert.deepEqual(calls, []);
});

test('lifecyclePort no longer falls back to legacy runtimeFacade for migrated session lifecycle paths (92.3.1)', () => {
    const calls = [];
    const game = {
        runtimeFacade: {
            initializeSession() {
                calls.push('legacy-facade');
                return 'legacy-facade';
            },
        },
    };

    const port = createLifecyclePort(game);
    const result = port.initializeSession();

    assert.equal(result, undefined);
    assert.deepEqual(calls, []);
});

test('GameRuntimePorts keep transition fallback helpers removed from productive path (104.5.1)', () => {
    const source = fs.readFileSync(new URL('../src/shared/runtime/GameRuntimePorts.js', import.meta.url), 'utf8');
    assert.equal(source.includes('getLegacyRuntimeFacade'), false);
    assert.equal(source.includes('getLegacyRuntimeCoordinator'), false);
    assert.equal(source.includes('getRuntimeFeatureTransitionFacade'), false);
    assert.equal(source.includes('getRuntimeFeatureTransitionCoordinator'), false);
    assert.equal(source.includes('allowLegacyFallback = true'), false);
});

test('PlatformCapabilityRegistry and SettingsRuntimeLimitsContract avoid direct curvios globals (104.5.1)', () => {
    const registrySource = fs.readFileSync(new URL('../src/shared/contracts/PlatformCapabilityRegistry.js', import.meta.url), 'utf8');
    const settingsLimitsSource = fs.readFileSync(new URL('../src/shared/contracts/SettingsRuntimeLimitsContract.js', import.meta.url), 'utf8');

    assert.equal(registrySource.includes('curviosApp'), false);
    assert.equal(registrySource.includes('__CURVIOS_APP__'), false);
    assert.equal(settingsLimitsSource.includes('curviosApp'), false);
    assert.equal(settingsLimitsSource.includes('__CURVIOS_APP__'), false);
});

test('session runtime snapshot resolves session contract without legacy runtimeFacade fallback (92.3.1)', () => {
    const updatedAt = Date.now();
    const game = {
        settings: {
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'lan',
            },
        },
        runtimeBundle: {
            sessionRuntime: {
                session: {
                    activeSessionId: 'session-42',
                },
                lifecycle: {
                    status: 'running',
                    gameStateId: 'PLAYING',
                    pendingSessionInit: null,
                    updatedAt,
                },
                finalize: {
                    status: 'idle',
                    lastTrigger: null,
                    errorMessage: null,
                    updatedAt,
                },
                handles: {
                    runtimeFacade: {
                        session: {
                            isHost: false,
                        },
                        isNetworkSession() {
                            throw new Error('legacy runtimeFacade should not be read');
                        },
                    },
                },
            },
        },
    };

    const port = createRuntimeProjectionPort(game);
    const snapshot = port.getSessionRuntimeSnapshot();

    assert.equal(snapshot.sessionId, 'session-42');
    assert.equal(snapshot.sessionType, 'multiplayer');
    assert.equal(snapshot.runtimeTransportKind, 'lan');
    assert.equal(snapshot.isNetworkSession, true);
    assert.equal(snapshot.isHost, false);
});

test('ArcadeMenuSurface no longer reads GAME_INSTANCE/GAME_RUNTIME in productive runtime path (92.3.2)', () => {
    const source = fs.readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    assert.equal(source.includes('window.GAME_INSTANCE'), false);
    assert.equal(source.includes('window.GAME_RUNTIME'), false);
});

test('SessionRuntimeCommandExecutor routes the six V96.3 commands through injected backends', async () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    const runtimeBundle = { sessionRuntime };
    const calls = [];
    const facade = {
        game: {},
        getRuntimeBundle() {
            return runtimeBundle;
        },
    };
    const executor = new SessionRuntimeCommandExecutor({
        facade,
        backends: {
            applySettings(options) {
                calls.push(['applySettings', options]);
                return 'apply-ok';
            },
            startMatch(options) {
                calls.push(['startMatch', options]);
                return Promise.resolve('start-ok');
            },
            returnToMenu(options) {
                calls.push(['returnToMenu', options]);
                return 'return-ok';
            },
            finalizeMatch(options, fallbackReason) {
                calls.push(['finalizeMatch', options, fallbackReason]);
                return Promise.resolve('finalize-ok');
            },
            hostLobby(options) {
                calls.push(['hostLobby', options]);
                return Promise.resolve('host-ok');
            },
            joinLobby(options) {
                calls.push(['joinLobby', options]);
                return Promise.resolve('join-ok');
            },
        },
    });
    const payloads = {
        applySettings: { source: 'settings_menu', schedulePrewarm: false },
        startMatch: { source: 'start_menu', settingsSnapshot: { mapKey: 'maze' } },
        returnToMenu: { source: 'pause_menu', reason: 'manual' },
        finalizeMatch: { source: 'round_end' },
        hostLobby: { source: 'lobby_menu', lobbyCode: 'HOST1' },
        joinLobby: { source: 'lobby_menu', lobbyCode: 'JOIN1', signalingUrl: 'http://localhost:9090' },
    };

    const results = await Promise.all([
        executor.execute(createApplySettingsCommand(payloads.applySettings)),
        executor.execute(createStartMatchCommand(payloads.startMatch)),
        executor.execute(createReturnToMenuCommand(payloads.returnToMenu)),
        executor.execute(createFinalizeMatchCommand(payloads.finalizeMatch)),
        executor.execute(createHostLobbyCommand(payloads.hostLobby)),
        executor.execute(createJoinLobbyCommand(payloads.joinLobby)),
    ]);

    assert.deepEqual(results, [
        'apply-ok',
        'start-ok',
        'return-ok',
        'finalize-ok',
        'host-ok',
        'join-ok',
    ]);
    assert.deepEqual(calls, [
        ['applySettings', payloads.applySettings],
        ['startMatch', payloads.startMatch],
        ['returnToMenu', payloads.returnToMenu],
        ['finalizeMatch', payloads.finalizeMatch, 'return_to_menu'],
        ['hostLobby', payloads.hostLobby],
        ['joinLobby', payloads.joinLobby],
    ]);

    const commandEvents = sessionRuntime.observability.events.filter((event) => (
        event.type === SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED
        && event.source === 'session_runtime_command_use_case'
    ));
    assert.equal(commandEvents.filter((event) => event.payload?.phase === 'received').length, 6);
    assert.equal(commandEvents.filter((event) => event.payload?.phase === 'completed').length, 6);
});

test('GameRuntimeFacade composes the complete V96.3 command backend factory', () => {
    const backends = createSessionRuntimeCommandBackends();
    assert.deepEqual(Object.keys(backends).sort(), [
        'applySettings',
        'finalizeMatch',
        'hostLobby',
        'joinLobby',
        'returnToMenu',
        'startMatch',
    ]);

    const facadeSource = fs.readFileSync(new URL('../src/core/GameRuntimeFacade.js', import.meta.url), 'utf8');
    assert.equal(facadeSource.includes('backends: createSessionRuntimeCommandBackends({ facade: this })'), true);
});

test('SessionRuntimeCommandExecutor settled result stays on the use-case boundary for async failures (92.2.2)', async () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    const runtimeBundle = { sessionRuntime };
    const executor = new SessionRuntimeCommandExecutor({
        facade: {
            game: {},
            getRuntimeBundle() {
                return runtimeBundle;
            },
        },
        backends: {
            startMatch() {
                return Promise.reject(new Error('command-boom'));
            },
        },
    });

    await assert.rejects(
        executor.execute(createStartMatchCommand({ source: 'raw_start' })),
        /command-boom/
    );

    const settledResult = await executor.executeResult(createStartMatchCommand({ source: 'settled_start' }));
    const failedEvents = sessionRuntime.observability.events.filter((event) => (
        event.type === SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED
        && event.payload?.phase === 'failed'
        && event.payload?.resultStatus === 'rejected'
    ));

    assert.equal(settledResult.ok, false);
    assert.equal(settledResult.commandType, 'start_match');
    assert.equal(settledResult.resultStatus, 'rejected');
    assert.equal(settledResult.errorMessage, 'command-boom');
    assert.ok(failedEvents.length >= 2);
    assert.ok(failedEvents.every((event) => event.source === 'session_runtime_command_use_case'));
});

test('SessionRuntimeCommandExecutor invalid command results also route through the use-case boundary (92.2.2)', async () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    const runtimeBundle = { sessionRuntime };
    const executor = new SessionRuntimeCommandExecutor({
        facade: {
            game: {},
            getRuntimeBundle() {
                return runtimeBundle;
            },
        },
    });

    const rawResult = executor.execute({
        type: 'not_a_real_command',
        payload: { source: 'manual_probe' },
    });
    const settledResult = await executor.executeResult({
        type: 'not_a_real_command',
        payload: { source: 'manual_probe' },
    });
    const failedEvents = sessionRuntime.observability.events.filter((event) => (
        event.type === SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED
        && event.payload?.phase === 'failed'
        && event.payload?.resultStatus === 'invalid_command'
    ));

    assert.equal(rawResult, undefined);
    assert.equal(settledResult.ok, false);
    assert.equal(settledResult.commandType, 'not_a_real_command');
    assert.equal(settledResult.commandSource, 'manual_probe');
    assert.equal(settledResult.resultStatus, 'invalid_command');
    assert.equal(settledResult.errorMessage, 'invalid session runtime command');
    assert.ok(failedEvents.length >= 2);
    assert.ok(failedEvents.every((event) => event.source === 'session_runtime_command_use_case'));
});

test('GameRuntimeCoordinator does not consume raw runtime slot fallbacks for ports or facade handles', () => {
    const runtime = {
        runtimePorts: { id: 'legacy-runtime-ports' },
        runtimeFacade: { id: 'legacy-runtime-facade' },
        uiManager: { id: 'legacy-runtime-ui-manager' },
    };
    const coordinator = new GameRuntimeCoordinator({ runtime });

    assert.equal(coordinator.getPorts(), null);
    assert.equal(coordinator.getRuntimeFacade(), null);
    assert.equal(coordinator.getUiManager(), null);
});

test('Cinematic recording switch does not restart after stop failure', async () => {
    const toasts = [];
    let startCalls = 0;
    const recorder = {
        notifyLifecycleEvent() {},
        getSupportState() {
            return { canRecord: true };
        },
        startRecording() {
            startCalls += 1;
            return Promise.resolve({ started: true });
        },
        stopRecording() {
            return Promise.reject(new Error('stop-failed'));
        },
        isRecording() {
            return true;
        },
        getRecordingCaptureSettings() {
            return { profile: RECORDING_CAPTURE_PROFILE.STANDARD };
        },
        setRecordingCaptureSettings() {},
    };
    const renderer = {
        setRecordingCaptureSettings() {},
    };

    const result = toggleCinematicRecordingFromHotkey({
        game: {
            render() {},
        },
        getRuntimeHandle(key) {
            if (key === 'mediaRecorderSystem') return recorder;
            if (key === 'renderer') return renderer;
            return null;
        },
        showStatusToast(message, duration, variant) {
            toasts.push({ message, duration, variant });
        },
    });

    assert.equal(result, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(startCalls, 0);
    assert.match(toasts.at(-1)?.message || '', /Fehler beim Stoppen/);
    assert.equal(toasts.at(-1)?.variant, 'error');
});

test('Cinematic recording stop toast points to the manual render list', async () => {
    const toasts = [];
    const recorder = {
        notifyLifecycleEvent() {},
        getSupportState() {
            return { canRecord: true };
        },
        startRecording() {
            return Promise.resolve({ started: true });
        },
        stopRecording() {
            return Promise.resolve({
                stopped: true,
                queued: true,
                sizeBytes: 1_048_576,
                recordingId: 'cinematic-queued',
            });
        },
        isRecording() {
            return true;
        },
        getRecordingCaptureSettings() {
            return { profile: RECORDING_CAPTURE_PROFILE.CINEMATIC };
        },
        setRecordingCaptureSettings() {},
    };

    const result = toggleCinematicRecordingFromHotkey({
        game: {
            render() {},
        },
        getRuntimeHandle(key) {
            if (key === 'mediaRecorderSystem') return recorder;
            if (key === 'renderer') return { setRecordingCaptureSettings() {} };
            return null;
        },
        showStatusToast(message, duration, variant) {
            toasts.push({ message, duration, variant });
        },
    });

    assert.equal(result, true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const summaryToast = toasts.at(-1) || null;
    assert.ok(summaryToast);
    assert.equal(summaryToast.variant, 'success');
    assert.match(summaryToast.message, /bereit \(1\.0 MB\)/);
    assert.match(summaryToast.message, /im Menü auswählen und rendern/);
});

test('Cinematic F8 start and F9 stop commands cannot toggle in the wrong direction', async () => {
    let recording = false;
    let startCalls = 0;
    let stopCalls = 0;
    const recorder = {
        notifyLifecycleEvent() {},
        getSupportState() {
            return { canRecord: true };
        },
        async startRecording() {
            startCalls += 1;
            recording = true;
            return { started: true };
        },
        async stopRecording() {
            stopCalls += 1;
            recording = false;
            return { stopped: true, queued: true, sizeBytes: 1024 };
        },
        isRecording() {
            return recording;
        },
        getRecordingCaptureSettings() {
            return { profile: RECORDING_CAPTURE_PROFILE.CINEMATIC };
        },
        setRecordingCaptureSettings() {},
    };
    const options = {
        game: { render() {} },
        getRuntimeHandle(key) {
            if (key === 'mediaRecorderSystem') return recorder;
            if (key === 'renderer') return { setRecordingCaptureSettings() {} };
            return null;
        },
        showStatusToast() {},
    };

    assert.equal(toggleCinematicRecordingFromHotkey({ ...options, command: 'stop' }), false);
    assert.equal(toggleCinematicRecordingFromHotkey({ ...options, command: 'start' }), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(recording, true);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 0);

    assert.equal(toggleCinematicRecordingFromHotkey({ ...options, command: 'start' }), true);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 0);

    assert.equal(toggleCinematicRecordingFromHotkey({ ...options, command: 'stop' }), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(recording, false);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 1);
});

test('MatchKernel signalRoundEnd stays idempotent during round-end lifecycle', () => {
    const kernel = new MatchKernel();
    kernel.boot({ roundIndex: 2 });

    kernel.signalRoundEnd({ roundPause: 3 });
    kernel.signalRoundEnd({ roundPause: 1 });

    assert.equal(kernel.lifecycle, 'round_end');
    assert.equal(kernel.roundPause, 1);
});

test('MatchKernel poses moving map collision before entity simulation', () => {
    const order = [];
    const kernel = new MatchKernel({
        simPorts: {
            arena: { update: () => order.push('arena') },
            entityManager: { update: () => order.push('entities') },
            powerupManager: { update: () => order.push('powerups') },
        },
    });
    kernel.boot();
    kernel.tick({ fixedStepSeconds: 1 / 60, frameId: 1 }, {});
    assert.deepEqual(order, ['arena', 'entities', 'powerups']);
});

test('GameRuntimeCoordinator completes resource cleanup when an earlier disposer fails', async () => {
    const calls = [];
    const disposeError = new Error('facade dispose failed');
    const components = {
        gameLoop: { stop: () => calls.push('gameLoop') },
        runtimeFacade: { dispose: () => { calls.push('runtimeFacade'); throw disposeError; } },
        matchFlowUiController: { dispose: () => calls.push('matchFlowUiController') },
        huntHud: { dispose: () => calls.push('huntHud') },
        hudRuntimeSystem: { dispose: () => calls.push('hudRuntimeSystem') },
        runtimeDiagnosticsSystem: { dispose: () => calls.push('runtimeDiagnosticsSystem') },
        mediaRecorderSystem: { dispose: () => calls.push('mediaRecorderSystem') },
        input: { dispose: () => calls.push('input') },
        audio: { dispose: () => calls.push('audio') },
        renderer: { dispose: () => calls.push('renderer') },
    };
    const runtime = {};
    const coordinator = new GameRuntimeCoordinator({ runtime });
    coordinator.runtimeBundle = createGameRuntimeBundle({ components });
    coordinator.runtimeFacade = components.runtimeFacade;
    coordinator.uiManager = { dispose: () => calls.push('uiManager') };

    await assert.rejects(coordinator.disposeRuntime(), disposeError);

    assert.deepEqual(calls, [
        'gameLoop',
        'runtimeFacade',
        'matchFlowUiController',
        'huntHud',
        'hudRuntimeSystem',
        'uiManager',
        'runtimeDiagnosticsSystem',
        'mediaRecorderSystem',
        'input',
        'audio',
        'renderer',
    ]);
    assert.equal(coordinator.runtimeBundle, null);
});

test('interactive MatchKernel adapter reuses a minimal envelope and skips unused tick results', () => {
    const updates = [];
    const input = {};
    const kernel = new MatchKernel({
        simPorts: {
            entityManager: {
                update(dt, receivedInput, frameId) {
                    updates.push({ dt, receivedInput, frameId });
                },
            },
        },
    });
    kernel.boot();
    const adapter = new MatchKernelInteractiveAdapter({ game: { input }, kernel });
    const tickEnvelope = adapter._tickEnvelope;

    assert.equal(adapter.tick(1 / 60, 7), null);
    assert.equal(adapter.tick(1 / 30, 8), null);
    assert.equal(adapter._tickEnvelope, tickEnvelope);
    assert.deepEqual(Object.keys(tickEnvelope).sort(), ['fixedStepSeconds', 'frameId']);
    assert.equal(kernel.tickIndex, 2);
    assert.deepEqual(updates, [
        { dt: 1 / 60, receivedInput: input, frameId: 7 },
        { dt: 1 / 30, receivedInput: input, frameId: 8 },
    ]);

    const contractResult = kernel.tick({ fixedStepSeconds: 1 / 60, frameId: 9 }, input);
    assert.equal(contractResult?.tickIndex, 3);
    assert.equal(contractResult?.fixedStepSeconds, 1 / 60);
    adapter.dispose();
});

test('MatchKernel consumer registry exposes interactive adapter and descriptor', () => {
    const registry = createMatchKernelConsumerRegistry();
    try {
        const interactiveAdapter = registry.getAdapter(MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE);
        assert.ok(interactiveAdapter);
        assert.equal(interactiveAdapter.consumerId, MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE);
        assert.equal(registry.getAdapter(undefined)?.consumerId, MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE);

        const descriptors = registry.getDescriptors();
        assert.equal(descriptors.interactive?.consumerId, MATCH_KERNEL_CONSUMER_IDS.INTERACTIVE);
    } finally {
        registry.dispose();
    }
});

test('arcadePort.applyParcoursEvent delegates to coordinator before facade', () => {
    const calls = [];
    const payload = { type: 'ghost_start', routeId: 'map_orbit' };
    const port = createArcadePort({
        getRuntimeCoordinator: () => ({
            applyArcadeParcoursEvent(data) {
                calls.push(['coordinator', data]);
                return 'coordinator';
            },
        }),
        getRuntimeFacade: () => ({
            applyArcadeParcoursEvent(data) {
                calls.push(['facade', data]);
                return 'facade';
            },
        }),
    });

    const result = port.applyParcoursEvent(payload);
    assert.equal(result, 'coordinator');
    assert.deepEqual(calls, [['coordinator', payload]]);
});

test('arcadePort.tickSuddenDeath delegates to coordinator before facade (91.3.2)', () => {
    const calls = [];
    const port = createArcadePort({
        getRuntimeCoordinator: () => ({
            tickArcadeSuddenDeath(dt) {
                calls.push(['coordinator', dt]);
                return 'coordinator';
            },
        }),
        getRuntimeFacade: () => ({
            tickArcadeSuddenDeath(dt) {
                calls.push(['facade', dt]);
                return 'facade';
            },
        }),
    });

    const result = port.tickSuddenDeath(16);
    assert.equal(result, 'coordinator');
    assert.deepEqual(calls, [['coordinator', 16]]);
});

test('lifecyclePort.restartRound delegates through intent adapter chain (91.3.2)', () => {
    const calls = [];
    const game = {
        runtimeBundle: {
            components: {
                runtimeCoordinator: {
                    restartRound() {
                        calls.push('bundle-coordinator');
                        return 'bundle-coordinator';
                    },
                },
            },
        },
    };
    const port = createLifecyclePort(game);
    const result = port.restartRound();
    assert.equal(result, 'bundle-coordinator');
    assert.deepEqual(calls, ['bundle-coordinator']);
});

test('runtimeIntentPort.handleMenuPanelChanged delegates through intent adapter chain (91.3.2)', () => {
    const calls = [];
    const game = {
        runtimeBundle: {
            components: {
                runtimeCoordinator: {
                    handleMenuPanelChanged(prev, next, meta) {
                        calls.push(['coordinator', prev, next, meta]);
                        return 'coordinator';
                    },
                },
            },
        },
    };
    const port = createRuntimeIntentPort(game);
    const result = port.handleMenuPanelChanged('menu-main', 'submenu-game', { trigger: 'nav' });
    assert.equal(result, 'coordinator');
    assert.deepEqual(calls, [['coordinator', 'menu-main', 'submenu-game', { trigger: 'nav' }]]);
});

test('Menu UI sync context resolves access, release, and surface state via one shared resolver (91.3.4)', () => {
    const settings = {
        menuFeatureFlags: {
            developerModeEnabled: false,
        },
        localSettings: {
            ownerId: 'owner',
            actorId: 'owner',
            developerModeVisibility: 'owner_only',
            releasePreviewEnabled: true,
            sessionType: 'single',
            modePath: 'normal',
        },
        mapKey: 'standard',
    };
    const menuUiContext = resolveMenuUiSyncContext(settings, { runtimeGlobal: { __CURVIOS_APP__: true } });

    assert.equal(menuUiContext.surfacePolicy?.productSurfaceId, 'desktop-app');
    assert.equal(menuUiContext.surfaceMenuState?.sessionType, 'single');
    assert.equal(menuUiContext.surfaceMenuState?.modePath, 'normal');
    assert.equal(menuUiContext.accessContext?.isOwner, true);
    assert.equal(menuUiContext.releaseState?.featureEnabled, false);
    assert.equal(menuUiContext.releaseState?.releaseCutEnabled, true);
});

test('UIManager full and targeted sync keep surface copy after the developer text pass', () => {
    const calls = [];
    const manager = Object.create(UIManager.prototype);
    manager.settings = {};
    manager._runSyncCycle = (_settings, run) => run({});
    for (const methodName of [
        'syncDeveloperState',
        'syncSessionState',
        'syncModes',
        'syncMap',
        'syncBots',
        'syncRules',
        'syncGameplay',
        'syncVehicles',
        'syncPresetState',
        'syncMultiplayerState',
    ]) {
        manager[methodName] = () => calls.push(methodName);
    }

    UIManager.prototype.syncAll.call(manager);
    assert.deepEqual(calls.slice(0, 2), ['syncDeveloperState', 'syncSessionState']);
    assert.deepEqual(
        resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES]),
        ['syncDeveloperState', 'syncSessionState']
    );
});

test('UIManager syncByChangeKeys coalesces Start-Setup sync into one snapshot per change cycle (100.5.1)', () => {
    const syncCalls = [];
    const settings = {
        mapKey: 'standard',
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship6',
        },
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
            startSetup: {},
        },
    };
    const manager = Object.create(UIManager.prototype);
    manager.settings = settings;
    manager.ui = {};
    manager._activeSyncCycle = null;
    manager._readMenuMultiplayerSessionState = () => ({ joined: false, connected: false });
    manager._resolveMenuUiContext = () => ({
        surfacePolicy: { productSurfaceId: 'desktop-app' },
        surfaceMenuState: {
            sessionType: 'single',
            modePath: 'normal',
            mapKey: 'standard',
        },
    });
    manager._startSync = {
        syncStartSetupState(_settings, snapshot = null) {
            syncCalls.push(snapshot);
        },
    };
    manager.syncAll = () => {
        throw new Error('syncAll fallback should not execute for known keys');
    };
    manager.syncModes = () => {};
    manager.syncMultiplayerState = () => {};
    manager.syncSessionState = function syncSessionStateStub(nextSettings = this.settings) {
        this._syncStartSetupSnapshot(nextSettings, { menuUiContext: this._resolveMenuUiContext(nextSettings) });
    };
    manager.syncMap = function syncMapStub(nextSettings = this.settings) {
        this._syncStartSetupSnapshot(nextSettings);
    };
    manager.syncVehicles = function syncVehiclesStub(nextSettings = this.settings) {
        this._syncStartSetupSnapshot(nextSettings);
    };

    UIManager.prototype.syncByChangeKeys.call(manager, [
        SETTINGS_CHANGE_KEYS.SESSION_TYPE,
        SETTINGS_CHANGE_KEYS.MAP_KEY,
        SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
    ]);

    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0]?.settings, settings);
    assert.equal(syncCalls[0]?.surfaceMenuState?.modePath, 'normal');
});

test('UIManager syncStartSetupState forced call still emits a snapshot contract (100.5.1)', () => {
    const syncCalls = [];
    const settings = {
        mapKey: 'standard',
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship6' },
        localSettings: { sessionType: 'single', modePath: 'normal', startSetup: {} },
    };
    const manager = Object.create(UIManager.prototype);
    manager.settings = settings;
    manager.ui = {};
    manager._activeSyncCycle = null;
    manager._readMenuMultiplayerSessionState = () => ({ joined: false });
    manager._resolveMenuUiContext = () => ({
        surfacePolicy: { productSurfaceId: 'desktop-app' },
        surfaceMenuState: { sessionType: 'single', modePath: 'normal', mapKey: 'standard' },
    });
    manager._startSync = {
        syncStartSetupState(_settings, snapshot = null) {
            syncCalls.push(snapshot);
        },
    };

    UIManager.prototype.syncStartSetupState.call(manager, settings);

    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0]?.surfacePolicy?.productSurfaceId, 'desktop-app');
    assert.equal(syncCalls[0]?.surfaceMenuState?.sessionType, 'single');
});

test('start setup filters retain the active map instead of previewing a different match', () => {
    class FakeOption {
        constructor() {
            this.value = '';
            this.textContent = '';
            this.dataset = {};
        }
    }

    class FakeSelect {
        constructor() {
            this.options = [];
            this.value = '';
        }

        appendChild(option) {
            this.options.push(option);
            if (!this.value) this.value = option.value;
            return option;
        }

        replaceChildren() {
            this.options = [];
            this.value = '';
        }
    }

    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement(tagName) {
            if (String(tagName).toLowerCase() === 'option') return new FakeOption();
            throw new Error(`unexpected tag: ${tagName}`);
        },
    };

    try {
        const mapSelect = new FakeSelect();
        const startSetup = {
            mapSearch: 'beta',
            mapFilter: 'all',
            vehicleSearch: '',
            vehicleFilter: 'all',
            favoriteMaps: [],
            recentMaps: [],
            favoriteVehicles: [],
            recentVehicles: [],
            modeSelections: {
                normal: {
                    mapKey: 'alpha',
                    vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship6' },
                },
            },
        };
        const settings = {
            mapKey: 'alpha',
            vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship6' },
            localSettings: { modePath: 'normal', startSetup },
        };
        const runtimeMaps = {
            alpha: { name: 'Alpha', size: [80, 30, 80] },
            beta: { name: 'Beta', size: [80, 30, 80] },
        };
        const result = syncStartSetupSelectionState({
            ui: { mapSelect },
            settings,
            startSetup,
            runtimeMaps,
            surfaceMenuState: { mapKey: 'alpha' },
            mapPreviewEntries: [
                { key: 'alpha', name: 'Alpha', category: 'medium' },
                { key: 'beta', name: 'Beta', category: 'medium' },
            ],
            vehiclePreviewEntries: [],
            modePath: 'normal',
            hangarSelectionModePath: 'normal',
            surfacePolicyPort: { isMapAllowed: () => true },
            formatMapLabel: (entry) => entry.name,
            resolveSurfaceFallbackMapKey: () => 'alpha',
            hasStoredCustomMap: () => false,
            ghostDuelState: {},
        });

        assert.equal(result.effectiveMapKey, 'alpha');
        assert.equal(mapSelect.value, 'alpha');
        assert.deepEqual(mapSelect.options.map((option) => option.value), ['beta', 'alpha']);
        assert.equal(mapSelect.options[1].dataset.filterRetained, 'true');
    } finally {
        if (typeof originalDocument === 'undefined') delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('UIStartSyncController renders the mode-specific map without mutating stale settings during sync', () => {
    class FakeOption {
        constructor() {
            this.value = '';
            this.textContent = '';
        }
    }

    class FakeSelect {
        constructor() {
            this._options = [];
            this._value = '';
        }

        get options() {
            return this._options;
        }

        appendChild(option) {
            this._options.push(option);
            if (!this._value) {
                this._value = option.value;
            }
            return option;
        }

        replaceChildren() {
            this._options = [];
            this._value = '';
        }

        set value(nextValue) {
            this._value = String(nextValue || '');
        }

        get value() {
            return this._value;
        }
    }

    const originalDocument = globalThis.document;
    const originalHtmlSelectElement = globalThis.HTMLSelectElement;
    globalThis.document = {
        createElement(tagName) {
            if (String(tagName).toLowerCase() === 'option') {
                return new FakeOption();
            }
            throw new Error(`unexpected tag: ${tagName}`);
        },
    };
    globalThis.HTMLSelectElement = FakeSelect;

    try {
        const settings = {
            mapKey: 'arcade-map',
            vehicles: {
                PLAYER_1: 'ship5',
                PLAYER_2: 'ship6',
            },
            localSettings: {
                sessionType: 'single',
                modePath: 'fight',
                multiplayerTransport: 'lan',
                startSetup: {
                    mapSearch: '',
                    mapFilter: 'all',
                    vehicleSearch: '',
                    vehicleFilter: 'all',
                    favoriteMaps: [],
                    recentMaps: [],
                    favoriteVehicles: [],
                    recentVehicles: [],
                    arcadeGhostDuelMode: 'off',
                    modeSelections: {
                        arcade: {
                            mapKey: 'arcade-map',
                            vehicles: {
                                PLAYER_1: 'ship5',
                                PLAYER_2: 'ship6',
                            },
                        },
                        fight: {
                            mapKey: 'fight-map',
                            vehicles: {
                                PLAYER_1: 'ship5',
                                PLAYER_2: 'ship6',
                            },
                        },
                    },
                },
                toolsState: {
                    level4Open: false,
                },
            },
        };
        const mapSelect = new FakeSelect();
        const controller = new UIStartSyncController({
            ui: {
                mapSelect,
            },
            manager: {
                settings,
                setLevel4Open() {},
                _disposeDisposerList() {},
                _listen() {},
                _setStartSectionOpen() {},
                resolveSurfacePolicy() {
                    return { productSurfaceId: 'desktop-app' };
                },
            },
            port: {
                getSettings() {
                    return settings;
                },
                getMultiplayerSessionState() {
                    return {
                        joined: false,
                        connected: false,
                        readyCount: 0,
                        memberCount: 0,
                    };
                },
                resolveSurfacePolicy() {
                    return { productSurfaceId: 'desktop-app' };
                },
            },
        });
        controller._getRuntimeMaps = () => ({
            'arcade-map': { name: 'Arcade Map', size: [80, 30, 80] },
            'fight-map': { name: 'Fight Map', size: [80, 30, 80] },
        });
        controller._mapPreviewEntries = [
            { key: 'arcade-map', name: 'Arcade Map', category: 'medium' },
            { key: 'fight-map', name: 'Fight Map', category: 'medium' },
        ];
        controller._renderStartFieldHints = () => {};

        controller.syncStartSetupState(settings, {
            surfacePolicy: { productSurfaceId: 'desktop-app' },
            surfaceMenuState: {
                sessionType: 'single',
                modePath: 'fight',
                mapKey: 'arcade-map',
            },
            multiplayerSessionState: {
                joined: false,
                connected: false,
                readyCount: 0,
                memberCount: 0,
            },
        });

        assert.equal(mapSelect.value, 'fight-map');
        assert.equal(settings.mapKey, 'arcade-map');
        assert.equal(settings.localSettings.startSetup.modeSelections.fight.mapKey, 'fight-map');
        assert.equal(settings.localSettings.startSetup.modeSelections.arcade.mapKey, 'arcade-map');
    } finally {
        if (typeof originalDocument === 'undefined') {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
        if (typeof originalHtmlSelectElement === 'undefined') {
            delete globalThis.HTMLSelectElement;
        } else {
            globalThis.HTMLSelectElement = originalHtmlSelectElement;
        }
    }
});

test('UIStartSyncController shows vehicle fallback without repairing invalid settings vehicle', () => {
    class FakeOption {
        constructor() {
            this.value = '';
            this.textContent = '';
        }
    }

    class FakeSelect {
        constructor() {
            this._options = [];
            this._value = '';
        }

        get options() {
            return this._options;
        }

        appendChild(option) {
            this._options.push(option);
            if (!this._value) {
                this._value = option.value;
            }
            return option;
        }

        replaceChildren() {
            this._options = [];
            this._value = '';
        }

        set value(nextValue) {
            this._value = String(nextValue || '');
        }

        get value() {
            return this._value;
        }
    }

    const originalDocument = globalThis.document;
    const originalHtmlSelectElement = globalThis.HTMLSelectElement;
    globalThis.document = {
        createElement(tagName) {
            if (String(tagName).toLowerCase() === 'option') {
                return new FakeOption();
            }
            throw new Error(`unexpected tag: ${tagName}`);
        },
    };
    globalThis.HTMLSelectElement = FakeSelect;

    try {
        const settings = {
            mapKey: 'standard',
            vehicles: {
                PLAYER_1: 'missing_vehicle',
                PLAYER_2: 'ship6',
            },
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
                multiplayerTransport: 'lan',
                startSetup: {
                    mapSearch: '',
                    mapFilter: 'all',
                    vehicleSearch: '',
                    vehicleFilter: 'all',
                    favoriteMaps: [],
                    recentMaps: [],
                    favoriteVehicles: [],
                    recentVehicles: [],
                    arcadeGhostDuelMode: 'off',
                },
                toolsState: {
                    level4Open: false,
                },
            },
        };
        const vehicleSelectP1 = new FakeSelect();
        const controller = new UIStartSyncController({
            ui: {
                vehicleSelectP1,
            },
            manager: {
                settings,
                setLevel4Open() {},
                _disposeDisposerList() {},
                _listen() {},
                _setStartSectionOpen() {},
                resolveSurfacePolicy() {
                    return { productSurfaceId: 'desktop-app' };
                },
            },
            port: {
                getSettings() {
                    return settings;
                },
                getMultiplayerSessionState() {
                    return {
                        joined: false,
                        connected: false,
                        readyCount: 0,
                        memberCount: 0,
                    };
                },
                resolveSurfacePolicy() {
                    return { productSurfaceId: 'desktop-app' };
                },
            },
        });
        controller._getRuntimeMaps = () => ({ standard: { name: 'Standard', size: [80, 30, 80] } });
        controller._renderStartFieldHints = () => {};

        controller.syncStartSetupState(settings, {
            surfacePolicy: { productSurfaceId: 'desktop-app' },
            surfaceMenuState: {
                sessionType: 'single',
                modePath: 'normal',
                mapKey: 'standard',
            },
            multiplayerSessionState: {
                joined: false,
                connected: false,
                readyCount: 0,
                memberCount: 0,
            },
        });

        assert.ok(vehicleSelectP1.value);
        assert.notEqual(vehicleSelectP1.value, 'missing_vehicle');
        assert.equal(settings.vehicles.PLAYER_1, 'missing_vehicle');
    } finally {
        if (typeof originalDocument === 'undefined') {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
        if (typeof originalHtmlSelectElement === 'undefined') {
            delete globalThis.HTMLSelectElement;
        } else {
            globalThis.HTMLSelectElement = originalHtmlSelectElement;
        }
    }
});

test('Start setup rendering seam preserves multiplayer lobby summary and controls', () => {
    class FakeClassList {
        constructor() {
            this.values = new Set();
        }

        add(value) {
            this.values.add(value);
        }

        toggle(value, force = undefined) {
            const enabled = typeof force === 'boolean' ? force : !this.values.has(value);
            if (enabled) {
                this.values.add(value);
            } else {
                this.values.delete(value);
            }
        }
    }

    class FakeElement {
        constructor(tagName = 'div') {
            this.tagName = tagName;
            this.children = [];
            this.dataset = {};
            this.classList = new FakeClassList();
            this.textContent = '';
            this.className = '';
            this.value = '';
            this.title = '';
            this.disabled = false;
            this.readOnly = false;
            this.checked = false;
            this.attributes = new Map();
        }

        get firstChild() {
            return this.children[0] || null;
        }

        appendChild(child) {
            this.children.push(child);
            return child;
        }

        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            return child;
        }

        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        }

        removeAttribute(name) {
            this.attributes.delete(name);
        }
    }

    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement(tagName) {
            return new FakeElement(tagName);
        },
    };

    try {
        const menuSummary = new FakeElement();
        const multiplayerLobbyState = new FakeElement();
        const multiplayerLobbyCodeInput = new FakeElement('input');
        const multiplayerHostAddressInput = new FakeElement('input');
        const multiplayerHostButton = new FakeElement('button');
        const multiplayerJoinButton = new FakeElement('button');
        const multiplayerLeaveLobbyButton = new FakeElement('button');
        const multiplayerStartMatchButton = new FakeElement('button');
        const multiplayerReadyToggle = new FakeElement('input');
        const multiplayerReadyControl = new FakeElement('label');
        const multiplayerTransportHint = new FakeElement();
        const multiplayerConnectionControls = new FakeElement();
        const multiplayerSessionControls = new FakeElement();
        const multiplayerMemberList = new FakeElement();
        const multiplayerMemberCount = new FakeElement();
        const multiplayerShareCode = new FakeElement('output');
        const multiplayerCopyCodeButton = new FakeElement('button');
        const multiplayerShareAddressRow = new FakeElement();
        const multiplayerShareAddress = new FakeElement('output');
        const multiplayerCopyAddressButton = new FakeElement('button');
        const multiplayerManualAddress = new FakeElement('details');
        const startButton = new FakeElement('button');
        const ui = {
            menuSummary,
            startButton,
            multiplayerLobbyState,
            multiplayerLobbyCodeInput,
            multiplayerHostAddressInput,
            multiplayerHostButton,
            multiplayerJoinButton,
            multiplayerLeaveLobbyButton,
            multiplayerStartMatchButton,
            multiplayerReadyToggle,
            multiplayerReadyControl,
            multiplayerTransportHint,
            multiplayerConnectionControls,
            multiplayerSessionControls,
            multiplayerMemberList,
            multiplayerMemberCount,
            multiplayerShareCode,
            multiplayerCopyCodeButton,
            multiplayerShareAddressRow,
            multiplayerShareAddress,
            multiplayerCopyAddressButton,
            multiplayerManualAddress,
        };
        const surfaceEntryCopy = {
            sessionSummaryLabels: { multiplayer: 'Multiplayer' },
            multiplayerClientRoleLabel: 'Client',
            joinButtonLabel: 'Beitreten',
            hostActionAvailable: true,
        };
        const sessionContract = {
            transportAudienceLabel: 'LAN',
            isLegacyTransport: false,
        };
        const multiplayerSessionState = {
            joined: true,
            lobbyCode: 'ABCD',
            isHost: false,
            pendingMatchCommandId: 'cmd-1',
            connected: true,
            memberCount: 2,
            maxPlayers: 6,
            shareAddress: '192.168.1.8:9090',
            readyCount: 2,
            localReady: true,
            canStart: false,
            members: [
                { peerId: 'peer-host', actorId: 'Host', isHost: true, isLocal: false, ready: true },
                { peerId: 'peer-client', actorId: 'Client', isHost: false, isLocal: true, ready: true },
            ],
        };
        const ghostDuelState = {
            effectiveMode: 'off',
            duelSelectable: false,
            effectiveTrailCollisionEnabled: false,
            trailCollisionSelectable: false,
        };

        renderStartSetupSummaryAndPreview({
            ui,
            settings: {
                vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship6' },
                localSettings: { themeMode: 'dunkel' },
            },
            sessionType: 'multiplayer',
            modePath: 'normal',
            effectiveMapKey: 'standard',
            surfaceEntryCopy,
            sessionContract,
            resolvedMultiplayerSessionState: multiplayerSessionState,
            hasActiveLobbySession: true,
            ghostDuelState,
        });
        syncStartSetupMultiplayerUi({
            ui,
            sessionType: 'multiplayer',
            surfaceEntryCopy,
            sessionContract,
            multiplayerTransportUiState: {
                allowedTransports: ['lan'],
                selectedTransport: 'lan',
                selectedTransportLabel: 'LAN',
                onlineConfigured: false,
                isOnlineUnconfigured: false,
            },
            resolvedMultiplayerSessionState: multiplayerSessionState,
            hasActiveLobbySession: true,
        });

        const summaryByLabel = new Map(menuSummary.children.map((block) => [
            block.children[0]?.textContent,
            block.children[1]?.textContent,
        ]));
        assert.equal(summaryByLabel.get('Session'), 'Multiplayer');
        assert.equal(summaryByLabel.get('Lobby'), 'ABCD | Client | Startsignal gesendet | 2/2 bereit');
        assert.equal(summaryByLabel.get('Transport'), 'LAN');
        assert.equal(multiplayerLobbyState.textContent, 'ABCD | Client | Startsignal gesendet | 2 Teilnehmer | 2/2 bereit');
        assert.equal(multiplayerLobbyCodeInput.value, 'ABCD');
        assert.equal(multiplayerLobbyCodeInput.readOnly, true);
        assert.equal(multiplayerHostAddressInput.readOnly, true);
        assert.equal(multiplayerHostButton.disabled, true);
        assert.equal(multiplayerJoinButton.disabled, true);
        assert.equal(multiplayerLeaveLobbyButton.disabled, false);
        assert.equal(multiplayerReadyToggle.checked, true);
        assert.equal(multiplayerTransportHint.textContent, 'Verbindung: LAN');
        assert.equal(multiplayerMemberList.children.length, 2);
        assert.equal(multiplayerMemberCount.textContent, '2 / 6');
        assert.equal(multiplayerShareCode.textContent, 'ABCD');
        assert.equal(multiplayerShareAddress.textContent, '192.168.1.8:9090');
        assert.equal(multiplayerShareAddressRow.classList.values.has('hidden'), false);
        assert.equal(multiplayerStartMatchButton.disabled, true);
        assert.equal(multiplayerStartMatchButton.textContent, 'Match wird gestartet …');
        assert.equal(startButton.classList.values.has('hidden'), true);
        assert.equal(multiplayerConnectionControls.classList.values.has('hidden'), true);
        assert.equal(multiplayerSessionControls.classList.values.has('hidden'), false);
    } finally {
        if (typeof originalDocument === 'undefined') {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
    }
});

test('Developer release state helper keeps release-cut contract stable (91.3.4)', () => {
    const releaseState = resolveDeveloperReleaseState({
        menuFeatureFlags: { developerModeEnabled: true },
        localSettings: { releasePreviewEnabled: false },
    });
    const releaseCutState = resolveDeveloperReleaseState({
        menuFeatureFlags: { developerModeEnabled: true },
        localSettings: { releasePreviewEnabled: true },
    });

    assert.deepEqual(releaseState, {
        featureEnabled: true,
        releasePreviewEnabled: false,
        developerUiHidden: false,
        releaseCutEnabled: false,
    });
    assert.deepEqual(releaseCutState, {
        featureEnabled: true,
        releasePreviewEnabled: true,
        developerUiHidden: false,
        releaseCutEnabled: true,
    });
});

test('GameRuntimeFacade match end telemetry uses dedicated arcade handler', () => {
    const payload = { state: 'MATCH_END', completedSectors: 3 };
    const calls = [];
    const telemetrySnapshot = { ok: true };
    const runtimeFacadeContext = {
        _arcadeSupport: {
            recordMatchEndTelemetry(value, options = {}) {
                calls.push(['arcade', value]);
                return options.recordMenuTelemetry?.('match_end', value);
            },
        },
        _recordMenuTelemetry(eventType, value) {
            calls.push(['menu', eventType, value]);
            return telemetrySnapshot;
        },
    };

    const result = GameRuntimeFacade.prototype.recordMatchEndTelemetry.call(runtimeFacadeContext, payload);

    assert.equal(result, telemetrySnapshot);
    assert.deepEqual(calls, [
        ['arcade', payload],
        ['menu', 'match_end', payload],
    ]);
});

test('GameRuntimeFacade recording helpers delegate to recording support seam (92.4.2)', () => {
    const calls = [];
    const runtimeFacadeContext = {
        _recordingSupport: {
            toggleCinematicRecordingFromHotkey() {
                calls.push(['toggle']);
                return 'toggle-result';
            },
            finalizeRound(winner, players, options) {
                calls.push(['finalize', winner, players, options]);
                return 'finalize-result';
            },
            dump() {
                calls.push(['dump']);
                return 'dump-result';
            },
        },
    };

    const toggleResult = GameRuntimeFacade.prototype.toggleCinematicRecordingFromHotkey.call(runtimeFacadeContext);
    const finalizeResult = GameRuntimeFacade.prototype.finalizeRoundRecording.call(
        runtimeFacadeContext,
        'winner',
        ['p1', 'p2'],
        { reason: 'contract-test' }
    );
    const dumpResult = GameRuntimeFacade.prototype.dumpRoundRecording.call(runtimeFacadeContext);

    assert.equal(toggleResult, 'toggle-result');
    assert.equal(finalizeResult, 'finalize-result');
    assert.equal(dumpResult, 'dump-result');
    assert.deepEqual(calls, [
        ['toggle'],
        ['finalize', 'winner', ['p1', 'p2'], { reason: 'contract-test' }],
        ['dump'],
    ]);
});

test('GameRuntimeFacade arcade helpers delegate to arcade support seam (92.4.2)', () => {
    const calls = [];
    const runtimeFacadeContext = {
        _arcadeSupport: {
            startRunIfEnabled() {
                calls.push(['start']);
                return 'start-result';
            },
            prepareMatchStartRuntime() {
                calls.push(['prepare']);
                return 'prepare-result';
            },
            consumePendingSectorTransition() {
                calls.push(['transition']);
                return { requiresSessionRebuild: true };
            },
            applyParcoursEvent(data = null) {
                calls.push(['parcours', data]);
                return { ok: true };
            },
            getMenuSurfaceState() {
                calls.push(['menu-state']);
                return { phase: 'intermission' };
            },
            requestReplayPlayback() {
                calls.push(['replay']);
                return { code: 'ok' };
            },
        },
    };

    const startResult = GameRuntimeFacade.prototype.startArcadeRunIfEnabled.call(runtimeFacadeContext);
    const prepareResult = GameRuntimeFacade.prototype.prepareArcadeMatchStartRuntime.call(runtimeFacadeContext);
    const transitionResult = GameRuntimeFacade.prototype.consumePendingArcadeSectorTransition.call(runtimeFacadeContext);
    const parcoursResult = GameRuntimeFacade.prototype.applyArcadeParcoursEvent.call(
        runtimeFacadeContext,
        { type: 'ghost_start', routeId: 'route_1' }
    );
    const menuStateResult = GameRuntimeFacade.prototype.getArcadeMenuSurfaceState.call(runtimeFacadeContext);
    const replayResult = GameRuntimeFacade.prototype.requestArcadeReplayPlayback.call(runtimeFacadeContext);

    assert.equal(startResult, 'start-result');
    assert.equal(prepareResult, 'prepare-result');
    assert.deepEqual(transitionResult, { requiresSessionRebuild: true });
    assert.deepEqual(parcoursResult, { ok: true });
    assert.deepEqual(menuStateResult, { phase: 'intermission' });
    assert.deepEqual(replayResult, { code: 'ok' });
    assert.deepEqual(calls, [
        ['start'],
        ['prepare'],
        ['transition'],
        ['parcours', { type: 'ghost_start', routeId: 'route_1' }],
        ['menu-state'],
        ['replay'],
    ]);
});

test('GameRuntimeSessionHandler rebuilds the session for an Arcade sector profile change', () => {
    const calls = [];
    const handler = new GameRuntimeSessionHandler({
        facade: {
            consumePendingArcadeSectorTransition() {
                return { requiresSessionRebuild: true, toMap: 'complex', botCount: 5 };
            },
            ports: {
                matchUiPort: {
                    startRound() {
                        calls.push('start-round');
                    },
                },
            },
        },
        logger: console,
    });
    handler.startMatch = (options) => {
        calls.push(['start-match', options]);
        return 'rebuild-result';
    };

    const result = handler.restartRound();

    assert.equal(result, 'rebuild-result');
    assert.deepEqual(calls, [[
        'start-match',
        {
            source: 'arcade_sector_transition',
            arcadeSectorTransition: { requiresSessionRebuild: true, toMap: 'complex', botCount: 5 },
        },
    ]]);
});

test('LAN runtime player slots use lobby membership before WebRTC peers connect', () => {
    const game = {
        runtimeConfig: {
            session: {
                networkEnabled: true,
            },
        },
    };
    const facade = {
        game,
        session: {
            isHost: true,
            localPlayerId: 'host',
            isConnected: true,
            getPlayers: () => [
                { id: 'host', peerId: 'host', isHost: true, connected: true },
            ],
        },
        menuMultiplayerBridge: {
            getSessionState: () => ({
                peerId: 'host',
                hostPeerId: 'host',
                members: [
                    { peerId: 'host', isHost: true, isLocal: true, ready: true, joinedAt: 1 },
                    { peerId: 'player-1', isHost: false, ready: true, joinedAt: 2 },
                ],
            }),
        },
    };

    const context = applyRuntimeNetworkPlayerSlotContext(facade);

    assert.equal(context.humanEntityCount, 2);
    assert.equal(context.localPlayerIndex, 0);
    assert.deepEqual(
        game.runtimeConfig.session.networkPlayerSlots.map((slot) => [slot.peerId, slot.playerIndex, slot.isLocal]),
        [
            ['host', 0, true],
            ['player-1', 1, false],
        ]
    );
});

test('LAN client runtime slots keep host at index zero even when adapter lists local first', () => {
    const slots = resolveRuntimeNetworkPlayerSlots({
        session: {
            isHost: false,
            localPlayerId: 'player-1',
            getPlayers: () => [
                { id: 'player-1', peerId: 'player-1', isHost: false },
                { id: 'host', peerId: 'host', isHost: true },
            ],
        },
        lobbyState: {
            peerId: 'player-1',
            hostPeerId: 'host',
            members: [
                { peerId: 'host', isHost: true, joinedAt: 1 },
                { peerId: 'player-1', isLocal: true, joinedAt: 2 },
            ],
        },
    });

    assert.deepEqual(
        slots.map((slot) => [slot.peerId, slot.playerIndex, slot.isLocal]),
        [
            ['host', 0, false],
            ['player-1', 1, true],
        ]
    );
});

test('LAN client input binds local controls to its network slot only', () => {
    const sources = new Map();
    const sentInputs = [];
    const input = {
        clearPlayerSources() {
            sources.clear();
        },
        setPlayerSource(playerIndex, source) {
            source.bind(playerIndex);
            sources.set(playerIndex, source);
        },
    };
    const session = {
        isHost: false,
        sendInput(payload) {
            sentInputs.push(payload);
        },
    };
    const game = {
        input,
        runtimeConfig: {
            session: {
                networkEnabled: true,
                localHumanCount: 1,
                localPlayerIndex: 1,
                networkPlayerSlots: [
                    { peerId: 'host', playerIndex: 0, isHost: true, isLocal: false },
                    { peerId: 'player-1', playerIndex: 1, isHost: false, isLocal: true },
                ],
            },
        },
    };
    const controller = Object.create(MatchFlowUiController.prototype);
    controller.runtime = game;
    controller.runtimePort = {
        getNetworkMatchInputContext: () => ({ session, slots: [] }),
    };
    controller._createPreferredInputSource = (playerIndex, _localHumanCount, options = {}) => ({
        bind(boundIndex) {
            this.boundIndex = boundIndex;
        },
        unbind() {},
        dispose() {},
        poll() {
            return {
                yawRight: playerIndex === 1 && options.inputDeviceIndex === 0,
                boost: playerIndex === 1,
            };
        },
    });

    MatchFlowUiController.prototype._configureInputSourcesForMatch.call(controller);

    assert.equal(sources.size, 2);
    assert.deepEqual(sources.get(0).poll(), {
        pitchUp: false,
        pitchDown: false,
        yawLeft: false,
        yawRight: false,
        rollLeft: false,
        rollRight: false,
        boost: false,
        boostPressed: false,
        cameraSwitch: false,
        dropItem: false,
        useItem: false,
        shootItem: false,
        shootRocket: false,
        shootMG: false,
        nextItem: false,
    });
    assert.equal(sources.get(1).poll().yawRight, true);
    assert.equal(sentInputs.length, 1);
    assert.equal(sentInputs[0].playerIndex, 1);
    assert.equal(sentInputs[0].playerId, 'player-1');
});

test('GameRuntimeSessionHandler applies received LAN match-start commands locally', async () => {
    const calls = [];
    const game = {
        state: null,
        settings: {
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'lan',
            },
        },
        uiManager: {
            clearStartValidationError() {
                calls.push('clearValidation');
            },
            showStartValidationError() {
                calls.push('showValidation');
            },
        },
        _showStatusToast(message) {
            calls.push(['toast', message]);
        },
    };
    const facade = {
        game,
        menuMultiplayerBridge: {
            requestMatchStart() {
                calls.push('requestMatchStart');
                return { ok: true };
            },
        },
        _clearMatchPrewarmTimer() {
            calls.push('clearPrewarm');
        },
        _applyAuthoritativeMultiplayerMatchSettings(snapshot = {}) {
            calls.push(['applySnapshot', snapshot.localSettings?.multiplayerTransport || '']);
            game.settings = {
                ...game.settings,
                ...snapshot,
                localSettings: {
                    ...(game.settings.localSettings || {}),
                    ...(snapshot.localSettings || {}),
                },
            };
        },
        _applySettingsToRuntimeInternal(options = {}) {
            calls.push(['applyRuntime', options.source || '']);
            return true;
        },
        settingsHandler: {
            applySurfacePolicyStartDefaults() {
                calls.push('startDefaults');
            },
        },
        _recordMenuTelemetry(type, payload = {}) {
            calls.push(['telemetry', type, payload.sessionType || '']);
        },
        _resolveStartValidationIssue() {
            calls.push('validation');
            return {
                message: 'Nur der Host darf das Match starten.',
                fieldKey: 'multiplayer',
            };
        },
        getUiManager() {
            return game.uiManager;
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
                    prepareMatchStartProjection() {
                        calls.push('applyStart');
                        return true;
                    },
                    startRound() {
                        game.state = 'PLAYING';
                    },
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
    const handler = new GameRuntimeSessionHandler({ facade, logger: console });

    const result = await handler.startMatch({
        source: 'menu_multiplayer_bridge',
        commandId: 'match-live',
        settingsSnapshot: {
            mapKey: 'standard',
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'lan',
            },
        },
    });

    assert.equal(result, true);
    assert.equal(game.state, 'PLAYING');
    assert.equal(calls.includes('requestMatchStart'), false);
    assert.equal(calls.includes('applyStart'), true);
    assert.equal(calls.includes('validation'), false);
});

test('GameRuntimeSessionHandler validates before preparing Arcade match state', async () => {
    const calls = [];
    const game = {
        state: null,
        settings: {
            localSettings: {
                sessionType: 'single',
                modePath: 'arcade',
            },
        },
        uiManager: {
            showStartValidationError() {
                calls.push('showValidation');
            },
        },
        _showStatusToast() {},
    };
    const facade = {
        game,
        _clearMatchPrewarmTimer() {},
        _applySettingsToRuntimeInternal() {},
        settingsHandler: {
            applySurfacePolicyStartDefaults() {},
            applyMapScenarioStartDefaults() {},
        },
        _recordMenuTelemetry() {},
        _resolveStartValidationIssue() {
            calls.push('validate');
            return { message: 'Start blockiert', fieldKey: 'map' };
        },
        prepareArcadeMatchStartRuntime() {
            calls.push('prepareArcade');
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
                    prepareMatchStartProjection() {
                        calls.push('prepareMatch');
                    },
                },
            };
        },
    };
    const handler = new GameRuntimeSessionHandler({ facade, logger: console });

    const result = await handler.startMatch();

    assert.equal(result, false);
    assert.deepEqual(calls, ['validate', 'showValidation']);
});

test('Arcade HUD consumes the arcade projection while the wrapped game mode remains classic', () => {
    const scoreStates = [];
    const missionStates = [];
    let hideCount = 0;
    const overlay = {
        tickXp() {},
        tickSplitDelta() {},
        tickPenalty() {},
        tickMinimap() {},
        tickStatsFlash() {},
    };
    const system = new HudRuntimeSystem({ game: {} });
    system._ensureArcadeHud = () => {
        system._arcadeScoreHud = { update: (state) => scoreStates.push(state) };
        system._arcadeMissionHud = { update: (state) => missionStates.push(state) };
    };
    system._ensureArcadeFeedbackOverlays = () => {};
    system._ensureParcoursOverlay = () => overlay;
    system._hideArcadeHud = () => { hideCount += 1; };

    const arcadeState = {
        nowMs: 100,
        phase: 'sector_active',
        sectorIndex: 1,
        missionState: { missions: [{ type: 'KILL_COUNT' }] },
        score: { total: 1337 },
    };
    system._updateArcadeHud({ modeId: 'CLASSIC', arcade: arcadeState });

    assert.equal(hideCount, 0);
    assert.deepEqual(scoreStates, [arcadeState]);
    assert.deepEqual(missionStates, [arcadeState.missionState]);
});

test('Arcade overlay consumes the arcade projection while the wrapped game mode remains classic', () => {
    const arcadeState = { phase: 'intermission' };
    const menuSurfaceState = { intermission: { choices: [] } };
    const game = {
        state: 'ROUND_END',
        ui: {
            messageOverlay: {
                classList: { contains: () => false },
            },
        },
    };
    const controller = new MatchFlowArcadeOverlayController({
        game,
        runtimePort: {
            getMatchRuntimeProjection: () => ({ modeId: 'CLASSIC', arcade: arcadeState }),
            getArcadeMenuSurfaceState: () => menuSurfaceState,
        },
    });
    const renderedStates = [];
    let clearCount = 0;
    controller._renderArcadeIntermissionPanel = (state) => {
        renderedStates.push(state);
        return true;
    };
    controller.clearArcadeOverlayPanel = () => { clearCount += 1; };

    controller.syncArcadeOverlayPanel();

    assert.equal(clearCount, 0);
    assert.deepEqual(renderedStates, [menuSurfaceState]);
});

test('GameRuntimeSettingsHandler aligns mode selections before authoritative menu sync', () => {
    const uiCalls = [];
    const game = {
        settings: {
            mapKey: 'mega_maze',
            gameMode: 'HUNT',
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'storage-bridge',
                modePath: 'fight',
                startSetup: {
                    modeSelections: {
                        fight: {
                            mapKey: 'mega_maze',
                            vehicles: {
                                PLAYER_1: 'ship5',
                                PLAYER_2: 'ship5',
                            },
                        },
                    },
                },
            },
        },
        settingsManager: {
            applyMenuCompatibilityRules() {
                return { changedKeys: [] };
            },
        },
        uiManager: {
            syncAll() {
                uiCalls.push('syncAll');
                game.settings.mapKey = game.settings.localSettings.startSetup.modeSelections.fight.mapKey;
            },
            updateContext() {
                uiCalls.push('updateContext');
            },
        },
        ui: {},
    };
    const handler = new GameRuntimeSettingsHandler({
        facade: {
            game,
            _resolveMenuAccessContext: () => ({ isOwner: true }),
        },
    });

    handler.applyAuthoritativeMultiplayerMatchSettings({
        mapKey: 'maze',
        localSettings: {
            sessionType: 'multiplayer',
            multiplayerTransport: 'storage-bridge',
            modePath: 'fight',
        },
    });

    assert.equal(game.settings.mapKey, 'maze');
    assert.equal(game.settings.localSettings.startSetup.modeSelections.fight.mapKey, 'maze');
    assert.deepEqual(uiCalls, ['syncAll', 'updateContext']);
    assert.equal(game.settingsDirty, false);
});

test('GameRuntimeSettingsHandler cancels pending autosave during disposal', async () => {
    let saveCalls = 0;
    const facade = {
        _disposed: false,
        game: {
            _saveSettings() {
                saveCalls += 1;
            },
        },
    };
    const handler = new GameRuntimeSettingsHandler({ facade });

    handler._scheduleSettingsAutoSave();
    handler.dispose();
    facade._disposed = true;
    await new Promise((resolve) => setTimeout(resolve, 450));

    assert.equal(saveCalls, 0);
    assert.equal(handler._pendingAutoSaveId, null);
    assert.equal(handler._facade, null);
});

test('GameRuntimeSessionHandler queues a synchronous authoritative lobby start behind the host request', async () => {
    const calls = [];
    let handler = null;
    let authoritativeStartPromise = null;
    const game = {
        state: null,
        settings: {
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'storage-bridge',
            },
        },
        uiManager: {
            clearStartValidationError() {},
        },
    };
    const facade = {
        game,
        menuMultiplayerBridge: {
            requestMatchStart() {
                calls.push('requestMatchStart');
                authoritativeStartPromise = handler.startMatch({
                    source: 'menu_multiplayer_bridge',
                    commandId: 'match-sync',
                    settingsSnapshot: {
                        mapKey: 'maze',
                        localSettings: {
                            sessionType: 'multiplayer',
                            multiplayerTransport: 'storage-bridge',
                        },
                    },
                });
                return { ok: true };
            },
        },
        _clearMatchPrewarmTimer() {},
        _applyAuthoritativeMultiplayerMatchSettings(snapshot = {}) {
            game.settings = {
                ...game.settings,
                ...snapshot,
                localSettings: {
                    ...(game.settings.localSettings || {}),
                    ...(snapshot.localSettings || {}),
                },
            };
        },
        _applySettingsToRuntimeInternal() {
            return true;
        },
        settingsHandler: {
            applySurfacePolicyStartDefaults() {},
        },
        _recordMenuTelemetry() {},
        _resolveStartValidationIssue() {
            return null;
        },
        getUiManager() {
            return game.uiManager;
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
                    prepareMatchStartProjection() {
                        calls.push('applyStart');
                        return true;
                    },
                    startRound() {
                        game.state = 'PLAYING';
                    },
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
    handler = new GameRuntimeSessionHandler({ facade, logger: console });

    const hostRequestResult = await handler.startMatch();
    const authoritativeResult = await authoritativeStartPromise;

    assert.equal(hostRequestResult, true);
    assert.equal(authoritativeResult, true);
    assert.equal(game.state, 'PLAYING');
    assert.equal(game.settings.mapKey, 'maze');
    assert.deepEqual(calls, ['requestMatchStart', 'applyStart']);
});
