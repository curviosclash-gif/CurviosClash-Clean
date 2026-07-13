import { Renderer } from './Renderer.js';
import { GameLoop } from './GameLoop.js';
import { InputManager } from './InputManager.js';
import { ParticleSystem } from '../entities/Particles.js';
import { AudioManager } from './Audio.js';
import { RuntimeDiagnosticsSystem } from './RuntimeDiagnosticsSystem.js';
import { ScreenShake } from '../hunt/ScreenShake.js';
import { PlanarAimAssistSystem } from './PlanarAimAssistSystem.js';
import { MatchSessionRuntimeBridge } from './MatchSessionRuntimeBridge.js';
import { BuildInfoController } from './BuildInfoController.js';
import { MediaRecorderSystem } from './MediaRecorderSystem.js';
import { createRuntimePorts } from '../shared/runtime/GameRuntimePorts.js';
import { GAME_MODE_TYPES } from '../hunt/HuntMode.js';
import { CONFIG } from './Config.js';
import {
    isCinematicCaptureProfile,
    RECORDING_DOWNLOAD_DIRECTORY,
} from '../shared/contracts/RecordingCaptureContract.js';
import {
    createMatchSessionPort,
    MatchLifecycleSessionOrchestrator,
} from '../state/MatchLifecycleSessionOrchestrator.js';
import {
    attachGameRuntimeBundle,
    createGameRuntimeBundle,
    createInitialGameRuntimeState,
    getSessionRuntimeState,
    setSessionRuntimeHandle,
} from './runtime/GameRuntimeBundle.js';
import {
    CrosshairSystem,
    createGameUiDomRefs,
    createHuntHudDomRefs,
    HUD,
    HudRuntimeSystem,
    HuntHUD,
    KeybindEditorController,
    MatchFlowUiController,
    MenuExpertLoginRuntime,
} from '../composition/core-ui/CoreUiBootstrapPorts.js';
import { createCoreRuntimeAccess } from '../composition/core-ui/CoreRuntimeAccessFactory.js';

function readBooleanQueryParam(paramName, fallback = false) {
    try {
        const params = new URLSearchParams(window.location.search);
        if (!params.has(paramName)) return fallback;
        const value = String(params.get(paramName) || '').trim().toLowerCase();
        if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
        if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
    } catch {
        // no-op
    }
    return fallback;
}

function readNumberQueryParam(paramName, fallback, min, max) {
    try {
        const params = new URLSearchParams(window.location.search);
        if (!params.has(paramName)) return fallback;
        const value = Number(params.get(paramName));
        if (!Number.isFinite(value)) return fallback;
        return Math.max(min, Math.min(max, Math.floor(value)));
    } catch {
        // no-op
    }
    return fallback;
}

function resolveRecorderRuntimeConfig() {
    return {
        autoRecordingEnabled: readBooleanQueryParam('autorecord', false),
        captureFps: readNumberQueryParam('recordfps', 30, 10, 60),
    };
}

export function createGameUiRefs() {
    return createGameUiDomRefs(document);
}

export function bootstrapGameRuntime(game, options = {}) {
    const canvas = document.getElementById('game-canvas');
    const renderer = new Renderer(canvas);
    renderer.setShadowQuality(game.settings?.localSettings?.shadowQuality);
    const recorderRuntimeConfig = resolveRecorderRuntimeConfig();
    let mediaRecorderSystem = null;
    mediaRecorderSystem = new MediaRecorderSystem({
        canvas,
        autoRecordingEnabled: recorderRuntimeConfig.autoRecordingEnabled,
        autoDownload: true,
        captureFps: recorderRuntimeConfig.captureFps,
        downloadDirectoryName: RECORDING_DOWNLOAD_DIRECTORY,
        captureSourceResolver: () => renderer.getRecordingCaptureCanvas?.() || canvas,
        recordingCaptureSettings: game.settings?.recording,
        onRecordingStateChange: (isRecording) => {
            renderer.setRecordingActive?.(isRecording);
            const captureProfile = mediaRecorderSystem?.getRecordingCaptureSettings?.()?.profile;
            const cinematicRecordingActive = isRecording === true
                && isCinematicCaptureProfile(captureProfile);
            renderer.setRecordingQualityLock?.(cinematicRecordingActive, 'cinematic-recording');
        },
        runtimePerfProfiler: game.runtimePerfProfiler,
        logger: console,
    });
    renderer.setRecordingCaptureSettings(game.settings?.recording);
    renderer.setCameraPerspectiveSettings(game.settings?.cameraPerspective);

    const initialParticles = new ParticleSystem(renderer, game);
    const ui = createGameUiRefs();
    const runtimeBundle = createGameRuntimeBundle({
        state: createInitialGameRuntimeState({
            config: game.config ?? CONFIG,
            runtimeConfig: game.runtimeConfig ?? null,
            activeGameMode: game.activeGameMode ?? GAME_MODE_TYPES.CLASSIC,
            roundStateController: game.roundStateController ?? null,
            mapKey: game.mapKey ?? null,
            numHumans: game.numHumans ?? 1,
            numBots: game.numBots ?? 0,
            winsNeeded: game.winsNeeded ?? 1,
            arena: game.arena ?? null,
            entityManager: game.entityManager ?? null,
            powerupManager: game.powerupManager ?? null,
            particles: initialParticles,
            menuController: game.menuController ?? null,
            menuMultiplayerBridge: game.menuMultiplayerBridge ?? null,
            _navButtons: Array.isArray(game._navButtons) ? game._navButtons : [],
            _menuButtonByPanel: game._menuButtonByPanel instanceof Map ? game._menuButtonByPanel : new Map(),
            _activeSubmenu: game._activeSubmenu ?? null,
            _lastMenuTrigger: game._lastMenuTrigger ?? null,
            _buildInfoClipboardText: String(game._buildInfoClipboardText || ''),
        }),
        components: {
            renderer,
            mediaRecorderSystem,
            input: new InputManager(),
            audio: new AudioManager(),
            ui,
        },
        lifecycle: {
            gameStateId: game.state,
            disposed: !!game._disposed,
        },
    });
    attachGameRuntimeBundle(game, runtimeBundle);
    const runtimeState = getSessionRuntimeState(runtimeBundle) || runtimeBundle.state;
    const registerRuntimeHandle = (key, value) => setSessionRuntimeHandle(runtimeBundle, key, value);
    const runtimeAccess = createCoreRuntimeAccess(game);

    const runtimePorts = createRuntimePorts(game);
    runtimeBundle.ports = runtimePorts;
    registerRuntimeHandle('hudP1', new HUD('p1-fighter-hud', 0, {
        ports: runtimePorts,
        getCamera: (playerIndex) => renderer?.cameras?.[playerIndex] || null,
    }));
    registerRuntimeHandle('hudP2', new HUD('p2-fighter-hud', 1, {
        ports: runtimePorts,
        getCamera: (playerIndex) => renderer?.cameras?.[playerIndex] || null,
    }));
    const matchSessionOrchestrator = new MatchLifecycleSessionOrchestrator(createMatchSessionPort(game));
    registerRuntimeHandle('matchSessionOrchestrator', matchSessionOrchestrator);
    registerRuntimeHandle('huntHud', new HuntHUD({
        runtime: game,
        ports: runtimePorts,
        refs: createHuntHudDomRefs(document),
        isHuntActive: (runtime) => runtime.activeGameMode === GAME_MODE_TYPES.HUNT && runtime.state !== 'MENU',
        getBoostCapacity: () => Number(game.config?.PLAYER?.BOOST_DURATION) || 1,
    }));
    registerRuntimeHandle('screenShake', new ScreenShake(renderer));
    registerRuntimeHandle('hudRuntimeSystem', new HudRuntimeSystem({ game, ports: runtimePorts }));
    registerRuntimeHandle('crosshairSystem', new CrosshairSystem({ game, ports: runtimePorts }));
    registerRuntimeHandle('matchFlowUiController', new MatchFlowUiController({
        runtime: game,
        ports: runtimePorts,
        sessionOrchestrator: matchSessionOrchestrator,
    }));
    registerRuntimeHandle(
        'runtimeDiagnosticsSystem',
        new RuntimeDiagnosticsSystem(runtimeAccess.runtimeDiagnostics)
    );
    registerRuntimeHandle(
        'keybindEditorController',
        new KeybindEditorController(runtimeAccess.keybindEditor)
    );
    registerRuntimeHandle(
        'planarAimAssistSystem',
        new PlanarAimAssistSystem(runtimeAccess.planarAimAssist)
    );
    registerRuntimeHandle('matchSessionRuntimeBridge', new MatchSessionRuntimeBridge({
        game,
        ports: runtimePorts,
        runtimeBundle,
    }));

    registerRuntimeHandle('gameLoop', new GameLoop(
        (dt) => game.update(dt),
        (renderAlpha, renderDelta) => game.render(renderAlpha, renderDelta),
        {
            runtimePerfProfiler: game.runtimePerfProfiler,
        }
    ));

    runtimePorts.matchUiPort?.setupPauseOverlayListeners?.();
    runtimeState._navButtons = [];
    runtimeState._menuButtonByPanel = new Map();
    runtimeState._activeSubmenu = null;
    runtimeState._lastMenuTrigger = null;
    runtimeState._buildInfoClipboardText = '';

    const showStatusToast = typeof options.showStatusToast === 'function'
        ? options.showStatusToast
        : (message, durationMs, tone) => game?._showStatusToast?.(message, durationMs, tone);

    registerRuntimeHandle('buildInfoController', new BuildInfoController({
        ui,
        showStatusToast,
        appVersion: options.appVersion,
        buildId: options.buildId,
        buildTime: options.buildTime,
    }));
    registerRuntimeHandle('menuExpertLoginRuntime', new MenuExpertLoginRuntime({
        settings: game.settings,
        ui,
        showStatusToast,
    }));

    // F9 cinematic recording is handled exclusively via main.js _toggleRecordingFromGlobalHotkey()
    // to avoid double-trigger with InputManager's justPressed cache.
    return runtimeBundle;
}
