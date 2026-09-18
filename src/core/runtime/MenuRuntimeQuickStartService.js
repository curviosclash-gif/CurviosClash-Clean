// ============================================
// MenuRuntimeQuickStartService.js - quickstart actions (last/event-playlist/random)
// ============================================

import { CONFIG } from '../Config.js';
import { getNextEventPlaylistEntry } from '../../composition/core-ui/CoreUiMenuPorts.js';
import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import { listEligibleMapKeysForModePath } from '../../shared/contracts/MapModeContract.js';
import { PLATFORM_SURFACE_QUICK_START_ACTION_IDS } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import { appendMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';
import { createSessionSettingsRestorePlan } from './SessionSettingsRestorePlan.js';

// The one value a playlist start is allowed to keep: its cursor is persisted on purpose.
const EVENT_PLAYLIST_STATE_PATH = 'localSettings.eventPlaylistState';

export function resolvePresetFailureMessage(result, fallbackMessage) {
    switch (result?.reason) {
    case 'invalid_preset_id':
        return 'Preset-ID ist ungueltig.';
    case 'preset_not_found':
        return 'Preset wurde nicht gefunden.';
    case 'owner_required':
        return 'Nur der Host darf dieses Preset anwenden.';
    default:
        return fallbackMessage;
    }
}

function cloneJsonSnapshot(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function buildEventPlaylistPersistedSettings(baseSettingsSnapshot, runtimeSettings) {
    const baseSettings = baseSettingsSnapshot && typeof baseSettingsSnapshot === 'object'
        ? baseSettingsSnapshot
        : cloneJsonSnapshot(runtimeSettings);
    if (!baseSettings || typeof baseSettings !== 'object') return null;
    if (!baseSettings.localSettings || typeof baseSettings.localSettings !== 'object') {
        baseSettings.localSettings = {};
    }
    baseSettings.localSettings.eventPlaylistState = {
        ...(runtimeSettings?.localSettings?.eventPlaylistState || {}),
    };
    return baseSettings;
}

function resolveQuickStartRng(game, event = null) {
    const runtimeRng = game?.runtimeRng && typeof game.runtimeRng.next === 'function'
        ? game.runtimeRng
        : createRuntimeRng({
            random: typeof game?.random === 'function' ? game.random : Math.random,
        });
    const hasSeed = Number.isFinite(Number(event?.seed));
    if (!hasSeed) {
        return runtimeRng;
    }
    return createRuntimeRng({ seed: Number(event.seed) });
}

function getSurfacePort(game) {
    return createSurfacePolicyPort({
        getProductSurfaceId: () => resolveProductSurfaceId(game),
        getSettings: () => game?.settings
    });
}

function resolveProductSurfaceId(game) {
    const productSurfaceId = String(
        game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || ''
    ).trim().toLowerCase();
    return productSurfaceId;
}

export async function handleQuickStartLastStartAction(ctx) {
    const { game, recordMenuTelemetry, startMatch } = ctx;
    if (game?.settings?.localSettings?.sessionType === 'multiplayer') {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-multiplayer', { trigger: 'quickstart_lobby' });
        return false;
    }
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.LAST_SETTINGS)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Direktstart');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return false;
    }
    let started = false;
    try {
        started = await Promise.resolve(startMatch());
    } catch (err) {
        started = false;
        game._showStatusToast('Schnellstart fehlgeschlagen: Interner Fehler.', 2000, 'error');
    }
    if (!started) {
        game._showStatusToast('Schnellstart fehlgeschlagen: Startblockierung oder Validierungsfehler.', 2000, 'error');
        return false;
    }
    recordMenuTelemetry('quickstart', {
        variant: 'last_settings',
        sessionType: game?.settings?.localSettings?.sessionType || 'single',
    });
    game._showStatusToast('Schnellstart: letzte Einstellungen', 1000, 'info');
    return true;
}

export async function handleQuickStartEventPlaylistStartAction(ctx) {
    const {
        game,
        onSettingsChanged,
        resolveMenuAccessContext,
        recordMenuTelemetry,
        startMatch,
        cancelPendingSettingsAutoSave,
        holdSessionSettingsRestore,
        restoreSessionSettings,
    } = ctx;
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.EVENT_PLAYLIST)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Event-Playlist');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return;
    }
    const playlistStep = getNextEventPlaylistEntry(game?.settings?.localSettings?.eventPlaylistState);
    const presetId = String(playlistStep?.entry?.presetId || '').trim();
    if (!presetId) {
        game._showStatusToast('Event-Playlist ist nicht verfuegbar.', 1500, 'error');
        return;
    }
    const baselineSettingsSnapshot = cloneJsonSnapshot(game.settings);

    const presetResult = game.settingsManager.applyMenuPreset(
        game.settings,
        presetId,
        resolveMenuAccessContext()
    );
    if (!presetResult.success) {
        game._showStatusToast(resolvePresetFailureMessage(presetResult, 'Event-Playlist konnte nicht vorbereitet werden.'), 1600, 'error');
        return;
    }

    game.settings.localSettings.modePath = 'quick_action';
    game.settings.localSettings.eventPlaylistState = {
        ...playlistStep.persistedState,
    };

    const changedKeys = [
        SETTINGS_CHANGE_KEYS.MODE_PATH,
    ];
    appendMutationChangedKeys(changedKeys, presetResult);
    onSettingsChanged({ changedKeys: Array.from(new Set(changedKeys)) });

    // The preset only borrows the live settings for this one match. Remembering what it
    // replaced is what lets the way back to the menu hand the player his own setup again.
    holdSessionSettingsRestore?.(createSessionSettingsRestorePlan(baselineSettingsSnapshot, game.settings, {
        ignoredPaths: [EVENT_PLAYLIST_STATE_PATH],
    }));

    const presetName = String(playlistStep?.preset?.name || presetId).trim() || presetId;
    let started = false;
    try {
        started = await Promise.resolve(startMatch());
    } catch {
        started = false;
    }
    if (!started) {
        // No match ran: the cursor must not move on either, or the next click skips an entry.
        game.settings.localSettings.eventPlaylistState = {
            ...(baselineSettingsSnapshot?.localSettings?.eventPlaylistState || {}),
        };
        cancelPendingSettingsAutoSave?.();
        restoreSessionSettings?.();
        return;
    }
    recordMenuTelemetry('quickstart', {
        variant: 'event_playlist',
        playlistId: playlistStep?.playlist?.id || '',
        presetId,
        stepIndex: playlistStep.currentIndex,
        displayIndex: playlistStep.displayIndex,
        totalSteps: playlistStep.totalSteps,
        sessionType: game?.settings?.localSettings?.sessionType || 'single',
    });
    // Event-Playlist darf nur den Cursor persistieren, nicht still die komplette Runtime-Konfiguration als neue Baseline speichern.
    const persistedSettings = buildEventPlaylistPersistedSettings(baselineSettingsSnapshot, game.settings);
    if (persistedSettings) {
        // The autosave armed by onSettingsChanged above would write the running playlist
        // configuration over this baseline 400 ms later, dropping the player's own map.
        cancelPendingSettingsAutoSave?.();
        game.settingsManager.saveSettings(persistedSettings);
    }
    game._showStatusToast(
        `Event-Playlist: ${presetName} (${playlistStep.displayIndex}/${playlistStep.totalSteps})`,
        1300,
        'info'
    );
}

export async function handleQuickStartRandomStartAction(ctx) {
    const { game, event, onSettingsChanged, recordMenuTelemetry, startMatch } = ctx;
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.RANDOM_MAP)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Random-Start');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return false;
    }
    const mapKeys = listEligibleMapKeysForModePath(CONFIG?.MAPS, 'quick_action', { includeCustom: false });
    if (mapKeys.length > 0) {
        const rng = resolveQuickStartRng(game, event);
        const randomIndex = rng.int(mapKeys.length);
        game.settings.mapKey = mapKeys[randomIndex];
    }
    game.settings.localSettings.modePath = 'quick_action';
    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.MODE_PATH,
            SETTINGS_CHANGE_KEYS.MAP_KEY,
        ],
    });
    let started = false;
    try {
        started = await Promise.resolve(startMatch());
    } catch (err) {
        started = false;
        game._showStatusToast('Schnellstart fehlgeschlagen: Interner Fehler.', 2000, 'error');
    }
    if (!started) {
        game._showStatusToast('Schnellstart fehlgeschlagen: Startblockierung oder Validierungsfehler.', 2000, 'error');
        return false;
    }
    recordMenuTelemetry('quickstart', {
        variant: 'random_map',
        mapKey: game.settings.mapKey,
        sessionType: game?.settings?.localSettings?.sessionType || 'single',
    });
    game._showStatusToast('Schnellstart: Random Map', 1000, 'info');
    return true;
}
