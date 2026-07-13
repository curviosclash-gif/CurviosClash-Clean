// ============================================
// MenuDeveloperStateSync.js - sync helper for developer panel state
// ============================================

import { applyDeveloperThemeToDocument } from './MenuDeveloperModeOps.js';
import { renderMenuTelemetryDashboard } from './MenuTelemetryDashboard.js';

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
        ui.developerModeToggle.disabled = !releaseState?.featureEnabled || accessContext?.expertModeUnlocked !== true;
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
        ui.developerReleasePreviewToggle.disabled = !releaseState?.featureEnabled || accessContext?.expertModeUnlocked !== true;
    }

    const controlsLocked = !releaseState?.featureEnabled
        || accessContext?.expertModeUnlocked !== true
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
        ui.developerTrainingModeSelect,
        ui.developerTrainingPlanarToggle,
        ui.developerTrainingMaxStepsInput,
        ui.developerTrainingSeedInput,
        ui.developerTrainingInventoryInput,
        ui.developerTrainingYawSelect,
        ui.developerTrainingPitchSelect,
        ui.developerTrainingBoostToggle,
        ui.developerTrainingShootMgToggle,
        ui.developerTrainingShootItemToggle,
        ui.developerTrainingShootItemIndexInput,
        ui.developerTrainingKillsInput,
        ui.developerTrainingDamageDealtInput,
        ui.developerTrainingDamageTakenInput,
        ui.developerTrainingItemUsesInput,
        ui.developerTrainingCrashedToggle,
        ui.developerTrainingStuckToggle,
        ui.developerTrainingWonToggle,
        ui.developerTrainingLostToggle,
        ui.developerTrainingDoneToggle,
        ui.developerTrainingTerminalReasonInput,
        ui.developerTrainingAutoStepsInput,
        ui.developerTrainingBatchEpisodesInput,
        ui.developerTrainingBatchSeedsInput,
        ui.developerTrainingBatchModesInput,
        ui.developerTrainingBridgeModeSelect,
        ui.developerTrainingTimeoutMsInput,
        ui.developerTrainingGateMinReturnInput,
        ui.developerTrainingGateMinTerminalRateInput,
        ui.developerTrainingGateMaxTruncationRateInput,
        ui.developerTrainingGateMaxInvalidRateInput,
        ui.developerTrainingGateMaxRuntimeErrorsInput,
        ui.developerTrainingResetButton,
        ui.developerTrainingStepButton,
        ui.developerTrainingAutoStepButton,
        ui.developerTrainingRunBatchButton,
        ui.developerTrainingRunEvalButton,
        ui.developerTrainingRunGateButton,
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

    const telemetrySnapshot = settingsManager?.getMenuTelemetrySnapshot?.(settings)
        || localSettings.telemetryState
        || null;
    if (ui.developerTelemetryDashboard) {
        renderMenuTelemetryDashboard(ui.developerTelemetryDashboard, telemetrySnapshot);
    }
    if (ui.developerTelemetryOutput) {
        ui.developerTelemetryOutput.textContent = telemetrySnapshot
            ? JSON.stringify(telemetrySnapshot, null, 2)
            : 'Keine Telemetrie vorhanden.';
    }

    if (ui.developerHint) {
        const mode = String(localSettings.developerModeVisibility || 'owner_only');
        const ownerState = accessContext?.isOwner ? 'owner' : 'player';
        const expertState = accessContext?.expertModeAvailable === false
            ? `local_only(${String(accessContext?.expertModeReason || 'surface')})`
            : (accessContext?.expertModeUnlocked ? 'unlocked' : 'locked');
        const surfaceState = String(accessContext?.expertModeProductSurfaceId || 'unknown');
        const releaseStateText = releaseState?.releasePreviewEnabled
            ? 'release_preview_active'
            : (releaseState?.featureEnabled ? 'dev_enabled' : 'dev_feature_off');
        ui.developerHint.textContent = `Developer Scope: ${mode} | Session: ${ownerState} | Expert: ${expertState} | Surface: ${surfaceState} | Release: ${releaseStateText}`;
    }
}
