// UIManager.js - schlanke Menu-Shell fuer Controller-Verdrahtung und einfache DOM-Syncs.

import { clampSettingValue } from '../shared/contracts/SettingsRuntimeContract.js';
import { GAME_MODE_TYPES, resolveActiveGameMode } from '../hunt/HuntMode.js';
import { isSettingsChangeKey, normalizeSettingsChangeKeys } from './SettingsChangeKeys.js';
import { resolveSyncMethodNamesForChangeKeys } from './UISettingsSyncMap.js';
import { createMenuSchema } from './menu/MenuSchema.js';
import { MenuPanelRegistry } from './menu/MenuPanelRegistry.js';
import { ensureMenuContractState, MENU_SESSION_TYPES } from './menu/MenuStateContracts.js';
import { resolveMenuUiSyncContext } from './menu/MenuUiSyncContext.js';
import { MenuStateMachine, MENU_STATE_IDS } from './menu/MenuStateMachine.js';
import { listMenuTextCatalogEntries } from './menu/MenuTextCatalog.js';
import { MenuTextRuntime } from './menu/MenuTextRuntime.js';
import { DEFAULT_SHADOW_QUALITY, normalizeShadowQuality, resolveShadowQualityLabel } from '../shared/contracts/ShadowQualityContract.js';
import {
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureSettings,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_HUD_MODE,
} from '../shared/contracts/RecordingCaptureContract.js';
import { syncMenuPresetState } from './menu/MenuPresetStateSync.js';
import { syncMenuDeveloperState } from './menu/MenuDeveloperStateSync.js';
import { syncNormalCameraPerspectiveUi } from './menu/CameraPerspectiveUiSync.js';
import { syncFightMenuTuningUi } from './menu/FightMenuTuningSync.js';
import { syncMenuSurfacePolicyUi } from './menu/MenuSurfacePolicyUiSync.js';
import { resolveSurfaceEntryCopy } from '../shared/contracts/PlatformSurfacePolicyOps.js';
import { resolveRuntimeSessionContract } from '../shared/contracts/RuntimeSessionContract.js';
import {
    createNavigationLifecyclePortFromManager,
    createStartSetupControllerPortFromManager,
} from '../shared/runtime/UiControllerRuntimePorts.js';
import { UIStartSyncController } from './UIStartSyncController.js';
import { UINavigationLifecycleController } from './UINavigationLifecycleController.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { createRuntimeSettingsLimitsForRuntime } from '../shared/contracts/SettingsRuntimeLimitsContract.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';
function applyRangeInputLimits(input, limits) {
    if (!input || !limits || typeof limits !== 'object') return;
    if (Number.isFinite(Number(limits.min))) input.min = String(limits.min);
    if (Number.isFinite(Number(limits.max))) input.max = String(limits.max);
    if (Number.isFinite(Number(limits.step)) && Number(limits.step) > 0) input.step = String(limits.step);
}
function syncRangeInput(input, value, limits, fallback) {
    if (!input) return;
    applyRangeInputLimits(input, limits);
    input.value = String(clampSettingValue(value, limits, fallback));
}

function createIdleMultiplayerSessionState() {
    return {
        joined: false,
        connected: false,
        lobbyCode: '',
        role: 'offline',
        isHost: false,
        localReady: false,
        memberCount: 0,
        readyCount: 0,
        allReady: false,
        canStart: false,
        hostPeerId: '',
        pendingMatchCommandId: '',
        members: [],
        transport: '',
    };
}

function normalizeMultiplayerSessionStateSnapshot(sessionState) {
    const source = sessionState && typeof sessionState === 'object' ? sessionState : null;
    if (!source) return createIdleMultiplayerSessionState();
    return {
        ...createIdleMultiplayerSessionState(),
        ...source,
        members: Array.isArray(source.members) ? source.members : [],
    };
}

export class UIManager {
    constructor(deps = {}) {
        const game = deps.game || null;
        this.ports = deps.ports || null;
        this.ui = game?.ui;
        this.settings = game?.settings;
        this.settingsManager = game?.settingsManager || null;
        this.profileManager = game?.profileManager || null;
        ensureMenuContractState(this.settings);

        this._navButtons = game?._navButtons || [];
        this._menuButtonByPanel = game?._menuButtonByPanel || new Map();
        this._lastMenuTrigger = game?._lastMenuTrigger || null;
        this._submenuPanels = [];
        this._menuUiContext = resolveMenuUiSyncContext(this.settings);
        this._accessContext = this._menuUiContext.accessContext;
        this._runtimeFeatureFlags = this._menuUiContext.runtimeFeatureFlags;
        this.menuSchema = game?.menuSchema && typeof game.menuSchema === 'object'
            ? game.menuSchema
            : createMenuSchema({ featureFlags: this._runtimeFeatureFlags });
        this.menuPanelRegistry = game?.menuPanelRegistry instanceof MenuPanelRegistry
            ? game.menuPanelRegistry
            : new MenuPanelRegistry(this.menuSchema);
        this.menuStateMachine = game?.menuStateMachine instanceof MenuStateMachine
            ? game.menuStateMachine
            : new MenuStateMachine({ initialState: MENU_STATE_IDS.MAIN });
        this.menuNavigationRuntime = null;
        this.menuExpertLoginRuntime = game?.menuExpertLoginRuntime || null;
        this._uiDisposers = [];
        this._developerNavButtons = Array.from(document.querySelectorAll(
            '[data-submenu="submenu-developer"], [data-menu-target="submenu-developer"], [data-menu-step-target="submenu-developer"]'
        ));
        this._debugNavButtons = Array.from(document.querySelectorAll(
            '[data-submenu="submenu-debug"], [data-menu-target="submenu-debug"], [data-menu-step-target="submenu-debug"]'
        ));
        this._developerPanel = document.getElementById('submenu-developer');
        this._debugHintNodes = Array.isArray(this.ui.debugHints) ? this.ui.debugHints : [];
        this._runtimeSettingLimits = createRuntimeSettingsLimitsForRuntime();
        this._getGameplayConfig = () => resolveGameplayConfig(game);
        this._readMenuMultiplayerSessionState = () => normalizeMultiplayerSessionStateSnapshot(
            game?.menuMultiplayerBridge?.getSessionState?.()
        );
        this._activeSyncCycle = null;
        this.menuTextRuntime = game?.menuTextRuntime instanceof MenuTextRuntime
            ? game.menuTextRuntime
            : new MenuTextRuntime({ overridePort: this.settingsManager?.getMenuTextOverridePort?.() });

        const controllerPortDeps = { manager: this, game };
        this._startSync = new UIStartSyncController({ ui: this.ui, manager: this, port: createStartSetupControllerPortFromManager({ ...controllerPortDeps, settingsManager: this.settingsManager, getMapDefinitions: () => this._getGameplayConfig()?.MAPS || {} }) });
        this._navLifecycle = new UINavigationLifecycleController({ ui: this.ui, manager: this, port: createNavigationLifecyclePortFromManager({ ...controllerPortDeps, menuExpertLoginRuntime: this.menuExpertLoginRuntime, profileManager: this.profileManager }) });
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    init() {
        this._startSync.setupVehicleSelects();
        this._startSync.setupMapSelect();
        this._startSync.setupStartSetupControls();
        this._navLifecycle.setupMenuNavigation();
        this._navLifecycle.setupExpertLoginBindings();
        if (this.menuExpertLoginRuntime) {
            this.menuExpertLoginRuntime.onStateChanged = () => this._navLifecycle.handleExpertStateChanged();
            this.menuExpertLoginRuntime.bindUi(this.ui);
        }
        this.syncAll();
        this.updateContext();
    }

    // ------------------------------------------------------------------
    // Disposer-Infrastruktur (wird von Sub-Controllern genutzt)
    // ------------------------------------------------------------------

    _pushDisposer(disposer, list = this._uiDisposers) {
        if (typeof disposer !== 'function') return;
        list.push(disposer);
    }

    _listen(target, type, handler, options = undefined, list = this._uiDisposers) {
        if (!target?.addEventListener || typeof handler !== 'function') return;
        target.addEventListener(type, handler, options);
        this._pushDisposer(() => target.removeEventListener(type, handler, options), list);
    }

    _disposeDisposerList(list) {
        while (Array.isArray(list) && list.length > 0) {
            const dispose = list.pop();
            try { dispose?.(); } catch { /* ignore teardown failures */ }
        }
    }

    _runSyncCycle(settings = this.settings, runSync = () => {}) {
        const cycleSettings = settings || this.settings;
        const menuUiContext = this._resolveMenuUiContext(cycleSettings);
        const previousCycle = this._activeSyncCycle;
        this._activeSyncCycle = {
            settings: cycleSettings,
            menuUiContext,
            startSetupSynced: false,
            startSetupSnapshot: null,
        };
        try {
            return runSync(menuUiContext);
        } finally {
            this._activeSyncCycle = previousCycle;
        }
    }

    _createStartSetupSyncSnapshot(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        return {
            settings,
            menuUiContext,
            surfacePolicy: menuUiContext?.surfacePolicy || null,
            surfaceMenuState: menuUiContext?.surfaceMenuState || null,
            multiplayerSessionState: this._readMenuMultiplayerSessionState(),
        };
    }

    _syncStartSetupSnapshot(
        settings = this.settings,
        { menuUiContext = null, snapshot = null, force = false } = {}
    ) {
        if (!settings) return;
        if (!force) {
            const cycle = this._activeSyncCycle;
            if (cycle && cycle.settings === settings) {
                if (cycle.startSetupSynced) return;
                const cycleSnapshot = snapshot || cycle.startSetupSnapshot || this._createStartSetupSyncSnapshot(
                    settings,
                    menuUiContext || cycle.menuUiContext
                );
                cycle.startSetupSnapshot = cycleSnapshot;
                cycle.startSetupSynced = true;
                this._startSync.syncStartSetupState(settings, cycleSnapshot);
                return;
            }
        }
        const explicitSnapshot = snapshot || this._createStartSetupSyncSnapshot(
            settings,
            menuUiContext || this._resolveMenuUiContext(settings)
        );
        this._startSync.syncStartSetupState(settings, explicitSnapshot);
    }

    // ------------------------------------------------------------------
    // Lazy-Setup-Guards (bleiben hier, da sie nur UIManager-internen Zustand brauchen)
    // ------------------------------------------------------------------

    _ensureLevel4SectionControlsSetup() {
        this._navLifecycle.ensureLevel4SectionControlsSetup();
    }

    _ensureDeveloperTextCatalogSetup() {
        this._navLifecycle.ensureDeveloperTextCatalogSetup();
    }

    _setupDeveloperTextCatalog() {
        const select = this.ui.developerTextIdSelect;
        if (!select) return;
        const entries = listMenuTextCatalogEntries().sort((left, right) => left.id.localeCompare(right.id, 'de'));
        const previousValue = String(select.value || '');
        select.innerHTML = '';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Bitte Text-ID waehlen';
        select.appendChild(placeholderOption);
        entries.forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = `${entry.id} -> ${entry.text}`;
            select.appendChild(option);
        });

        const hasPreviousValue = entries.some((entry) => entry.id === previousValue);
        if (hasPreviousValue) select.value = previousValue;
        this._listen(select, 'change', () => {
            const selectedTextId = String(select.value || '').trim();
            if (!this.ui.developerTextOverrideInput) return;
            const overrideValue = this.settingsManager?.getMenuTextOverridePort?.()?.getOverride?.(selectedTextId) || '';
            this.ui.developerTextOverrideInput.value = overrideValue;
        });
    }
    _resolveMenuUiContext(settings = this.settings) {
        const context = resolveMenuUiSyncContext(settings);
        this._menuUiContext = context;
        this._accessContext = context.accessContext;
        this._runtimeFeatureFlags = context.runtimeFeatureFlags;
        return context;
    }
    getMenuUiContext(settings = this.settings) { return this._resolveMenuUiContext(settings); }
    resolveSurfacePolicy(settings = this.settings) { return this.getMenuUiContext(settings).surfacePolicy || null; }
    // ------------------------------------------------------------------
    // Delegations zu Sub-Controllern (public API bleibt erhalten)
    // ------------------------------------------------------------------

    // Navigation & Level4
    showMainNav()                          { return this._navLifecycle.showMainNav(); }
    setLevel4Open(isOpen)                  { return this._navLifecycle.setLevel4Open(isOpen); }
    setLevel4Section(sectionId, options)   { return this._navLifecycle.setLevel4Section(sectionId, options); }
    showToast(message, durationOrTone, tone) { return this._navLifecycle.showToast(message, durationOrTone, tone); }
    updateContext(settings = this.settings) { return this._navLifecycle.updateContext(this._resolveMenuUiContext(settings)); }

    // Interne Methoden die von StartSyncController zurück gerufen werden
    _setStartSectionOpen(sectionId, open)  { return this._navLifecycle._setStartSectionOpen(sectionId, open); }

    // Start / Validierung
    showStartValidationError(issue, opts)  { return this._startSync.showStartValidationError(issue, opts); }
    clearStartValidationError()            { return this._startSync.clearStartValidationError(); }

    // ------------------------------------------------------------------
    // syncAll / syncByChangeKeys
    // ------------------------------------------------------------------

    syncAll() {
        const settings = this.settings;
        this._runSyncCycle(settings, (menuUiContext) => {
            this.syncSessionState(settings, menuUiContext);
            this.syncModes(settings, menuUiContext);
            this.syncMap(settings);
            this.syncBots(settings);
            this.syncRules(settings);
            this.syncGameplay(settings);
            this.syncVehicles(settings);
            this.syncPresetState(settings, menuUiContext);
            this.syncMultiplayerState(settings, menuUiContext);
            this.syncDeveloperState(settings, menuUiContext);
        });
    }

    syncByChangeKeys(changedKeys) {
        if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
            this.syncAll();
            return;
        }
        for (const rawKey of changedKeys) {
            const key = typeof rawKey === 'string' ? rawKey.trim() : '';
            if (!key || !isSettingsChangeKey(key)) {
                this.syncAll();
                return;
            }
        }
        const normalizedKeys = normalizeSettingsChangeKeys(changedKeys);
        if (normalizedKeys.length === 0) { this.syncAll(); return; }

        const syncMethodNames = resolveSyncMethodNamesForChangeKeys(normalizedKeys);
        if (syncMethodNames.length === 0) { this.syncAll(); return; }

        this._runSyncCycle(this.settings, () => {
            for (const methodName of syncMethodNames) {
                const syncMethod = this[methodName];
                if (typeof syncMethod !== 'function') { this.syncAll(); return; }
                syncMethod.call(this);
            }
        });
    }

    // ------------------------------------------------------------------
    // Sync-Methoden (verbleiben im UIManager – einfache DOM-Syncs)
    // ------------------------------------------------------------------

    syncSessionState(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        const ui = this.ui;
        const huntFeatureEnabled = this._getGameplayConfig()?.HUNT?.ENABLED !== false;
        const sessionType = menuUiContext.surfaceMenuState.sessionType;
        syncMenuSurfacePolicyUi({
            ui,
            settings,
            sessionType,
            surfacePolicy: menuUiContext.surfacePolicy,
            huntFeatureEnabled,
        });
        const themeMode = String(settings?.localSettings?.themeMode || 'dunkel').toLowerCase() === 'hell'
            ? 'hell'
            : 'dunkel';
        if (this.ui.mainMenu) {
            this.ui.mainMenu.setAttribute('data-menu-local-theme', themeMode);
        }
        this._syncStartSetupSnapshot(settings, { menuUiContext });
    }

    syncModes(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        const ui = this.ui;
        const sessionType = menuUiContext.surfaceMenuState.sessionType;
        const effectiveMode = sessionType === MENU_SESSION_TYPES.SPLITSCREEN ? '2p' : '1p';

        if (Array.isArray(ui.modeButtons)) {
            ui.modeButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.mode === effectiveMode);
            });
        }
        if (ui.vehicleP2Container) {
            ui.vehicleP2Container.classList.toggle('hidden', effectiveMode !== '2p');
        }

        const huntFeatureEnabled = this._getGameplayConfig()?.HUNT?.ENABLED !== false;
        const resolvedGameMode = resolveActiveGameMode(settings.gameMode, huntFeatureEnabled);
        const huntRespawnEnabled = resolvedGameMode === GAME_MODE_TYPES.HUNT
            ? !!settings?.hunt?.respawnEnabled
            : false;

        if (Array.isArray(ui.gameModeButtons)) {
            ui.gameModeButtons.forEach((btn) => {
                const buttonMode = resolveActiveGameMode(btn.dataset.gameMode, huntFeatureEnabled);
                const isHuntButton = buttonMode === GAME_MODE_TYPES.HUNT;
                btn.classList.toggle('active', buttonMode === resolvedGameMode);
                btn.disabled = isHuntButton && !huntFeatureEnabled;
                btn.title = btn.disabled ? 'Hunt-Modus ist per Feature-Flag deaktiviert' : '';
            });
        }
        if (ui.huntRespawnRow) {
            ui.huntRespawnRow.classList.toggle('hidden', resolvedGameMode !== GAME_MODE_TYPES.HUNT);
        }
        if (ui.huntRespawnToggle) {
            ui.huntRespawnToggle.checked = huntRespawnEnabled;
            ui.huntRespawnToggle.disabled = resolvedGameMode !== GAME_MODE_TYPES.HUNT;
        }
    }

    syncMap(settings = this.settings) {
        if (this.ui.mapSelect) {
            this.ui.mapSelect.value = settings.mapKey;
        }
        this._syncStartSetupSnapshot(settings);
    }

    syncBots(settings = this.settings) {
        const ui = this.ui;
        syncRangeInput(ui.botSlider, settings.numBots, this._runtimeSettingLimits.session.numBots, settings.numBots);
        ui.botLabel.textContent = settings.numBots;
        if (ui.botDifficultySelect) ui.botDifficultySelect.value = settings.botDifficulty;
        if (ui.botPolicyStrategySelect) ui.botPolicyStrategySelect.value = settings.botPolicyStrategy || 'auto';
    }

    syncRules(settings = this.settings) {
        const ui = this.ui;
        syncRangeInput(ui.winSlider, settings.winsNeeded, this._runtimeSettingLimits.session.winsNeeded, settings.winsNeeded);
        ui.winLabel.textContent = settings.winsNeeded;
        ui.autoRollToggle.checked = !!settings.autoRoll;
        ui.invertP1.checked = !!settings.invertPitch.PLAYER_1;
        ui.invertP2.checked = !!settings.invertPitch.PLAYER_2;
        ui.cockpitCamP1.checked = true;
        ui.cockpitCamP1.disabled = true;
        ui.cockpitCamP2.checked = true;
        ui.cockpitCamP2.disabled = true;
        ui.portalsToggle.checked = !!settings.portalsEnabled;
    }

    syncGameplay(settings = this.settings) {
        const ui = this.ui;
        const gp = settings.gameplay;
        const runtimeConfig = this._getGameplayConfig();
        const runtimeLimits = this._runtimeSettingLimits;
        const mobileControls = normalizeMobileClassicControlSettings(settings?.localSettings?.mobileControls);
        if (ui.mobileTiltSensitivitySlider) {
            ui.mobileTiltSensitivitySlider.value = String(Math.round(mobileControls.tiltSensitivity * 100));
        }
        if (ui.mobileTiltSensitivityLabel) {
            ui.mobileTiltSensitivityLabel.textContent = `${Math.round(mobileControls.tiltSensitivity * 100)}%`;
        }
        if (ui.mobileTiltAssistSelect) ui.mobileTiltAssistSelect.value = mobileControls.tiltAssistMode;
        if (ui.mobileTiltPitchModeSelect) ui.mobileTiltPitchModeSelect.value = mobileControls.tiltPitchMode;
        if (ui.mobileTiltDebugToggle) ui.mobileTiltDebugToggle.checked = !!mobileControls.tiltDebugVisible;
        if (ui.mobileTiltSensorHzToggle) ui.mobileTiltSensorHzToggle.checked = !!mobileControls.tiltSensorHzVisible;
        syncRangeInput(ui.speedSlider, gp.speed, runtimeLimits.gameplay.speed, gp.speed);
        ui.speedLabel.textContent = `${gp.speed} m/s`;
        syncRangeInput(ui.turnSlider, gp.turnSensitivity, runtimeLimits.gameplay.turnSensitivity, gp.turnSensitivity);
        ui.turnLabel.textContent = gp.turnSensitivity.toFixed(1);
        syncRangeInput(ui.planeSizeSlider, gp.planeScale, runtimeLimits.gameplay.planeScale, gp.planeScale);
        ui.planeSizeLabel.textContent = gp.planeScale.toFixed(1);
        syncRangeInput(ui.trailWidthSlider, gp.trailWidth, runtimeLimits.gameplay.trailWidth, gp.trailWidth);
        ui.trailWidthLabel.textContent = gp.trailWidth.toFixed(1);
        syncRangeInput(ui.gapSizeSlider, gp.gapSize, runtimeLimits.gameplay.gapSize, gp.gapSize);
        ui.gapSizeLabel.textContent = gp.gapSize.toFixed(2);
        syncRangeInput(ui.gapFrequencySlider, gp.gapFrequency, runtimeLimits.gameplay.gapFrequency, gp.gapFrequency);
        ui.gapFrequencyLabel.textContent = (gp.gapFrequency * 100).toFixed(0) + '%';
        syncRangeInput(ui.itemAmountSlider, gp.itemAmount, runtimeLimits.gameplay.itemAmount, gp.itemAmount);
        ui.itemAmountLabel.textContent = gp.itemAmount;
        syncRangeInput(ui.fireRateSlider, gp.fireRate, runtimeLimits.gameplay.fireRate, gp.fireRate);
        ui.fireRateLabel.textContent = gp.fireRate.toFixed(2) + 's';
        syncRangeInput(ui.lockOnSlider, gp.lockOnAngle, runtimeLimits.gameplay.lockOnAngle, gp.lockOnAngle);
        const nextCheckpointGlowIntensity = Number.isFinite(Number(gp.nextCheckpointGlowIntensity))
            ? Number(gp.nextCheckpointGlowIntensity)
            : 1.35;
        syncRangeInput(
            ui.nextCheckpointGlowSlider,
            nextCheckpointGlowIntensity,
            runtimeLimits.gameplay.nextCheckpointGlowIntensity,
            nextCheckpointGlowIntensity
        );
        if (ui.nextCheckpointGlowLabel) ui.nextCheckpointGlowLabel.textContent = nextCheckpointGlowIntensity.toFixed(2);
        const mgTrailAimRadius = Number.isFinite(Number(gp.mgTrailAimRadius))
            ? Number(gp.mgTrailAimRadius)
            : Math.max(runtimeLimits.gameplay.mgTrailAimRadius.min, Number(runtimeConfig?.HUNT?.MG?.TRAIL_HIT_RADIUS) || 0.78);
        syncRangeInput(ui.mgTrailAimSlider, mgTrailAimRadius, runtimeLimits.gameplay.mgTrailAimRadius, mgTrailAimRadius);
        if (ui.mgTrailAimLabel) ui.mgTrailAimLabel.textContent = mgTrailAimRadius.toFixed(2);
        syncRangeInput(ui.portalCountSlider, gp.portalCount, runtimeLimits.gameplay.portalCount, gp.portalCount);
        if (ui.portalCountLabel) ui.portalCountLabel.textContent = String(gp.portalCount);
        syncRangeInput(ui.planarLevelCountSlider, gp.planarLevelCount, runtimeLimits.gameplay.planarLevelCount, gp.planarLevelCount);
        if (ui.planarLevelCountLabel) ui.planarLevelCountLabel.textContent = String(gp.planarLevelCount);
        applyRangeInputLimits(ui.fightPlayerHpSlider, runtimeLimits.gameplay.fightPlayerHp);
        applyRangeInputLimits(ui.fightMgDamageSlider, runtimeLimits.gameplay.fightMgDamage);
        syncFightMenuTuningUi({ ui, settings, gameplay: gp, config: runtimeConfig });
        const shadowQuality = normalizeShadowQuality(settings?.localSettings?.shadowQuality, DEFAULT_SHADOW_QUALITY);
        if (ui.shadowQualitySlider) ui.shadowQualitySlider.value = String(shadowQuality);
        if (ui.shadowQualityLabel) ui.shadowQualityLabel.textContent = resolveShadowQualityLabel(shadowQuality);
        ui.lockOnLabel.textContent = gp.lockOnAngle + '\u00B0';
        const recordingSettings = normalizeRecordingCaptureSettings(
            settings?.recording,
            createDefaultRecordingCaptureSettings()
        );
        if (ui.recordingProfileSelect) {
            ui.recordingProfileSelect.value = recordingSettings.profile;
        }
        if (ui.recordingHudModeSelect) {
            ui.recordingHudModeSelect.value = recordingSettings.hudMode;
        }
        if (ui.recordingProfileHint) {
            const profileLabel = recordingSettings.profile === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT ? 'YouTube Shorts' : 'Standard';
            const hudLabel = recordingSettings.hudMode === RECORDING_HUD_MODE.WITH_HUD ? 'mit HUD' : 'clean';
            ui.recordingProfileHint.textContent = `Aufnahmeprofil: ${profileLabel} - HUD: ${hudLabel}`;
        }
        syncNormalCameraPerspectiveUi(ui, settings?.cameraPerspective);

        if (ui.planarModeToggle) ui.planarModeToggle.checked = !!gp.planarMode;
        if (Array.isArray(ui.dimensionModeButtons)) {
            ui.dimensionModeButtons.forEach((button) => {
                const planarRaw = String(button?.dataset?.planarMode || '').trim().toLowerCase();
                const buttonPlanarMode = planarRaw === 'true' || planarRaw === '1' || planarRaw === 'yes';
                const isActive = buttonPlanarMode === !!gp.planarMode;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-pressed', String(isActive));
            });
        }
    }

    syncVehicles(settings = this.settings) {
        const ui = this.ui;
        if (ui.vehicleSelectP1) ui.vehicleSelectP1.value = settings.vehicles.PLAYER_1;
        if (ui.vehicleSelectP2) ui.vehicleSelectP2.value = settings.vehicles.PLAYER_2;
        this._syncStartSetupSnapshot(settings);
    }

    // Delegiert an UIStartSyncController
    syncStartSetupState(settings = this.settings, snapshot = null) {
        return this._syncStartSetupSnapshot(settings, { snapshot, force: true });
    }

    syncPresetState(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        syncMenuPresetState({
            ui: this.ui,
            settings,
            settingsManager: this.settingsManager,
            surfacePolicy: menuUiContext.surfacePolicy,
        });
    }

    syncMultiplayerState(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        if (!this.ui.multiplayerStatus) return;
        const sessionType = menuUiContext.surfaceMenuState.sessionType;
        const surfaceEntryCopy = resolveSurfaceEntryCopy({
            productSurfaceId: menuUiContext.surfacePolicy?.productSurfaceId,
            sessionType,
        });
        const sessionState = this._readMenuMultiplayerSessionState();
        const activePresetId = String(settings?.matchSettings?.activePresetId || '');
        const presetText = activePresetId ? ` | Preset: ${activePresetId}` : '';
        if (sessionType !== MENU_SESSION_TYPES.MULTIPLAYER) {
            this.ui.multiplayerStatus.textContent = `${surfaceEntryCopy.multiplayerInactiveStatus}${presetText}`;
            if (this.ui.startButton) {
                this.ui.startButton.disabled = false;
                this.ui.startButton.title = surfaceEntryCopy.startButtonTitle || '';
            }
            return;
        }
        if (!sessionState?.joined) {
            const sessionContract = resolveRuntimeSessionContract({
                sessionType,
                multiplayerTransport: settings?.localSettings?.multiplayerTransport,
            });
            this.ui.multiplayerStatus.textContent = `${surfaceEntryCopy.multiplayerDisconnectedStatus} | Transport: ${sessionContract.transportAudienceLabel}${presetText}`;
            if (this.ui.startButton) {
                this.ui.startButton.disabled = false;
                this.ui.startButton.title = surfaceEntryCopy.multiplayerJoinWaitTitle;
            }
            return;
        }
        const role = sessionState.isHost ? 'Host' : surfaceEntryCopy.multiplayerClientRoleLabel;
        const connectionStatus = sessionState.pendingMatchCommandId ? 'Startsignal gesendet' : (sessionState.connected ? 'verbunden' : (sessionState.isHost ? 'Host aktiv' : 'Warte auf Host'));
        const startStatus = sessionState.pendingMatchCommandId ? 'Matchstart laeuft' : (sessionState.canStart ? 'Start bereit' : (sessionState.isHost ? 'Warte auf Ready' : 'Warte auf Host'));
        this.ui.multiplayerStatus.textContent = `Lobby live | Rolle: ${role} | Status: ${connectionStatus} | ${sessionState.readyCount}/${sessionState.memberCount} ready | ${startStatus}${presetText}`;
        if (this.ui.startButton) {
            this.ui.startButton.disabled = false;
            this.ui.startButton.title = sessionState.pendingMatchCommandId
                ? 'Matchstart wurde bereits an die aktive Lobby gesendet.'
                : (sessionState.canStart
                    ? ''
                : (sessionState.isHost
                    ? 'Alle Teilnehmer muessen Ready sein und mindestens 2 Spieler verbunden sein.'
                    : surfaceEntryCopy.multiplayerClientStartTitle));
        }
    }

    syncDeveloperState(settings = this.settings, menuUiContext = this._resolveMenuUiContext(settings)) {
        const releaseState = menuUiContext.releaseState;
        this._navLifecycle.syncDeveloperReleaseCutVisibility(menuUiContext);
        syncMenuDeveloperState({
            ui: this.ui,
            settings,
            settingsManager: this.settingsManager,
            accessContext: menuUiContext.accessContext,
            menuTextRuntime: this.menuTextRuntime,
            releaseState,
        });
    }

    // ------------------------------------------------------------------
    // Dispose
    // ------------------------------------------------------------------

    dispose() {
        if (this.menuExpertLoginRuntime) {
            this.menuExpertLoginRuntime.onStateChanged = null;
        }
        this._startSync.dispose();
        this._navLifecycle.dispose();
        this._disposeDisposerList(this._uiDisposers);
        this.menuNavigationRuntime?.dispose?.();
        this.menuNavigationRuntime = null;
    }
}
