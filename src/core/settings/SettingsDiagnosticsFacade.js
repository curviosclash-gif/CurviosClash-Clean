import { createSettingsHealthSnapshot } from './SettingsHealthSnapshot.js';
import { diffSettingsSnapshots } from './SettingsDiffOps.js';
import { previewMenuConfigImport } from './SettingsImportPreviewOps.js';

export function createSettingsDiagnosticsFacade({
    sanitizeSettings,
    applyMenuCompatibilityRules,
    loadSettings,
    recordStorePort,
    profileStorePort,
    menuTextOverridePort,
    listMenuPresets,
    telemetryFacade,
    getPersistenceStatus,
} = {}) {
    function diffSettings(before, after) {
        return diffSettingsSnapshots(before, after);
    }

    function previewImport(settings, inputValue, accessContext = null) {
        return previewMenuConfigImport({
            settings,
            inputValue,
            accessContext,
            sanitizeSettings,
            applyMenuCompatibilityRules,
            diffSettings,
        });
    }

    function getHealthSnapshot(settings = null) {
        return createSettingsHealthSnapshot({
            settings: settings && typeof settings === 'object' ? settings : loadSettings(),
            recordStorePort,
            profileStorePort,
            menuTextOverridePort,
            listMenuPresets,
            telemetryFacade,
            getPersistenceStatus,
        });
    }

    return Object.freeze({
        diffSettings,
        previewMenuConfigImport: previewImport,
        getSettingsHealthSnapshot: getHealthSnapshot,
    });
}
