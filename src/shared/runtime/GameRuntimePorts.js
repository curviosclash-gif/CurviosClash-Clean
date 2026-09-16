import { GAME_STATE_IDS } from '../contracts/GameStateIds.js';
import { resolveRuntimeSessionContract } from '../contracts/RuntimeSessionContract.js';
import {
    createMatchFlowSnapshot,
    createRuntimeObservabilitySnapshot,
    createSessionRuntimeSnapshot,
} from '../contracts/SessionRuntimeSnapshotContract.js';
import { createEntityRuntimeConfig } from '../contracts/EntityRuntimeConfig.js';
import { createArcadePort, createRecordingPort } from './GameRuntimeFeaturePorts.js';
import { buildMatchRenderProjection as buildMatchRenderProjectionSnapshot } from './MatchRenderProjectionBuilder.js';
import { buildMatchRuntimeProjection as buildMatchRuntimeProjectionSnapshot } from './MatchRuntimeProjectionBuilder.js';
import { createMatchStatePort } from './MatchStatePort.js';
import { createMatchUiPort } from './MatchUiPort.js';

function noop() {}
const RUNTIME_PORT_ADAPTER_SOURCES = Object.freeze({
    BUNDLE_COORDINATOR: 'runtime-bundle:runtimeCoordinator',
    UNRESOLVED: 'unresolved',
});
function getRuntimeBundle(game) {
    return game?.runtimeBundle || null;
}
function getSessionRuntime(game) {
    return getRuntimeBundle(game)?.sessionRuntime || game?.sessionRuntime || null;
}
function getRuntimeState(game) {
    return getRuntimeBundle(game)?.state || null;
}
function getMenuMultiplayerBridge(game) {
    return getRuntimeState(game)?.menuMultiplayerBridge || null;
}

function getRuntimeComponents(game) {
    return getRuntimeBundle(game)?.components || null;
}

function getRuntimeComponent(game, key) {
    return getRuntimeComponents(game)?.[key] || null;
}

function getRuntimeHandle(game, key) {
    return getSessionRuntime(game)?.handles?.[key] || null;
}

function getRuntimeFacade(game) {
    return getRuntimeHandle(game, 'runtimeFacade')
        || getRuntimeComponent(game, 'runtimeFacade')
        || null;
}

function getRuntimeCoordinator(game) {
    return getRuntimeHandle(game, 'runtimeCoordinator')
        || getRuntimeComponent(game, 'runtimeCoordinator')
        || null;
}

function getUiManager(game) {
    return getRuntimeHandle(game, 'uiManager')
        || getRuntimeComponent(game, 'uiManager')
        || null;
}

function resolveRuntimeIntentAdapter(game, methodName) {
    const coordinator = getRuntimeCoordinator(game);
    if (typeof coordinator?.[methodName] === 'function') {
        return {
            adapter: coordinator,
            source: RUNTIME_PORT_ADAPTER_SOURCES.BUNDLE_COORDINATOR,
        };
    }

    return {
        adapter: null,
        source: RUNTIME_PORT_ADAPTER_SOURCES.UNRESOLVED,
    };
}

function resolveSessionRuntimeAccess(game) {
    const sessionContract = resolveRuntimeSessionContract({
        sessionType: game?.settings?.localSettings?.sessionType,
        multiplayerTransport: getMenuMultiplayerBridge(game)?.transport || game?.settings?.localSettings?.multiplayerTransport,
    });
    const facade = getRuntimeFacade(game);
    const runtimeSession = facade?.session || null;
    const multiplayerSessionState = getMenuMultiplayerBridge(game)?.getSessionState?.() || null;
    const hasJoinedMultiplayerSession = multiplayerSessionState?.joined === true;

    return {
        sessionType: sessionContract.sessionType,
        runtimeTransportKind: sessionContract.runtimeTransportKind,
        isNetworkSession: sessionContract.isNetworkSession,
        isHost: typeof runtimeSession?.isHost === 'boolean'
            ? runtimeSession.isHost
            : (hasJoinedMultiplayerSession ? multiplayerSessionState.isHost !== false : true),
    };
}

function buildSessionRuntimeProjection(game) {
    const sessionRuntime = getSessionRuntime(game);
    const lifecycle = sessionRuntime?.lifecycle || {};
    const finalize = sessionRuntime?.finalize || {};
    const session = sessionRuntime?.session || {};
    const sessionAccess = resolveSessionRuntimeAccess(game);
    const updatedAt = Math.max(
        Number(lifecycle.updatedAt) || 0,
        Number(finalize.updatedAt) || 0
    );

    return createSessionRuntimeSnapshot({
        sessionId: session.activeSessionId || null,
        lifecycleState: lifecycle.status || 'unknown',
        finalizeState: finalize.status || 'idle',
        gameStateId: lifecycle.gameStateId || game?.state || '',
        sessionType: sessionAccess.sessionType,
        runtimeTransportKind: sessionAccess.runtimeTransportKind,
        isNetworkSession: sessionAccess.isNetworkSession,
        isHost: sessionAccess.isHost,
        pendingSessionInit: !!lifecycle.pendingSessionInit,
        pendingFinalizeTrigger: finalize.lastTrigger || '',
        finalizeErrorMessage: finalize.errorMessage || '',
        updatedAt,
    });
}

function buildMatchFlowProjection(game) {
    const sessionSnapshot = buildSessionRuntimeProjection(game);
    const gameStateId = sessionSnapshot.gameStateId || game?.state || GAME_STATE_IDS.MENU;
    return createMatchFlowSnapshot({
        sessionId: sessionSnapshot.sessionId,
        gameStateId,
        uiStateId: gameStateId,
        roundStateId: gameStateId === GAME_STATE_IDS.ROUND_END ? GAME_STATE_IDS.ROUND_END : '',
        isPaused: gameStateId === GAME_STATE_IDS.PAUSED,
        canReturnToMenu: gameStateId !== GAME_STATE_IDS.MENU
            && sessionSnapshot.finalizeState !== 'finalizing'
            && sessionSnapshot.finalizeState !== 'error',
        pendingFinalizeTrigger: sessionSnapshot.pendingFinalizeTrigger,
        finalizeErrorMessage: sessionSnapshot.finalizeErrorMessage,
        isNetworkSession: sessionSnapshot.isNetworkSession,
        isHost: sessionSnapshot.isHost,
        lifecycleState: sessionSnapshot.lifecycleState,
        finalizeState: sessionSnapshot.finalizeState,
        updatedAt: sessionSnapshot.updatedAt,
    });
}

function buildRuntimeObservabilityProjection(game) {
    const sessionRuntime = getSessionRuntime(game);
    const lifecycle = sessionRuntime?.lifecycle || {};
    const finalize = sessionRuntime?.finalize || {};
    const observability = sessionRuntime?.observability || {};
    const recentEvents = Array.isArray(observability.events)
        ? observability.events.slice(-40)
        : [];
    const updatedAt = Math.max(
        Number(lifecycle.updatedAt) || 0,
        Number(finalize.updatedAt) || 0,
        Number(observability.updatedAt) || 0
    );
    return createRuntimeObservabilitySnapshot({
        sessionId: sessionRuntime?.session?.activeSessionId || null,
        lifecycleState: lifecycle.status || 'unknown',
        finalizeState: finalize.status || 'idle',
        pendingSessionInit: !!lifecycle.pendingSessionInit,
        pendingFinalize: !!finalize.pendingOperation,
        finalizeErrorMessage: finalize.errorMessage || '',
        lastSequence: Number(observability.sequence) || 0,
        lastEventType: observability.lastEventType || '',
        eventCount: Array.isArray(observability.events) ? observability.events.length : 0,
        updatedAt,
        recentEvents,
    });
}

function callRuntimeIntent(game, methodName, options = undefined) {
    const resolvedAdapter = resolveRuntimeIntentAdapter(game, methodName);
    return resolvedAdapter.adapter?.[methodName]?.(options);
}

export function createSettingsPort(game) {
    return {
        getSettings: () => game?.settings || null,
        getRuntimeConfig: () => getRuntimeState(game)?.runtimeConfig || null,
        applyAutoRoll(value) {
            const checked = !!value;
            const runtimeState = getRuntimeState(game);
            if (game?.settings) {
                game.settings.autoRoll = checked;
            }
            if (runtimeState?.runtimeConfig?.player) {
                runtimeState.runtimeConfig.player.autoRoll = checked;
            }
            const entityManager = runtimeState?.entityManager;
            if (runtimeState?.runtimeConfig && typeof entityManager?.applyLiveRuntimeConfig === 'function') {
                entityManager.applyLiveRuntimeConfig(
                    createEntityRuntimeConfig(runtimeState.runtimeConfig, entityManager.entityRuntimeConfig),
                    runtimeState.runtimeConfig
                );
            }
        },
        setBindings(bindings) {
            getRuntimeComponents(game)?.input?.setBindings?.(bindings);
        },
        syncUiByChangedKeys(changedKeys) {
            const uiManager = getUiManager(game);
            if (Array.isArray(changedKeys) && changedKeys.length > 0) {
                uiManager?.syncByChangeKeys?.(changedKeys);
                return;
            }
            uiManager?.syncAll?.();
        },
        clearStartValidationError() {
            getUiManager(game)?.clearStartValidationError?.();
        },
    };
}

export function createUiFeedbackPort(game) {
    return {
        getUi: () => getRuntimeComponents(game)?.ui || game?.ui || null,
        showStatusToast(message, durationMs, tone) {
            game?._showStatusToast?.(message, durationMs, tone);
        },
        showPlayerFeedback(player, message) {
            game?._showPlayerFeedback?.(player, message);
        },
        getDeathMessage(cause) {
            return game?._getDeathMessage?.(cause) || '';
        },
        syncAll() {
            getUiManager(game)?.syncAll?.();
        },
        showMenuPanel(panelId, options = undefined) {
            getUiManager(game)?.menuNavigationRuntime?.showPanel?.(panelId, options);
        },
        toggleP2Hud(isVisible) {
            getRuntimeComponents(game)?.hudP2?.setVisibility?.(!!isVisible);
        },
    };
}

export function createSessionPort(game) {
    return {
        getGame: () => game || null,
        getState: () => game?.state || null,
        setState(state) {
            if (game) {
                game.state = state;
            }
        },
        getEntityManager: () => getRuntimeState(game)?.entityManager || null,
        clearLastRoundGhost() {
            const entityManager = getRuntimeState(game)?.entityManager || null;
            entityManager?.clearLastRoundGhost?.();
        },
        finalizeMatchSession(options = undefined) {
            const matchSessionOrchestrator = getRuntimeComponent(game, 'matchSessionOrchestrator');
            return matchSessionOrchestrator?.finalizeMatchSession?.(options)
                ?? matchSessionOrchestrator?.teardownMatchSession?.(options);
        },
        teardownMatchSession(options = undefined) {
            return this.finalizeMatchSession(options);
        },
        requestDeltaReset(reason) {
            const gameLoop = getRuntimeHandle(game, 'gameLoop') || getRuntimeComponent(game, 'gameLoop') || null;
            gameLoop?.requestDeltaReset?.(reason);
        },
    };
}

export function createRenderPort(game) {
    return {
        setViewportLayout(layout) {
            getRuntimeComponents(game)?.renderer?.setViewportLayout?.(layout);
        },
        setSplitScreen(isEnabled) {
            getRuntimeComponents(game)?.renderer?.setSplitScreen?.(!!isEnabled);
        },
        setShadowQuality(level) {
            getRuntimeComponents(game)?.renderer?.setShadowQuality?.(level);
        },
        setBloomQuality(level) {
            getRuntimeComponents(game)?.renderer?.setBloomQuality?.(level);
        },
        syncPortalBeams(isEnabled) {
            const arena = getRuntimeState(game)?.arena || null;
            arena?.toggleBeams?.(!!isEnabled);
        },
    };
}

export function createInputPort(game) {
    return {
        clearJustPressed() {
            getRuntimeComponent(game, 'input')?.clearJustPressed?.();
        },
        startKeyCapture(playerKey, action) {
            const keybindEditorController = getRuntimeHandle(game, 'keybindEditorController')
                || getRuntimeComponent(game, 'keybindEditorController')
                || null;
            keybindEditorController?.startKeyCapture?.(playerKey, action);
        },
        clearPlayerSources() {
            getRuntimeComponent(game, 'input')?.clearPlayerSources?.();
        },
    };
}

export function createLifecyclePort(game) {
    return {
        initializeSession() {
            return callRuntimeIntent(game, 'initializeSession');
        },
        waitForAllPlayersLoaded() {
            return callRuntimeIntent(game, 'waitForAllPlayersLoaded');
        },
        getNetworkMatchInputContext() {
            return callRuntimeIntent(game, 'getNetworkMatchInputContext');
        },
        teardownRuntimeSession() {
            return callRuntimeIntent(game, 'teardownRuntimeSession');
        },
        startArcadeRunIfEnabled() {
            return callRuntimeIntent(game, 'startArcadeRunIfEnabled');
        },
        restartRound() {
            return callRuntimeIntent(game, 'restartRound');
        },
        returnToMenu(options = undefined) {
            return callRuntimeIntent(game, 'returnToMenu', options);
        },
    };
}

export function createRuntimeIntentPort(game) {
    return {
        startMatch(options = undefined) {
            return callRuntimeIntent(game, 'startMatch', options);
        },
        pauseMatch(options = undefined) {
            return callRuntimeIntent(game, 'pauseMatch', options);
        },
        resumeMatch(options = undefined) {
            return callRuntimeIntent(game, 'resumeMatch', options);
        },
        returnToMenu(options = undefined) {
            return callRuntimeIntent(game, 'returnToMenu', options);
        },
        finalizeMatch(options = undefined) {
            return callRuntimeIntent(game, 'finalizeMatch', options);
        },
        hostLobby(options = undefined) {
            return callRuntimeIntent(game, 'hostLobby', options);
        },
        joinLobby(options = undefined) {
            return callRuntimeIntent(game, 'joinLobby', options);
        },
        handleMenuPanelChanged(previousPanelId, nextPanelId, transitionMetadata = undefined) {
            const { adapter } = resolveRuntimeIntentAdapter(game, 'handleMenuPanelChanged');
            return adapter?.handleMenuPanelChanged?.(previousPanelId, nextPanelId, transitionMetadata);
        },
    };
}

export function createRuntimeProjectionPort(game) {
    return {
        getSessionRuntimeSnapshot() {
            return buildSessionRuntimeProjection(game);
        },
        getMatchFlowSnapshot() {
            return buildMatchFlowProjection(game);
        },
        getMatchRuntimeProjection() {
            const facade = getRuntimeFacade(game);
            const projection = buildMatchRuntimeProjectionSnapshot({ game, runtimeState: getRuntimeState(game), facade, sessionRuntime: getSessionRuntime(game) });
            if (projection?.arcade || typeof facade?.getArcadeRunState !== 'function') {
                return projection;
            }
            const arcade = facade.getArcadeRunState() || null;
            if (arcade?.runType !== 'arena_waves') return projection;
            return { ...projection, arcade };
        },
        getMatchRenderProjection(options = undefined) {
            return buildMatchRenderProjectionSnapshot({ game, runtimeState: getRuntimeState(game), facade: getRuntimeFacade(game), sessionRuntime: getSessionRuntime(game), renderAlpha: options?.renderAlpha });
        },
        getRuntimeObservabilitySnapshot() {
            return buildRuntimeObservabilityProjection(game);
        },
    };
}

export function createRuntimePorts(game) {
    const settingsPort = createSettingsPort(game);
    const uiFeedbackPort = createUiFeedbackPort(game);
    const sessionPort = createSessionPort(game);
    const renderPort = createRenderPort(game);
    const inputPort = createInputPort(game);
    const matchStatePort = createMatchStatePort(game);
    const lifecyclePort = createLifecyclePort(game);
    const arcadePort = createArcadePort({
        getRuntimeCoordinator: () => getRuntimeCoordinator(game),
        getRuntimeFacade: () => getRuntimeFacade(game),
    });
    const recordingPort = createRecordingPort({
        getRuntimeCoordinator: () => getRuntimeCoordinator(game),
        getRuntimeFacade: () => getRuntimeFacade(game),
    });
    const runtimeIntentPort = createRuntimeIntentPort(game);
    const runtimeProjectionPort = createRuntimeProjectionPort(game);
    const matchUiPort = createMatchUiPort(game);
    return {
        settingsPort,
        uiFeedbackPort,
        sessionPort,
        renderPort,
        inputPort,
        matchStatePort,
        lifecyclePort,
        arcadePort,
        recordingPort,
        runtimeIntentPort,
        runtimeProjectionPort,
        matchUiPort,
        dispose: noop,
    };
}
