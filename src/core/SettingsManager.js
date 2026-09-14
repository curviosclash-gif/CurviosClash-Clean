// ============================================
// SettingsManager.js - public settings facade and dependency composition
// ============================================

import { CONFIG } from './Config.js';
import {
    applyMenuCompatibilityRuleSet,
    ensureMenuContractState,
    getFixedMenuPresetCatalog,
    MenuDraftStore,
    MenuPresetStore,
    MenuTelemetryStore,
} from '../composition/core-ui/CoreSettingsPorts.js';
import { MenuTextOverrideStore } from '../shared/settings/MenuTextOverrideStore.js';
import { SettingsStore } from '../shared/settings/SettingsStore.js';
import { createRuntimeConfigSnapshot } from './RuntimeConfig.js';
import { TelemetryHistoryStore } from '../state/TelemetryHistoryStore.js';
import { AuthoringTelemetryStore } from '../state/AuthoringTelemetryStore.js';
import { TelemetryPreferencesStore } from '../shared/telemetry/TelemetryPreferencesStore.js';
import {
    cloneDefaultControlsSnapshot,
    createSettingsDefaultsPortForRuntime,
    createDefaultSettingsSnapshotForRuntime,
    rebaseSettingsSnapshotWithRuntimeDefaults,
} from './settings/SettingsDefaultsFacade.js';
import { sanitizeSettingsSnapshot } from './settings/SettingsSanitizerOps.js';
import { createSettingsSessionDraftFacade } from './settings/SettingsSessionDraftFacade.js';
import { createSettingsPresetFacade } from './settings/SettingsPresetFacade.js';
import { createSettingsDeveloperFacade } from './settings/SettingsDeveloperFacade.js';
import { createSettingsTextOverrideFacade } from './settings/SettingsTextOverrideFacade.js';
import { createSettingsTelemetryFacade } from './settings/SettingsTelemetryFacade.js';
import { createSettingsBotPolicyFacade } from './settings/SettingsBotPolicyFacade.js';
import { createSettingsDiagnosticsFacade } from './settings/SettingsDiagnosticsFacade.js';
import { reconcileSettingsSnapshot } from './settings/SettingsDomainUtils.js';

/**
 * @typedef {object} SettingsManagerOptions
 * @property {object} [runtimeGlobal] Runtime globals used to resolve platform-specific defaults.
 * @property {object} [storagePlatform] Storage adapter shared by settings and sidecar stores.
 * @property {Storage} [storage] Browser-compatible storage fallback.
 * @property {(details: object) => void} [onQuotaExceeded] Storage quota failure callback.
 * @property {(result: object) => void} [onMigrationResult] Settings migration result callback.
 * @property {TelemetryHistoryStore} [telemetryHistoryStore] Optional telemetry history dependency.
 */

export class SettingsManager {
    #settingsStore;
    #menuPresetStore;
    #menuDraftStore;
    #menuTextOverrideStore;
    #menuTelemetryStore;
    #authoringTelemetryStore;
    #telemetryHistoryStore;
    #telemetryPreferencesStore;

    /**
     * @param {SettingsManagerOptions} [options]
     */
    constructor(options = {}) {
        this.runtimeGlobal = options.runtimeGlobal || globalThis;
        this.settingsDefaultsPort = createSettingsDefaultsPortForRuntime(this.runtimeGlobal);
        this.#initializeStores(options);
        this.#initializeFacades();
        this.#initializePorts();
        this.#initializeDiagnosticsFacade();
    }

    #initializeStores(options) {
        const storeOptions = {
            storagePlatform: options.storagePlatform,
            storage: options.storage,
            onQuotaExceeded: options.onQuotaExceeded,
            onMigrationResult: options.onMigrationResult,
        };
        const settingsDefaultsSnapshot = this.settingsDefaultsPort?.getOverrideSnapshot?.();
        const desktopMenuTextOverrides = settingsDefaultsSnapshot?.menuTextOverrides;
        this.#settingsStore = new SettingsStore({
            ...storeOptions,
            sanitizeSettings: (settings) => this.sanitizeSettings(settings),
            createDefaultSettings: () => this.createDefaultSettings(),
        });
        this.#menuPresetStore = new MenuPresetStore({
            ...storeOptions,
            fixedCatalog: getFixedMenuPresetCatalog(),
        });
        this.#menuDraftStore = new MenuDraftStore(storeOptions);
        this.#menuTextOverrideStore = new MenuTextOverrideStore({
            ...storeOptions,
            initialOverrides: desktopMenuTextOverrides?.exists === true
                ? desktopMenuTextOverrides.overrides
                : null,
        });
        this.#telemetryPreferencesStore = new TelemetryPreferencesStore(storeOptions);
        this.#menuTelemetryStore = new MenuTelemetryStore({
            ...storeOptions,
            preferencesStore: this.#telemetryPreferencesStore,
        });
        this.#authoringTelemetryStore = new AuthoringTelemetryStore(storeOptions);
        this.#telemetryHistoryStore = options.telemetryHistoryStore || new TelemetryHistoryStore();
    }

    #initializeFacades() {
        this.sessionDraftFacade = createSettingsSessionDraftFacade({
            menuDraftStore: this.#menuDraftStore,
        });
        this.presetFacade = createSettingsPresetFacade({
            menuPresetStore: this.#menuPresetStore,
            applyMenuCompatibilityRules: (settings, options = {}) => this.applyMenuCompatibilityRules(settings, options),
        });
        this.developerFacade = createSettingsDeveloperFacade();
        this.textOverrideFacade = createSettingsTextOverrideFacade({
            menuTextOverrideStore: this.#menuTextOverrideStore,
        });
        this.telemetryFacade = createSettingsTelemetryFacade({
            menuTelemetryStore: this.#menuTelemetryStore,
            telemetryHistoryStore: this.#telemetryHistoryStore,
            authoringTelemetryStore: this.#authoringTelemetryStore,
            telemetryPreferencesStore: this.#telemetryPreferencesStore,
        });
        this.botPolicyFacade = createSettingsBotPolicyFacade();
    }

    #initializePorts() {
        this.profileStorePort = Object.freeze({
            loadProfiles: () => this.#settingsStore.loadProfiles(),
            saveProfiles: (profiles) => this.#settingsStore.saveProfiles(profiles),
            sanitizeSettings: (settings) => this.sanitizeSettings(settings),
            normalizeProfileName: (rawName) => this.#settingsStore.normalizeProfileName(rawName),
            findProfileIndexByName: (profiles, profileName) => (
                this.#settingsStore.findProfileIndexByName(profiles, profileName)
            ),
            findProfileByName: (profiles, profileName) => (
                this.#settingsStore.findProfileByName(profiles, profileName)
            ),
        });
        this.settingsRecordStorePort = Object.freeze({
            loadJsonRecord: (storageKey, fallbackValue = null) => (
                this.#settingsStore.loadJsonRecord(storageKey, fallbackValue)
            ),
            saveJsonRecord: (storageKey, value) => this.#settingsStore.saveJsonRecord(storageKey, value),
            readJsonRecordResult: (storageKey) => this.#settingsStore.readJsonRecordResult(storageKey),
            removeJsonRecord: (storageKey) => this.#settingsStore.removeJsonRecord(storageKey),
        });
        this.menuTextOverridePort = Object.freeze({
            listOverrides: () => this.textOverrideFacade.listMenuTextOverrides(),
            getOverride: (textId) => this.#menuTextOverrideStore.getOverride(textId),
        });
    }

    #initializeDiagnosticsFacade() {
        this.diagnosticsFacade = createSettingsDiagnosticsFacade({
            sanitizeSettings: (snapshot) => this.sanitizeSettings(snapshot),
            applyMenuCompatibilityRules: (snapshot, options = {}) => (
                this.applyMenuCompatibilityRules(snapshot, options)
            ),
            loadSettings: () => this.loadSettings(),
            recordStorePort: this.settingsRecordStorePort,
            profileStorePort: this.profileStorePort,
            menuTextOverridePort: this.menuTextOverridePort,
            listMenuPresets: () => this.listMenuPresets(),
            telemetryFacade: this.telemetryFacade,
            getPersistenceStatus: () => this.#getPersistenceStatus(),
        });
    }

    #getPersistenceStatus() {
        return {
            ...this.#settingsStore.getPersistenceStatus(),
            presets: this.#menuPresetStore.getPersistenceStatus(),
            drafts: this.#menuDraftStore.getPersistenceStatus(),
            textOverrides: this.#menuTextOverrideStore.getPersistenceStatus(),
            telemetry: this.#menuTelemetryStore.getPersistenceStatus(),
        };
    }

    // Core persistence and defaults

    createDefaultSettings() {
        return createDefaultSettingsSnapshotForRuntime(this.runtimeGlobal);
    }

    cloneDefaultControls() {
        return cloneDefaultControlsSnapshot();
    }

    sanitizeSettings(saved) {
        const sanitizedSettings = sanitizeSettingsSnapshot(
            saved,
            () => this.createDefaultSettings(),
            this.runtimeGlobal
        );
        return rebaseSettingsSnapshotWithRuntimeDefaults(sanitizedSettings, this.runtimeGlobal);
    }

    loadSettings() {
        return this.#settingsStore.loadSettings();
    }

    saveSettings(settings) {
        const result = this.#settingsStore.saveSettings(settings);
        if (result?.success === true) {
            reconcileSettingsSnapshot(settings, result.canonicalSettings);
        }
        return result;
    }

    createRuntimeConfig(settings) {
        return createRuntimeConfigSnapshot(settings, {
            baseConfig: CONFIG,
            settingsDefaultsPort: this.getSettingsDefaultsPort(),
        });
    }

    // Session and presets

    listMenuPresets() {
        return this.presetFacade.listMenuPresets();
    }

    saveSessionDraft(settings, sessionType) {
        return this.sessionDraftFacade.saveSessionDraft(settings, sessionType);
    }

    applySessionDraft(settings, sessionType) {
        return this.sessionDraftFacade.applySessionDraft(settings, sessionType);
    }

    switchSessionType(settings, nextSessionType) {
        return this.sessionDraftFacade.switchSessionType(settings, nextSessionType);
    }

    applyMenuCompatibilityRules(settings, options = {}) {
        ensureMenuContractState(settings);
        return applyMenuCompatibilityRuleSet(settings, options);
    }

    applyMenuPreset(settings, presetId, accessContext = null) {
        return this.presetFacade.applyMenuPreset(settings, presetId, accessContext);
    }

    saveMenuPreset(settings, options = {}, accessContext = null) {
        return this.presetFacade.saveMenuPreset(settings, options, accessContext);
    }

    deleteMenuPreset(presetId, settings, accessContext = null) {
        return this.presetFacade.deleteMenuPreset(presetId, settings, accessContext);
    }

    // Developer tools and text overrides

    setDeveloperMode(settings, enabled, accessContext = null) {
        return this.developerFacade.setDeveloperMode(settings, enabled, accessContext);
    }

    setDeveloperTheme(settings, themeId, accessContext = null) {
        return this.developerFacade.setDeveloperThemeById(settings, themeId, accessContext);
    }

    setDeveloperFixedPresetLock(settings, enabled, accessContext = null) {
        return this.developerFacade.setDeveloperFixedPresetLockState(settings, enabled, accessContext);
    }

    setDeveloperActor(settings, actorId, accessContext = null) {
        return this.developerFacade.setDeveloperActor(settings, actorId, accessContext);
    }

    setDeveloperReleasePreview(settings, enabled, accessContext = null) {
        return this.developerFacade.setDeveloperReleasePreview(settings, enabled, accessContext);
    }

    setDeveloperVisibility(settings, mode, accessContext = null) {
        return this.developerFacade.setDeveloperVisibility(settings, mode, accessContext);
    }

    listMenuTextOverrides() {
        return this.textOverrideFacade.listMenuTextOverrides();
    }

    setMenuTextOverride(textId, textValue) {
        return this.textOverrideFacade.setMenuTextOverride(textId, textValue);
    }

    clearMenuTextOverride(textId) {
        return this.textOverrideFacade.clearMenuTextOverride(textId);
    }

    // Telemetry and bot policy

    getMenuTelemetrySnapshot(settings = null) {
        return this.telemetryFacade.getMenuTelemetrySnapshot(settings);
    }

    getAuthoringTelemetrySnapshot() {
        return this.#authoringTelemetryStore.getSnapshot();
    }

    recordMenuTelemetry(settings, eventType, payload = null) {
        return this.telemetryFacade.recordMenuTelemetry(settings, eventType, payload);
    }

    setBotPolicyStrategy(settings, strategy) {
        return this.botPolicyFacade.setBotPolicyStrategy(settings, strategy);
    }

    getTelemetryHistorySummary(filters = null) {
        return this.telemetryFacade.getTelemetryHistorySummary(filters);
    }

    getTelemetryPreferences() {
        return this.telemetryFacade.getTelemetryPreferences();
    }

    setTelemetryCollectionEnabled(enabled) {
        return this.telemetryFacade.setTelemetryCollectionEnabled(enabled);
    }

    getTelemetryExportSnapshot(filters = null) {
        return this.telemetryFacade.getTelemetryExportSnapshot(filters);
    }

    clearTelemetry(settings = null) {
        return this.telemetryFacade.clearTelemetry(settings);
    }

    // Diagnostics

    diffSettings(before, after) {
        return this.diagnosticsFacade.diffSettings(before, after);
    }

    previewMenuConfigImport(settings, inputValue, accessContext = null) {
        return this.diagnosticsFacade.previewMenuConfigImport(settings, inputValue, accessContext);
    }

    getSettingsHealthSnapshot(settings = null) {
        return this.diagnosticsFacade.getSettingsHealthSnapshot(settings);
    }

    // Runtime ports

    getProfileStorePort() {
        return this.profileStorePort;
    }

    getSettingsRecordStorePort() {
        return this.settingsRecordStorePort;
    }

    setPlayerProfileManager(playerProfileManager = null) {
        this.playerProfileManager = playerProfileManager;
        return this.getPlayerRecordStorePort();
    }

    getPlayerRecordStorePort() {
        return this.playerProfileManager?.getActiveRecordStorePort?.() || this.settingsRecordStorePort;
    }

    getSettingsDefaultsPort() {
        return this.settingsDefaultsPort;
    }

    getMenuTextOverridePort() {
        return this.menuTextOverridePort;
    }
}
