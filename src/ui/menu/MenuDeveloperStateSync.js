// ============================================
// MenuDeveloperStateSync.js - sync helper for developer panel state
// ============================================

import { applyDeveloperThemeToDocument } from './MenuDeveloperModeOps.js';

export function syncMenuDeveloperState({
    ui,
    settings,
    settingsManager,
    accessContext,
    menuTextRuntime,
    releaseState,
}) {
    if (!ui || !settings) return;
    const localSettings = settings?.localSettings || {};
    const resolvedDeveloperEnabled = !!localSettings.developerModeEnabled
        && !!releaseState?.featureEnabled
        && !releaseState?.releasePreviewEnabled;
    const resolvedThemeId = releaseState?.releaseCutEnabled
        ? 'classic-console'
        : String(localSettings.developerThemeId || 'classic-console');

    applyDeveloperThemeToDocument(resolvedThemeId);

    menuTextRuntime?.applyToDocument?.(document, {
        allowOverrides: true,
        developerFeatureEnabled: !!releaseState?.featureEnabled,
        developerModeEnabled: resolvedDeveloperEnabled,
        releasePreviewEnabled: !!releaseState?.releaseCutEnabled,
    });

    if (ui.developerModeToggle) {
        ui.developerModeToggle.checked = !!localSettings.developerModeEnabled;
        ui.developerModeToggle.disabled = !releaseState?.featureEnabled || accessContext?.developerToolsEnabled !== true;
    }
    if (ui.developerThemeSelect) {
        ui.developerThemeSelect.value = String(localSettings.developerThemeId || 'classic-console');
    }
    if (ui.developerVisibilitySelect && localSettings.developerModeVisibility) {
        ui.developerVisibilitySelect.value = String(localSettings.developerModeVisibility);
    }
    if (ui.developerFixedPresetLockToggle) {
        ui.developerFixedPresetLockToggle.checked = !!localSettings.fixedPresetLockEnabled;
    }
    if (ui.developerActorSelect && localSettings.actorId) {
        ui.developerActorSelect.value = String(localSettings.actorId);
    }
    if (ui.developerReleasePreviewToggle) {
        ui.developerReleasePreviewToggle.checked = !!localSettings.releasePreviewEnabled;
        ui.developerReleasePreviewToggle.disabled = !releaseState?.featureEnabled || accessContext?.developerToolsEnabled !== true;
    }

    const controlsLocked = !releaseState?.featureEnabled
        || accessContext?.developerToolsEnabled !== true
        || !localSettings.developerModeEnabled
        || !!releaseState?.releasePreviewEnabled;
    const developerControls = [
        ui.developerThemeSelect,
        ui.developerVisibilitySelect,
        ui.developerFixedPresetLockToggle,
        ui.developerActorSelect,
        ui.developerTextIdSelect,
        ui.developerTextOverrideInput,
        ui.developerTextApplyButton,
        ui.developerTextClearButton,
    ];
    developerControls.forEach((control) => {
        if (!control) return;
        control.disabled = controlsLocked;
    });

    const selectedTextId = String(ui.developerTextIdSelect?.value || '').trim();
    if (ui.developerTextOverrideInput) {
        const overrideValue = settingsManager?.getMenuTextOverridePort?.()?.getOverride?.(selectedTextId) || '';
        if (ui.developerTextOverrideInput.value !== overrideValue) {
            ui.developerTextOverrideInput.value = overrideValue;
        }
    }

    if (ui.developerHint) {
        const mode = String(localSettings.developerModeVisibility || 'owner_only');
        const ownerState = accessContext?.isOwner ? 'owner' : 'player';
        const toolsState = accessContext?.developerToolsEnabled ? 'enabled' : 'disabled';
        const releaseStateText = releaseState?.releasePreviewEnabled
            ? 'release_preview_active'
            : (releaseState?.featureEnabled ? 'dev_enabled' : 'dev_feature_off');
        ui.developerHint.textContent = `Developer Scope: ${mode} | Session: ${ownerState} | Tools: ${toolsState} | Release: ${releaseStateText}`;
    }
}
