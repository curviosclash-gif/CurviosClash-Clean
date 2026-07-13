import { createSettingsHealthSnapshot } from './SettingsHealthSnapshot.js';
import { diffSettingsSnapshots } from './SettingsDiffOps.js';
import { previewMenuConfigImport } from './SettingsImportPreviewOps.js';

export function createSettingsDiagnosticsFacade(manager) {
    function diffSettings(before, after) {
        return diffSettingsSnapshots(before, after);
    }

    function previewImport(settings, inputValue, accessContext = null) {
        return previewMenuConfigImport({
            settings,
            inputValue,
            accessContext,
            sanitizeSettings: (snapshot) => manager.sanitizeSettings(snapshot),
            applyMenuCompatibilityRules: (snapshot, options = {}) => manager.applyMenuCompatibilityRules(snapshot, options),
            diffSettings,
        });
    }

    function getHealthSnapshot(settings = null) {
        return createSettingsHealthSnapshot({
            settings: settings && typeof settings === 'object' ? settings : manager.loadSettings(),
            recordStorePort: manager.settingsRecordStorePort,
            profileStorePort: manager.profileStorePort,
            menuTextOverridePort: manager.menuTextOverridePort,
            listMenuPresets: () => manager.listMenuPresets(),
            telemetryFacade: manager.telemetryFacade,
            persistenceStatus: manager.settingsStore.getPersistenceStatus(),
        });
    }

    return Object.freeze({
        diffSettings,
        previewMenuConfigImport: previewImport,
        getSettingsHealthSnapshot: getHealthSnapshot,
    });
}
