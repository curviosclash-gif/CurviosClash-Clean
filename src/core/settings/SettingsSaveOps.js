import { isPersistenceSuccess } from './SettingsDomainUtils.js';

const SAVE_FAILED_MESSAGE = 'Einstellungen konnten nicht gespeichert werden.';
const SAVE_QUOTA_MESSAGE = 'Einstellungen konnten nicht gespeichert werden – der Speicherplatz ist voll.';

// Last failure reason per settings store. A background autosave repeats a known failure
// silently; an explicit save and every new reason are always reported.
const lastFailureReasonByStore = new WeakMap();

/**
 * Saves the persistable settings and reports a failed save honestly: the settings stay dirty
 * so a later save retries, and the player sees why nothing was written.
 *
 * @param {{
 *   settings: any,
 *   settingsHandler?: any,
 *   settingsManager: { saveSettings: (settings: any) => any },
 *   markDirty: (dirty: boolean) => void,
 *   showToast: (message: string, durationMs: number, tone: string) => void,
 *   explicit?: boolean,
 * }} options
 */
export function persistGameSettings({ settings, settingsHandler, settingsManager, markDirty, showToast, explicit = false }) {
    const persistableSettings = typeof settingsHandler?.createPersistableSettingsSnapshot === 'function'
        ? settingsHandler.createPersistableSettingsSnapshot(settings)
        : settings;
    const persisted = persistableSettings
        ? settingsManager.saveSettings(persistableSettings)
        : { success: false, reason: 'settings_snapshot_unavailable' };
    if (isPersistenceSuccess(persisted)) {
        lastFailureReasonByStore.delete(settingsManager);
        markDirty(false);
        return persisted;
    }
    markDirty(true);
    const reason = String(persisted?.reason || 'unknown');
    if (explicit || lastFailureReasonByStore.get(settingsManager) !== reason) {
        showToast(reason === 'quota_exceeded' ? SAVE_QUOTA_MESSAGE : SAVE_FAILED_MESSAGE, 2200, 'error');
    }
    lastFailureReasonByStore.set(settingsManager, reason);
    return persisted;
}

/**
 * A profile switch that could not save its settings is only half done: the profile is active,
 * but reloading now would lose the settings. Returns that partial result, or null after a save.
 *
 * @param {{ id: string, displayName: string }} profile
 * @param {any} persistenceResult
 */
export function resolveProfileSettingsSaveFailure(profile, persistenceResult) {
    if (isPersistenceSuccess(persistenceResult)) return null;
    return {
        ok: false,
        reason: 'settings_persistence_failed',
        activeProfileChanged: true,
        profileId: profile.id,
        profileName: profile.displayName,
        persistenceResult,
    };
}
