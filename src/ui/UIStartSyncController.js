// ============================================
// UIStartSyncController.js
// Start-Setup, Preview-Cards, Summary-Rendering und Validierungs-Hints
// Extrahiert aus UIManager.js (V38 Phase 38.3.1)
// ============================================

import { VEHICLE_DEFINITIONS } from '../entities/vehicle-registry.js';
import { MENU_SESSION_TYPES } from './menu/MenuStateContracts.js';
import {
    listMapPreviewEntries,
    listVehiclePreviewEntries,
} from './menu/MenuPreviewCatalog.js';
import {
    isMapEligibleForModePath,
    resolveModePathFallbackMapKey,
} from '../shared/contracts/MapModeContract.js';
import {
    resolveSurfaceEntryCopy,
    resolveSurfaceMenuState,
} from '../shared/contracts/PlatformSurfacePolicyOps.js';
import { createSurfacePolicyPort } from '../shared/runtime/SurfacePolicyPort.js';
import {
    ensureStartSetupLocalState,
} from './start-setup/StartSetupUiOps.js';
import { bindStartSetupControls } from './start-setup/StartSetupControlBindings.js';
import { createStartSetupMapPicker3d } from './start-setup/StartSetupMapPicker3d.js';
import { createStartSetupVehiclePicker3d } from './start-setup/StartSetupVehiclePicker3d.js';
import {
    formatStartSetupMapLabel,
    renderStartFieldHints,
} from './start-setup/StartSetupValidationView.js';
import {
    syncStartSetupSelectionState,
} from './start-setup/StartSetupSelectionSync.js';
import {
    renderStartSetupSummaryAndPreview,
    syncStartSetupMultiplayerUi,
} from './start-setup/StartSetupMultiplayerUiSync.js';
import { getRuntimeMapCatalog } from '../shared/contracts/RuntimeMapCatalogContract.js';
import {
    MULTIPLAYER_TRANSPORTS,
    normalizeMultiplayerTransport,
    resolveRuntimeSessionContract,
} from '../shared/contracts/RuntimeSessionContract.js';
import { hasConfiguredOnlineSignalingUrl } from '../shared/contracts/OnlineSignalingConfig.js';
import {
    ARCADE_GHOST_DUEL_MODES,
    isArcadeGhostDuelPlaybackEnabled,
    normalizeArcadeGhostDuelMode,
    normalizeArcadeGhostTrailCollisionEnabled,
} from '../shared/contracts/ArcadeGhostDuelContract.js';

export class UIStartSyncController {
    /**
     * @param {{ ui: object, manager: object, port?: object }} options
     */
    constructor({ ui, manager, port = null }) {
        this.ui = ui;
        this.manager = manager;
        this.port = port;
        this._mapPreviewEntries = listMapPreviewEntries();
        this._vehiclePreviewEntries = listVehiclePreviewEntries();
        this._startSetupDisposers = [];
        this._startValidationIssue = null;
        this._activeSyncSnapshot = null;
        this._mapPicker3d = null;
        this._lobbyMapPicker3d = null;
        this._vehiclePicker3d = null;
    }

    _getSettings() {
        return this.port?.getSettings?.() || this.manager?.settings || null;
    }

    _getSurfacePolicyPort() {
        if (this.port?.surfacePolicyPort) return this.port.surfacePolicyPort;
        return createSurfacePolicyPort({
            getProductSurfaceId: () => this._resolveSurfacePolicy()?.productSurfaceId || '',
            getSettings: () => this._getSettings()
        });
    }

    _getSettingsManager() {
        return this.port?.getSettingsManager?.() || null;
    }

    _getMapDefinitions() {
        return this.port?.getMapDefinitions?.() || {};
    }

    _getRuntimeMaps() {
        return getRuntimeMapCatalog();
    }

    _getMultiplayerSessionState() {
        if (this._activeSyncSnapshot?.multiplayerSessionState) {
            return this._activeSyncSnapshot.multiplayerSessionState;
        }
        return this.port?.getMultiplayerSessionState?.() || null;
    }

    // ------------------------------------------------------------------
    // Setup: Vehicle- und Map-Selects, Start-Setup-Controls
    // ------------------------------------------------------------------

    setupVehicleSelects() {
        const populate = (select) => {
            if (!select) return;
            select.replaceChildren();
            VEHICLE_DEFINITIONS.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.label;
                select.appendChild(opt);
            });
        };
        populate(this.ui.vehicleSelectP1);
        populate(this.ui.vehicleSelectP2);
    }

    setupMapSelect() {
        const select = this.ui.mapSelect;
        const settings = this._getSettings();
        if (!select || !settings) return;
        const maps = this._getMapDefinitions();

        const modePath = this._resolveAllowedModePath(settings?.localSettings?.modePath || 'normal');
        if (settings?.localSettings) {
            settings.localSettings.modePath = modePath;
        }
        const currentValue = String(select.value || settings?.mapKey || 'standard');
        const fallbackMapKey = this._resolveSurfaceFallbackMapKey(maps, modePath, currentValue);
        select.replaceChildren();

        Object.entries(maps).forEach(([key, mapDef]) => {
            if (!isMapEligibleForModePath(mapDef, modePath) || !this._getSurfacePolicyPort().isMapAllowed(key, modePath)) {
                return;
            }
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = this._formatMapLabel({
                name: String(mapDef?.name || key),
                hasGlbModel: (typeof mapDef?.glbModel === 'string' && mapDef.glbModel.trim().length > 0)
                    || (Array.isArray(mapDef?.glbModels) && mapDef.glbModels.length > 0),
            });
            select.appendChild(opt);
        });

        if (this._hasStoredCustomMap()) {
            const opt = document.createElement('option');
            opt.value = 'custom';
            opt.textContent = this._formatMapLabel({
                key: 'custom',
                name: 'Custom (lokal)',
                hasGlbModel: true,
            });
            select.appendChild(opt);
        }

        if (maps?.[currentValue]
            && isMapEligibleForModePath(maps[currentValue], modePath)
            && this._getSurfacePolicyPort().isMapAllowed(currentValue, modePath)) {
            select.value = currentValue;
        } else if (currentValue === 'custom' && this._hasStoredCustomMap()) {
            select.value = 'custom';
        } else if (maps?.[fallbackMapKey]) {
            select.value = fallbackMapKey;
        }
    }

    setupStartSetupControls() {
        const settings = this._getSettings();
        if (!settings) return;
        this._mapPicker3d?.dispose();
        this._lobbyMapPicker3d?.dispose();
        this._mapPicker3d = null;
        this._vehiclePicker3d?.dispose();
        this._vehiclePicker3d = null;
        this.manager._disposeDisposerList(this._startSetupDisposers);
        const getSettings = () => this._getSettings();
        const listen = (target, type, handler, options = undefined) => this.manager._listen(
            target,
            type,
            handler,
            options,
            this._startSetupDisposers
        );

        bindStartSetupControls(this, listen, getSettings);
        this._mapPicker3d = createStartSetupMapPicker3d({ ui: this.ui, listen });
        this._lobbyMapPicker3d = createStartSetupMapPicker3d({
            ui: { mapPreview3dMount: this.ui.lobbyMapPreviewMount }, listen, readOnly: true,
        });
        this._vehiclePicker3d = createStartSetupVehiclePicker3d({ ui: this.ui, listen });
    }

    // ------------------------------------------------------------------
    // Interne Hilfsm­ethoden (Field-Hints und Labels)
    // ------------------------------------------------------------------

    _formatMapLabel(entry = {}) {
        return formatStartSetupMapLabel(entry);
    }

    _hasStoredCustomMap() {
        try {
            return !!globalThis?.localStorage?.getItem?.('custom_map_test');
        } catch {
            return false;
        }
    }

    _renderStartFieldHints(settings = this._getSettings(), options = {}) {
        if (!settings) return;
        renderStartFieldHints({
            ui: this.ui,
            settings,
            settingsManager: this._getSettingsManager(),
            startValidationIssue: this._startValidationIssue,
            focusField: options.focusField === true,
            onOpenSection: (sectionId) => this.manager?._setStartSectionOpen?.(sectionId, true),
        });
    }

    _resolveSurfacePolicy(settings = this._getSettings()) {
        if (this._activeSyncSnapshot?.surfacePolicy) {
            return this._activeSyncSnapshot.surfacePolicy;
        }
        return this.port?.resolveSurfacePolicy?.(settings)
            || this.manager?.resolveSurfacePolicy?.(settings)
            || null;
    }

    _resolveAllowedModePath(requestedModePath) {
        const normalizedModePath = String(requestedModePath || 'normal').trim().toLowerCase() || 'normal';
        return this._getSurfacePolicyPort().isModePathAllowed(normalizedModePath)
            ? normalizedModePath
            : this._getSurfacePolicyPort().resolveFallbackModePath();
    }

    _resolveSurfaceFallbackMapKey(maps, modePath, currentMapKey = '') {
        const surfacePolicy = this._resolveSurfacePolicy();
        const normalizedModePath = this._resolveAllowedModePath(modePath);
        if (surfacePolicy?.requiresCuratedMaps === true) {
            const curatedMapKeys = this._getSurfacePolicyPort().listAllowedMapKeysForModePath(normalizedModePath)
                .filter((mapKey) => maps?.[mapKey] && isMapEligibleForModePath(maps[mapKey], normalizedModePath));
            if (curatedMapKeys.includes(String(currentMapKey || '').trim())) {
                return String(currentMapKey || '').trim();
            }
            if (curatedMapKeys.length > 0) {
                return curatedMapKeys[0];
            }
        }
        return resolveModePathFallbackMapKey(maps, normalizedModePath, currentMapKey);
    }

    _resolveHangarSelectionModePath(settings = this._getSettings()) {
        return this._resolveAllowedModePath(settings?.localSettings?.modePath || 'normal');
    }

    // 64.3.1 macht die LAN-/Online-Wahl im Menu explizit. Online wird nur dann
    // als produktiver Pfad behandelt, wenn ein Signaling-Endpoint konfiguriert ist.
    _resolveMultiplayerTransportUiState(settings = this._getSettings()) {
        const surfacePolicy = this._resolveSurfacePolicy(settings);
        const allowedTransports = Array.isArray(surfacePolicy?.allowedMultiplayerTransports)
            ? surfacePolicy.allowedMultiplayerTransports.filter((transport) => transport !== MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE)
            : [MULTIPLAYER_TRANSPORTS.LAN];
        const onlineConfigured = hasConfiguredOnlineSignalingUrl({
            runtimeGlobal: typeof globalThis !== 'undefined' ? globalThis : null,
        });
        const selectedTransport = allowedTransports.includes(
            normalizeMultiplayerTransport(settings?.localSettings?.multiplayerTransport, '')
        )
            ? normalizeMultiplayerTransport(settings?.localSettings?.multiplayerTransport, '')
            : (allowedTransports[0] || MULTIPLAYER_TRANSPORTS.LAN);
        const isOnlineUnconfigured = selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE && !onlineConfigured;
        return {
            allowedTransports,
            selectedTransport,
            selectedTransportLabel: selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE ? 'Online' : 'LAN',
            onlineConfigured,
            isOnlineUnconfigured,
        };
    }

    // ------------------------------------------------------------------
    // Öffentliche Validierungsmethoden
    // ------------------------------------------------------------------

    showStartValidationError(issue, options = {}) {
        const normalizedIssue = issue && typeof issue === 'object' ? issue : {};
        this._startValidationIssue = {
            message: String(normalizedIssue.message || 'Start nicht moeglich.').trim(),
            fieldKey: String(normalizedIssue.fieldKey || '').trim(),
            fieldMessage: String(normalizedIssue.fieldMessage || '').trim(),
        };
        this._renderStartFieldHints(this._getSettings(), { focusField: options.focusField !== false });
    }

    clearStartValidationError() {
        if (!this._startValidationIssue) return;
        this._startValidationIssue = null;
        this._renderStartFieldHints(this._getSettings());
    }

    // ------------------------------------------------------------------
    // Sync-Methoden
    // ------------------------------------------------------------------

    syncStartSetupState(settings = this._getSettings(), syncSnapshot = null) {
        if (!settings) return;
        const normalizedSnapshot = syncSnapshot && typeof syncSnapshot === 'object'
            ? syncSnapshot
            : null;
        const previousSyncSnapshot = this._activeSyncSnapshot;
        const runtimeMaps = this._getRuntimeMaps();
        const surfacePolicy = normalizedSnapshot?.surfacePolicy
            || normalizedSnapshot?.menuUiContext?.surfacePolicy
            || this._resolveSurfacePolicy(settings);
        const surfaceMenuState = normalizedSnapshot?.surfaceMenuState
            || normalizedSnapshot?.menuUiContext?.surfaceMenuState
            || resolveSurfaceMenuState(settings, {
                productSurfaceId: surfacePolicy?.productSurfaceId,
                maps: runtimeMaps,
            });
        const multiplayerSessionState = normalizedSnapshot?.multiplayerSessionState
            || this.port?.getMultiplayerSessionState?.()
            || null;
        this._activeSyncSnapshot = {
            surfacePolicy,
            surfaceMenuState,
            multiplayerSessionState,
        };
        try {
            const startSetup = ensureStartSetupLocalState(settings);
            const resolvedMultiplayerSessionState = this._getMultiplayerSessionState();
            const modePath = surfaceMenuState.modePath;
            const hangarSelectionModePath = this._resolveHangarSelectionModePath(settings);
            const sessionType = surfaceMenuState.sessionType;
            const multiplayerTransportUiState = this._resolveMultiplayerTransportUiState(settings);
            const sessionContract = resolveRuntimeSessionContract({
                sessionType,
                multiplayerTransport: settings?.localSettings?.multiplayerTransport,
            });
            const isMultiplayerSession = sessionType === MENU_SESSION_TYPES.MULTIPLAYER;
            const configuredArcadeGhostDuelMode = normalizeArcadeGhostDuelMode(
                startSetup.arcadeGhostDuelMode,
                ARCADE_GHOST_DUEL_MODES.OFF
            );
            startSetup.arcadeGhostDuelMode = configuredArcadeGhostDuelMode;
            const configuredArcadeGhostTrailCollisionEnabled = normalizeArcadeGhostTrailCollisionEnabled(
                startSetup.arcadeGhostTrailCollisionEnabled,
                false
            );
            startSetup.arcadeGhostTrailCollisionEnabled = configuredArcadeGhostTrailCollisionEnabled;
            const ghostDuelSelectable = sessionType === MENU_SESSION_TYPES.SINGLE;
            const effectiveArcadeGhostDuelMode = ghostDuelSelectable
                ? configuredArcadeGhostDuelMode
                : ARCADE_GHOST_DUEL_MODES.OFF;
            const ghostTrailCollisionSelectable = ghostDuelSelectable
                && isArcadeGhostDuelPlaybackEnabled(effectiveArcadeGhostDuelMode);
            const effectiveArcadeGhostTrailCollisionEnabled = ghostTrailCollisionSelectable
                && configuredArcadeGhostTrailCollisionEnabled;
            const hasActiveLobbySession = isMultiplayerSession && resolvedMultiplayerSessionState?.joined === true;
            const ghostDuelState = {
                configuredMode: configuredArcadeGhostDuelMode,
                configuredTrailCollisionEnabled: configuredArcadeGhostTrailCollisionEnabled,
                duelSelectable: ghostDuelSelectable,
                effectiveMode: effectiveArcadeGhostDuelMode,
                trailCollisionSelectable: ghostTrailCollisionSelectable,
                effectiveTrailCollisionEnabled: effectiveArcadeGhostTrailCollisionEnabled,
            };
            const { effectiveMapKey } = syncStartSetupSelectionState({
                ui: this.ui,
                settings,
                startSetup,
                runtimeMaps,
                surfaceMenuState,
                mapPreviewEntries: this._mapPreviewEntries,
                vehiclePreviewEntries: this._vehiclePreviewEntries,
                modePath,
                hangarSelectionModePath,
                surfacePolicyPort: this._getSurfacePolicyPort(),
                formatMapLabel: (entry) => this._formatMapLabel(entry),
                resolveSurfaceFallbackMapKey: (maps, nextModePath, currentMapKey) => this._resolveSurfaceFallbackMapKey(maps, nextModePath, currentMapKey),
                hasStoredCustomMap: () => this._hasStoredCustomMap(),
                ghostDuelState,
            });
            this._mapPicker3d?.sync({ mapKey: effectiveMapKey, maps: runtimeMaps });
            const lobbyMapKey = resolvedMultiplayerSessionState?.metadata?.mapKey;
            this.ui.lobbyMapPreviewMount?.classList.toggle('hidden', !hasActiveLobbySession || !runtimeMaps[lobbyMapKey]);
            this._lobbyMapPicker3d?.sync({ mapKey: lobbyMapKey, maps: runtimeMaps });
            this._vehiclePicker3d?.sync({ settings, sessionType });

        const surfaceEntryCopy = resolveSurfaceEntryCopy({
            productSurfaceId: this._resolveSurfacePolicy()?.productSurfaceId,
            sessionType,
        });
        renderStartSetupSummaryAndPreview({
            ui: this.ui,
            settings,
            sessionType,
            modePath,
            effectiveMapKey,
            surfaceEntryCopy,
            sessionContract,
            resolvedMultiplayerSessionState,
            hasActiveLobbySession,
            ghostDuelState,
        });
        syncStartSetupMultiplayerUi({
            ui: this.ui,
            sessionType,
            surfaceEntryCopy,
            sessionContract,
            multiplayerTransportUiState,
            resolvedMultiplayerSessionState,
            hasActiveLobbySession,
        });

        if (this.ui.themeModeSelect) {
            const themeMode = String(settings?.localSettings?.themeMode || 'dunkel').toLowerCase() === 'hell' ? 'hell' : 'dunkel';
            this.ui.themeModeSelect.value = themeMode;
        }

        const level4Open = !!settings?.localSettings?.toolsState?.level4Open;
        this.manager.setLevel4Open(level4Open);
        this._renderStartFieldHints(settings);
        } finally {
            this._activeSyncSnapshot = previousSyncSnapshot;
        }
    }

    // ------------------------------------------------------------------
    // Dispose
    // ------------------------------------------------------------------

    dispose() {
        this._lobbyMapPicker3d?.dispose();
        this._lobbyMapPicker3d = null;
        this._mapPicker3d?.dispose();
        this._mapPicker3d = null;
        this._vehiclePicker3d?.dispose();
        this._vehiclePicker3d = null;
        this.manager._disposeDisposerList(this._startSetupDisposers);
    }
}
