// ============================================
// RuntimeSettingsChangeOrchestrator.js - centralized menu settings-change flow
// ============================================

import {
    filterKnownSettingsChangeKeys,
    hasInvalidSettingsChangeKeys,
} from './RuntimeSettingsChangeKeys.js';

export function orchestrateRuntimeSettingsChanged({
    game,
    event = null,
    resolveMenuAccessContext,
    startValidationRelevantKeySet,
    invalidateMultiplayerReadyIfHostChangedSettings,
    markSettingsDirty,
    updateSaveButtonState,
    scheduleMatchPrewarm,
}) {
    if (!game) return null;
    const rawIncomingChangedKeys = Array.isArray(event?.changedKeys) ? event.changedKeys : [];
    const hasInvalidIncomingKeys = hasInvalidSettingsChangeKeys(rawIncomingChangedKeys);
    const incomingChangedKeys = filterKnownSettingsChangeKeys(rawIncomingChangedKeys);
    if (incomingChangedKeys.some((key) => startValidationRelevantKeySet?.has(key))) {
        game.uiManager?.clearStartValidationError?.();
    }
    const shouldApplyCompatibilityRules = event?.forceCompatibility === true || rawIncomingChangedKeys.length > 0;
    const compatibilityResult = shouldApplyCompatibilityRules
        ? game.settingsManager?.applyMenuCompatibilityRules?.(
            game.settings,
            {
                accessContext: resolveMenuAccessContext?.(),
                changedKeys: incomingChangedKeys,
            }
        )
        : null;
    const rawCompatibilityKeys = Array.isArray(compatibilityResult?.changedKeys)
        ? compatibilityResult.changedKeys
        : [];
    const hasInvalidCompatibilityKeys = hasInvalidSettingsChangeKeys(rawCompatibilityKeys);
    const compatibilityKeys = filterKnownSettingsChangeKeys(rawCompatibilityKeys);
    const mergedChangedKeys = filterKnownSettingsChangeKeys([
        ...incomingChangedKeys,
        ...compatibilityKeys,
    ]);
    const changedKeys = hasInvalidIncomingKeys || hasInvalidCompatibilityKeys
        ? null
        : (mergedChangedKeys.length > 0 ? mergedChangedKeys : null);

    markSettingsDirty?.(true);
    game.renderer?.setShadowQuality?.(game.settings?.localSettings?.shadowQuality);
    game.renderer?.setRecordingCaptureSettings?.(game.settings?.recording);
    game.renderer?.setCameraPerspectiveSettings?.(game.settings?.cameraPerspective);
    game.mediaRecorderSystem?.setRecordingCaptureSettings?.(game.settings?.recording);
    if (game.uiManager) {
        if (Array.isArray(changedKeys) && changedKeys.length > 0 && typeof game.uiManager.syncByChangeKeys === 'function') {
            game.uiManager.syncByChangeKeys(changedKeys);
        } else {
            game.uiManager.syncAll();
        }
        game.uiManager.updateContext();
    }
    if (Array.isArray(changedKeys) && changedKeys.length > 0) {
        invalidateMultiplayerReadyIfHostChangedSettings?.(changedKeys);
    }
    game.keybindEditorController?.renderEditor?.();
    game._syncProfileControls?.();
    updateSaveButtonState?.();
    scheduleMatchPrewarm?.();
    return changedKeys;
}

export function updateSaveButtonUi(game) {
    if (!game?.ui?.saveKeysButton) return;
    game.ui.saveKeysButton.classList.toggle('unsaved', game.settingsDirty);
    game.ui.saveKeysButton.textContent = game.settingsDirty
        ? 'Einstellungen explizit speichern *'
        : 'Einstellungen explizit speichern';
    game.uiManager?.updateContext?.();
}
