// ============================================
// MenuRuntimeQuickStartService.js - quickstart actions (last/event-playlist/random)
// ============================================

import { CONFIG } from '../Config.js';
import { getNextEventPlaylistEntry, resolveContinueSessionType } from '../../composition/core-ui/CoreUiMenuPorts.js';
import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import { listEligibleMapKeysForModePath } from '../../shared/contracts/MapModeContract.js';
import { PLATFORM_SURFACE_QUICK_START_ACTION_IDS } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import { readGamepad } from '../../shared/input/GamepadInputSource.js';
import { isFourPlayerPlanarVariant, isThreePlayerSplitVariant, resolveSplitScreenDeviceIssue } from '../../four-player-planar/FourPlayerPlanarContract.js';
import { handleSessionTypeChangeAction } from './MenuRuntimeSessionSwitchService.js';
import { appendMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';
import { createSessionSettingsRestorePlan } from './SessionSettingsRestorePlan.js';
import { createPlayerProfileMenuRuntimeAccess } from './PlayerProfileRuntimeAccess.js';
import { startMatchWithBorrowedSettings } from './BorrowedMatchSettingsOps.js';
import { ARCADE_LAST_RUN_STORAGE_KEY } from '../../shared/contracts/ArcadeMenuPersistenceContract.js';
import { resolveArcadeJourneyContinue } from '../../shared/contracts/ArcadeJourneyContinueContract.js';
import { loadArcadeJourneyProgress } from '../../shared/contracts/ArcadeJourneyProgressContract.js';

// The one value a playlist start is allowed to keep: its cursor is persisted on purpose.
const EVENT_PLAYLIST_STATE_PATH = 'localSettings.eventPlaylistState';

export function resolvePresetFailureMessage(result, fallbackMessage) {
    switch (result?.reason) {
    case 'invalid_preset_id':
        return 'Die Vorlagen-Kennung ist ungültig.';
    case 'preset_not_found':
        return 'Vorlage wurde nicht gefunden.';
    case 'owner_required':
        return 'Nur der Host darf diese Vorlage anwenden.';
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

function resolveArcadeJourneyPlayerCount(settings) {
    if (settings?.localSettings?.sessionType !== 'splitscreen') return 1;
    if (isFourPlayerPlanarVariant(settings)) return 4;
    if (isThreePlayerSplitVariant(settings)) return 3;
    return settings?.mode === '2p' ? 2 : 1;
}

// "Weiterspielen" never opens the lobby for a fresh start: it resumes the last local session.
// Only a lobby the player already joined is worth returning to.
function resumeLocalSessionForContinue(ctx) {
    const { game, onSettingsChanged, getMultiplayerSessionState } = ctx;
    if (getMultiplayerSessionState?.()?.joined === true) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-multiplayer', { trigger: 'quickstart_lobby' });
        return false;
    }
    const targetSessionType = resolveContinueSessionType(game.settings.localSettings);
    const localDraftSnapshot = cloneJsonSnapshot(game.settings);
    const hasSavedLocalDraft = !!game.settings.localSettings?.draftStateBySessionType?.[targetSessionType]
        && !!localDraftSnapshot
        && game.settingsManager.applySessionDraft(localDraftSnapshot, targetSessionType).success;
    if (!hasSavedLocalDraft) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-custom', { trigger: 'quickstart_local_setup' });
        game._showStatusToast('Lokale Sitzung einrichten: Es ist noch keine lokale Auswahl gespeichert.', 2800, 'info');
        return false;
    }
    const switchResult = handleSessionTypeChangeAction({
        game,
        event: { sessionType: targetSessionType },
        onSettingsChanged,
    });
    if (!switchResult?.success) return false;
    if (!switchResult.loadedDraft) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-custom', { trigger: 'quickstart_local_setup' });
        game._showStatusToast('Lokale Sitzung einrichten: Es ist noch keine lokale Auswahl gespeichert.', 2800, 'info');
        return false;
    }
    return true;
}

// Split screen without its gamepads cannot start; the hub explains what is missing instead.
function openHubForMissingDevices(ctx, deviceIssue) {
    const { game } = ctx;
    game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-custom', { trigger: 'quickstart_devices' });
    game.uiManager?.showStartValidationError?.({
        message: `Start nicht möglich: ${deviceIssue}`,
        fieldKey: 'players',
        fieldMessage: deviceIssue,
    }, { focusField: false });
    game._showStatusToast(deviceIssue, 2400, 'warning');
}

export async function handleQuickStartLastStartAction(ctx) {
    const { game, recordMenuTelemetry, startMatch, getMultiplayerSessionState } = ctx;
    if (getMultiplayerSessionState?.()?.joined === true) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-multiplayer', { trigger: 'quickstart_lobby' });
        return false;
    }
    if (game?.settings?.localSettings?.sessionType === 'multiplayer' && !resumeLocalSessionForContinue(ctx)) {
        return false;
    }
    const deviceIssue = resolveSplitScreenDeviceIssue(game?.settings, ctx.getGamepad || readGamepad);
    if (deviceIssue) {
        openHubForMissingDevices(ctx, deviceIssue);
        return false;
    }
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.LAST_SETTINGS)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Direktstart');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return false;
    }
    const profileAccess = createPlayerProfileMenuRuntimeAccess(game);
    const profile = profileAccess.getArcadePrimaryPlayerProfile();
    const profileId = String(profile?.id || '').trim();
    const profileStore = profileAccess.getArcadeSettingsStore();
    let lastRunRecord = null;
    try {
        const read = profileStore?.readJsonRecordResult?.(ARCADE_LAST_RUN_STORAGE_KEY);
        if (read?.status === 'found') lastRunRecord = read.value;
    } catch { /* The generic local-session continue remains available if Journey storage is unavailable. */ }
    if (profileId && !lastRunRecord) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-custom', { trigger: 'quickstart_first_journey' });
        return false;
    }
    if (profileId && lastRunRecord) {
        const progress = loadArcadeJourneyProgress(profileStore);
        const profileRecords = profileAccess.getArcadePrimaryProfileRecords()?.records;
        const legacyAccess = Number(profileRecords?.runsPlayed) > 0
            || Number(profileStore?.loadJsonRecord?.('curviosclash.five-portals-records.v1', null)?.bestTotalMs) > 0;
        const continuation = resolveArcadeJourneyContinue(lastRunRecord, {
            profileId,
            progress: progress.progress,
            progressAvailable: progress.status !== 'unavailable',
            playerCount: resolveArcadeJourneyPlayerCount(game.settings),
            legacyAccess,
        });
        if (continuation.status === 'ready') {
            let journeyStarted = false;
            try {
                journeyStarted = await startMatchWithBorrowedSettings({
                    game,
                    startMatch,
                    settingsHandler: {
                        holdSessionSettingsRestore: ctx.holdSessionSettingsRestore,
                        restoreSessionSettings: ctx.restoreSessionSettings,
                    },
                }, { journeyStageId: continuation.stageId });
            } catch {
                journeyStarted = false;
            }
            if (!journeyStarted) {
                game._showStatusToast('Fortsetzen fehlgeschlagen: Die Etappe konnte nicht gestartet werden.', 2000, 'error');
                return false;
            }
            recordMenuTelemetry('quickstart', {
                variant: 'journey_continue', stageId: continuation.stageId, profileId,
                sessionType: game?.settings?.localSettings?.sessionType || 'single',
            });
            game._showStatusToast('Arcade-Reise fortgesetzt.', 1000, 'info');
            return true;
        }
        if (continuation.status === 'locked' || continuation.status === 'unavailable') {
            game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-custom', { trigger: 'quickstart_journey_locked' });
            game.ui?.arcadeJourneyOpenStage?.(continuation.stageId);
            game._showStatusToast(continuation.status === 'locked'
                ? 'Diese Etappe ist für das aktive Profil noch gesperrt.'
                : 'Reisefortschritt ist gerade nicht verfügbar.', 2200, 'info');
            return false;
        }
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
        game._showStatusToast('Event-Playlist ist nicht verfügbar.', 1500, 'error');
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
    const mapKeys = listEligibleMapKeysForModePath(CONFIG?.MAPS, 'quick_action', {
        includeCustom: false,
        gameMode: game.settings?.gameMode,
    });
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
