// ============================================
// MenuDeveloperStateSync.js - sync helper for developer panel state
// ============================================

import { applyDeveloperThemeToDocument } from './MenuDeveloperModeOps.js';
import { renderMenuTelemetryDashboard } from './MenuTelemetryDashboard.js';

function readTelemetryFilters(ui) {
    const sinceDays = Number(ui.telemetryFilterPeriod?.value);
    return {
        buildId: String(ui.telemetryFilterBuild?.value || '').trim(),
        mapKey: String(ui.telemetryFilterMap?.value || '').trim(),
        mode: String(ui.telemetryFilterMode?.value || '').trim(),
        sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 0,
    };
}

function syncFilterOptions(select, values) {
    if (!select) return;
    const currentValue = String(select.value || '');
    const uniqueValues = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Alle';
    select.replaceChildren(allOption);
    uniqueValues.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.add(option);
    });
    select.value = uniqueValues.includes(currentValue) ? currentValue : '';
}

function telemetryRowsToCsv(rows) {
    const fields = [
        'at', 'buildId', 'appVersion', 'mapKey', 'mapRevision', 'mode', 'modePath', 'sessionType',
        'platform', 'graphicsQuality', 'playerCount', 'humanCount', 'botCount', 'botDifficulty',
        'botPolicy', 'winnerType', 'reason', 'duration', 'selfCollisions', 'itemUses', 'stuckEvents',
        'parcoursCompleted', 'parcoursCompletionTimeMs',
    ];
    const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [fields.join(','), ...rows.map((row) => fields.map((field) => escapeCell(row?.[field])).join(','))].join('\n');
}

function downloadTelemetryFile(filename, contents, mimeType) {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
}

/** @param {{ui?: any, game?: any, settingsManager?: any}} [context] */
export async function refreshTelemetryPanel({ ui, game, settingsManager = game?.settingsManager } = {}) {
    if (!ui?.developerTelemetryPanel || !settingsManager) return null;
    if (ui.telemetryStatus) ui.telemetryStatus.textContent = 'Telemetrie wird geladen …';
    try {
        const snapshot = await settingsManager.getTelemetryExportSnapshot?.(readTelemetryFilters(ui));
        if (!snapshot) return null;
        const allRows = await settingsManager.getTelemetryExportSnapshot?.() || snapshot;
        syncFilterOptions(ui.telemetryFilterBuild, (allRows.historyEntries || []).map((entry) => entry.buildId));
        syncFilterOptions(ui.telemetryFilterMap, (allRows.historyEntries || []).map((entry) => entry.mapKey));
        syncFilterOptions(ui.telemetryFilterMode, (allRows.historyEntries || []).map((entry) => entry.mode));
        renderMenuTelemetryDashboard(
            ui.developerTelemetryDashboard,
            snapshot.gameplay,
            snapshot.authoring,
            snapshot.historySummary
        );
        if (ui.developerTelemetryOutput) ui.developerTelemetryOutput.textContent = JSON.stringify(snapshot, null, 2);
        if (ui.telemetryCollectionToggle) ui.telemetryCollectionToggle.checked = snapshot.preferences?.collectionEnabled !== false;
        if (ui.telemetryStatus) ui.telemetryStatus.textContent = `${snapshot.historyEntries?.length || 0} Runden im aktiven Filter.`;
        return snapshot;
    } catch (error) {
        if (ui.telemetryStatus) ui.telemetryStatus.textContent = `Telemetrie konnte nicht geladen werden: ${String(error?.message || error)}`;
        return null;
    }
}

/** @param {{ui?: any, game?: any, bind?: Function}} [ctx] */
export function setupMenuTelemetryControls(ctx = {}) {
    const { ui, game, bind } = ctx;
    const settingsManager = game?.settingsManager;
    if (!ui?.developerTelemetryPanel || !settingsManager || typeof bind !== 'function') return;
    const refresh = () => refreshTelemetryPanel({ ui, game, settingsManager });
    bind(ui.openDebugButton, 'click', () => { setTimeout(refresh, 0); });
    bind(ui.telemetryRefreshButton, 'click', refresh);
    [ui.telemetryFilterBuild, ui.telemetryFilterMap, ui.telemetryFilterMode, ui.telemetryFilterPeriod]
        .forEach((select) => bind(select, 'change', refresh));
    bind(ui.telemetryCollectionToggle, 'change', () => {
        settingsManager.setTelemetryCollectionEnabled?.(ui.telemetryCollectionToggle.checked);
        refresh();
    });
    bind(ui.telemetryExportJsonButton, 'click', async () => {
        const snapshot = await settingsManager.getTelemetryExportSnapshot?.(readTelemetryFilters(ui));
        if (snapshot) downloadTelemetryFile('curviosclash-telemetry.json', JSON.stringify(snapshot, null, 2), 'application/json');
    });
    bind(ui.telemetryExportCsvButton, 'click', async () => {
        const snapshot = await settingsManager.getTelemetryExportSnapshot?.(readTelemetryFilters(ui));
        if (snapshot) downloadTelemetryFile('curviosclash-rounds.csv', telemetryRowsToCsv(snapshot.historyEntries || []), 'text/csv;charset=utf-8');
    });
    bind(ui.telemetryResetButton, 'click', async () => {
        if (typeof window !== 'undefined' && !window.confirm('Alle lokalen Telemetriedaten löschen?')) return;
        await settingsManager.clearTelemetry?.(game?.settings);
        await refresh();
    });
}

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
    const authoringTelemetrySnapshot = settingsManager?.getAuthoringTelemetrySnapshot?.() || null;
    if (ui.developerTelemetryDashboard) {
        renderMenuTelemetryDashboard(ui.developerTelemetryDashboard, telemetrySnapshot, authoringTelemetrySnapshot);
    }
    if (ui.developerTelemetryOutput) {
        ui.developerTelemetryOutput.textContent = telemetrySnapshot || authoringTelemetrySnapshot
            ? JSON.stringify({ gameplay: telemetrySnapshot, authoring: authoringTelemetrySnapshot }, null, 2)
            : 'Keine Telemetrie vorhanden.';
    }
    if (ui.telemetryCollectionToggle) {
        ui.telemetryCollectionToggle.checked = settingsManager?.getTelemetryPreferences?.()?.collectionEnabled !== false;
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
