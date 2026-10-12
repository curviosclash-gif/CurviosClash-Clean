import { Renderer } from '../../src/core/Renderer.js';
import { Arena } from '../../src/entities/Arena.js';
import { CONFIG_BASE } from '../../src/core/Config.js';
import { createRuntimeConfigSnapshot } from '../../src/core/RuntimeConfig.js';
import { SettingsManager } from '../../src/core/SettingsManager.js';
import { InputManager } from '../../src/core/InputManager.js';
import { RuntimeDiagnosticsSystem } from '../../src/core/RuntimeDiagnosticsSystem.js';
import { GAME_STATE_IDS } from '../../src/shared/contracts/GameStateIds.js';
import { WaterZoneSystem } from '../../src/entities/systems/WaterZoneSystem.js';
import { PowerupManager } from '../../src/entities/Powerup.js';
import { MapUnitSystem } from '../../src/entities/systems/MapUnitSystem.js';
import { StaticTurretSystem } from '../../src/entities/systems/StaticTurretSystem.js';
import { createGameModeStrategy } from '../../src/modes/GameModeRegistry.js';
import { createEntityRuntimeConfig } from '../../src/shared/contracts/EntityRuntimeConfig.js';
import { createMatchSession, wireInitializedMatchRuntime, disposeMatchSessionSystems } from '../../src/state/MatchSessionFactory.js';
import { createMatchSessionPort } from '../../src/state/MatchLifecycleSessionPort.js';
import { createEditorBuildPresentationScope } from './EditorBuildPresentationScope.js';

/** The editor supplies an in-memory map port; game modules never import editor UI. */
export class EditorBuildRuntime {
    constructor(canvas, container) {
        this.container = container;
        this.presentationScope = createEditorBuildPresentationScope(new URL('../', document.baseURI).href);
        try {
            this.renderer = new Renderer(canvas);
            const settingsManager = new SettingsManager();
            this.settings = settingsManager.loadSettings();
            this.settings = { ...this.settings, mode: '1p', numBots: 0,
                arcade: { ...this.settings.arcade, enabled: false },
                localSettings: { ...this.settings.localSettings, sessionType: 'single', modePath: 'normal' } };
            this.config = createRuntimeConfigSnapshot(this.settings);
            const graphics = this.settings.localSettings || {};
            this.renderer.setGraphicsStyle(graphics.graphicsStyle);
            this.renderer.setMapBrightness(graphics.mapBrightness);
            this.renderer.setViewDistance(graphics.viewDistance);
            this.renderer.setShadowQuality(graphics.shadowQuality);
            this.renderer.setBloomQuality(graphics.bloomQuality);
            this.renderer.cameraRigSystem.setCameraPerspectiveSettings(this.settings.cameraPerspective);
            this.arena = null;
            this.session = null;
            this.kernel = null;
            this.input = null;
            this.accumulator = 0;
            this.frameId = 0;
            this.worldTime = 0;
            const readOnlyRecords = { loadJsonRecord: (...args) => settingsManager.settingsRecordStorePort.loadJsonRecord(...args) };
            this.diagnostics = new RuntimeDiagnosticsSystem({
                getRenderer: () => this.renderer, getGraphicsQualitySetting: () => graphics.graphicsQuality,
                getBloomQualityUserSet: () => graphics.bloomQualityUserSet,
                getState: () => GAME_STATE_IDS.PLAYING, getKeyCaptureActive: () => true,
                getSettingsRecordStore: () => readOnlyRecords,
            });
            this.water = null;
            this.mapUnits = null; this.staticTurrets = null; this.powerups = null;
            this.matchPort = createMatchSessionPort({ renderer: this.renderer, matchSessionRuntimeBridge: {
                getCurrentMatchSessionRefs: () => this.session, getCurrentMatchKernel: () => this.kernel,
            } });
        } catch (error) {
            try { this.renderer?.dispose(); } finally { this.presentationScope.dispose(); }
            throw error;
        }
    }

    clearWorld() {
        this.mapUnits?.dispose(); this.mapUnits = null;
        this.staticTurrets?.dispose(); this.staticTurrets = null;
        this.powerups?.dispose(); this.powerups = null;
        this.water?.dispose(); this.water = null;
        this.kernel?.dispose(); this.kernel = null;
        this.input?.dispose(); this.input = null;
        if (this.session) disposeMatchSessionSystems(this.renderer, this.session, { clearScene: false });
        else this.arena?.dispose();
        this.session = null; this.arena = null;
        this.renderer.clearMatchScene();
        this.accumulator = 0;
    }

    async load(snapshot, test = false) {
        this.clearWorld();
        const mapResolution = snapshot.mapResolution;
        if (test) {
            this.session = await createMatchSession({ renderer: this.renderer, audio: null, recorder: null,
                settings: this.settings, runtimeConfig: this.config, baseConfig: CONFIG_BASE,
                requestedMapKey: mapResolution.effectiveMapKey, mapResolution, isDesktopRuntime: true });
            const wired = wireInitializedMatchRuntime({ renderer: this.renderer,
                initializedMatch: { session: this.session }, resetScores: false });
            this.kernel = wired.kernel;
            this.arena = this.session.arena;
            this.matchPort.resetRoundRuntime();
            this.input = new InputManager();
            this.input.setBindings(this.settings.controls);
        } else {
            this.arena = new Arena(this.renderer);
            this.arena.runtimeConfig = this.config;
            this.arena.entityRuntimeConfig = createEntityRuntimeConfig(this.config, CONFIG_BASE);
            this.arena.runtimeMapKey = mapResolution.effectiveMapKey;
            this.arena.runtimeMapDefinition = mapResolution.mapDefinition;
            await this.arena.build(mapResolution.effectiveMapKey);
            this.arena.setGlbAnimationElapsedSeconds(this.worldTime);
            const strategy = createGameModeStrategy(this.config.session.activeGameMode, { runtimeConfig: this.config });
            this.powerups = new PowerupManager(this.renderer, this.arena, this.arena.entityRuntimeConfig);
            this.powerups.getStrategy = () => strategy;
            // Visual systems use the usual authored content, with no participants or combat authority.
            const worldPort = { arena: this.arena, renderer: this.renderer, players: [], bots: [],
                runtimeConfig: this.config, entityRuntimeConfig: this.arena.entityRuntimeConfig,
                gameModeStrategy: strategy, powerupManager: this.powerups, isFightOutcomeAuthority: false };
            this.water = new WaterZoneSystem(worldPort);
            this.water.startRound();
            this.water.update(this.worldTime);
            this.mapUnits = new MapUnitSystem(worldPort); this.mapUnits.startRound();
            this.staticTurrets = new StaticTurretSystem(worldPort); this.staticTurrets.startRound();
            this.renderer.createCamera(0);
        }
        const assets = this.arena.getMapAssetLoadState();
        if (assets.error || assets.warnings.length) {
            throw new Error(`Unvollständige Spielansicht: ${assets.error || assets.warnings.join('; ')}`);
        }
        this.resize();
    }

    resize() {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        const view = this.renderer.viewportSystem;
        if (view.width === width && view.height === height) return;
        view.width = width; view.height = height;
        this.renderer.renderer.setSize(width, height);
        this.renderer.postProcessingPipeline.setSize(width, height);
        view.updateCameraAspects(this.renderer.cameras);
    }

    tick(dt, paused) {
        this.resize();
        this.frameId += 1;
        this.diagnostics.update(dt);
        this.renderer.cameraRigSystem.setFrameTiming({ frameId: this.frameId, dt, rawDt: dt });
        if (this.kernel) {
            this.accumulator = Math.min(this.accumulator + dt, 5 / 60);
            while (this.accumulator >= 1 / 60) {
                this.kernel.tick({ fixedStepSeconds: 1 / 60, frameId: this.frameId }, this.input, false);
                this.input.clearJustPressed();
                this.accumulator -= 1 / 60;
            }
            this.session.entityManager.renderInterpolatedTransforms(this.accumulator * 60, dt);
            this.session.entityManager.updateCameras(dt, this.accumulator * 60, true);
        } else if (!paused) {
            this.arena.update(dt);
            this.water?.update(dt);
            this.mapUnits?.update(dt);
            this.powerups?.update(dt);
            this.worldTime = this.arena.glbAnimationElapsedSeconds;
        }
        this.renderer.updateMapFogLayer(this.arena.glbAnimationElapsedSeconds);
    }

    dispose() {
        try { this.clearWorld(); this.diagnostics.dispose(); this.renderer.dispose(); }
        finally { this.presentationScope.dispose(); }
    }
}
