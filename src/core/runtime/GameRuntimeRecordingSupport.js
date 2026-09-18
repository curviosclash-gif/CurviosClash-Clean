import { MATCH_LIFECYCLE_EVENT_TYPES } from '../../shared/contracts/MatchLifecycleContract.js';
import {
    isCinematicCaptureProfile,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_EXPORT_PRESET,
} from '../../shared/contracts/RecordingCaptureContract.js';

function getRoundRecorder(game) {
    return game?.recorder || null;
}

async function startCinematicRecording({ game, getRuntimeHandle, showStatusToast, recorder }) {
    const renderer = getRuntimeHandle('renderer');
    recorder?.setRecordingCaptureSettings?.({
        profile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
        exportPreset: RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
    });
    renderer?.setRecordingCaptureSettings?.({
        profile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
        exportPreset: RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
    });
    if (typeof game?.render === 'function') game.render();
    const result = await recorder.startRecording({ type: 'cinematic_manual_start' });
    if (result?.started) {
        showStatusToast(
            'Cinematic-Aufnahme gestartet – MP4 wird später im Menü gerendert (F9 zum Stoppen)',
            2600,
            'success'
        );
    } else if (String(result?.reason || '').startsWith('replay_library_')) {
        showStatusToast(
            'Renderliste voll – bitte zuerst eine Aufnahme rendern oder entfernen',
            2600,
            'warning'
        );
    } else {
        showStatusToast('Cinematic-Aufnahme konnte nicht gestartet werden', 1800, 'error');
    }
    return result;
}

export function toggleCinematicRecordingFromHotkey({
    game,
    getRuntimeHandle,
    showStatusToast,
    command = 'toggle',
}) {
    const recorder = getRuntimeHandle('mediaRecorderSystem');
    if (!recorder || typeof recorder.notifyLifecycleEvent !== 'function') return undefined;
    const requestedCommand = ['start', 'stop'].includes(String(command || '').toLowerCase())
        ? String(command).toLowerCase()
        : 'toggle';
    const support = recorder.getSupportState?.() || null;
    if (support && support.canRecord === false) {
        showStatusToast('Videoaufnahme nicht verfügbar', 1600, 'error');
        return false;
    }
    const supportsDirectRecording = typeof recorder.startRecording === 'function'
        && typeof recorder.stopRecording === 'function';
    if (!supportsDirectRecording) {
        recorder.notifyLifecycleEvent(MATCH_LIFECYCLE_EVENT_TYPES.RECORDING_REQUESTED, {
            command: requestedCommand,
        });
        return true;
    }
    if (recorder.isCinematicReplayExporting?.() === true) {
        showStatusToast('Cinematic Replay Render wird abgebrochen...', 1400, 'warning');
        recorder.cancelCinematicReplayExport?.()
            .then(() => showStatusToast('Cinematic Replay Render wurde abgebrochen', 1800, 'info'))
            .catch(() => showStatusToast('Cinematic Replay Render konnte nicht abgebrochen werden', 2000, 'error'));
        return true;
    }
    const wasRecording = !!recorder.isRecording?.();
    const isCinematicRecording = wasRecording
        && isCinematicCaptureProfile(recorder.getRecordingCaptureSettings?.()?.profile);
    if (requestedCommand === 'start' && isCinematicRecording) {
        showStatusToast('Cinematic-Aufnahme läuft bereits', 1600, 'info');
        return true;
    }
    if (isCinematicRecording) {
        showStatusToast('Cinematic-Aufnahme: wird zur Renderliste hinzugefügt...', 1200, 'info');
        recorder.stopRecording({ type: 'cinematic_manual_stop' }).then((result) => {
            if (result?.stopped && result?.queued) {
                const sizeMB = ((result.sizeBytes || 0) / (1024 * 1024)).toFixed(1);
                showStatusToast(
                    `Cinematic-Aufnahme bereit (${sizeMB} MB) – im Menü auswählen und rendern`,
                    3200,
                    'success'
                );
            } else {
                showStatusToast('Cinematic-Aufnahme konnte nicht in die Renderliste übernommen werden', 2400, 'error');
            }
        }).catch(() => showStatusToast('Cinematic-Aufnahme: Fehler beim Ablegen', 2000, 'error'));
        return true;
    }
    if (requestedCommand === 'stop') {
        if (!wasRecording) {
            showStatusToast('Keine Cinematic-Aufnahme aktiv', 1600, 'info');
            return false;
        }
        recorder.stopRecording({ type: 'cinematic_manual_stop' })
            .then((result) => {
                showStatusToast(
                    result?.stopped === false
                        ? 'Cinematic-Aufnahme konnte nicht beendet werden'
                        : 'Videoaufnahme wurde beendet',
                    1800,
                    result?.stopped === false ? 'error' : 'success'
                );
            })
            .catch(() => showStatusToast('Cinematic-Aufnahme: Fehler beim Stoppen', 2000, 'error'));
        return true;
    }
    if (wasRecording) {
        recorder.stopRecording({ type: 'cinematic_switch_stop' })
            .then((result) => {
                if (result?.stopped === false) {
                    showStatusToast('Cinematic-Aufnahme: Fehler beim Wechseln', 2000, 'error');
                    return result;
                }
                return startCinematicRecording({ game, getRuntimeHandle, showStatusToast, recorder });
            })
            .catch(() => {
                showStatusToast('Cinematic-Aufnahme: Fehler beim Stoppen', 2000, 'error');
            });
        return true;
    }
    startCinematicRecording({ game, getRuntimeHandle, showStatusToast, recorder });
    return true;
}

export function finalizeRoundRecording(game, winner, players, options = undefined) {
    return getRoundRecorder(game)?.finalizeRound?.(winner, players, options);
}

export function dumpRoundRecording(game) {
    return getRoundRecorder(game)?.dump?.();
}

export function getLastRoundRecordingMetrics(game) {
    return getRoundRecorder(game)?.getLastRoundMetrics?.() || null;
}

export function getAggregateRecordingMetrics(game) {
    return getRoundRecorder(game)?.getAggregateMetrics?.() || null;
}

export function getLastRoundGhostClip(game, players, options = undefined) {
    return getRoundRecorder(game)?.getLastRoundGhostClip?.(players, options) || null;
}

export function createGameRuntimeRecordingFacadeSupport({
    getGame = null,
    getRuntimeHandle = null,
    showStatusToast = null,
} = {}) {
    const resolveGame = typeof getGame === 'function' ? getGame : () => null;
    const resolveRuntimeHandle = typeof getRuntimeHandle === 'function' ? getRuntimeHandle : () => null;
    const notifyStatusToast = typeof showStatusToast === 'function' ? showStatusToast : () => undefined;

    return Object.freeze({
        toggleCinematicRecordingFromHotkey(command = 'toggle') {
            return toggleCinematicRecordingFromHotkey({
                game: resolveGame(),
                getRuntimeHandle: resolveRuntimeHandle,
                showStatusToast: notifyStatusToast,
                command,
            });
        },
        finalizeRound(winner, players, options = undefined) {
            return finalizeRoundRecording(resolveGame(), winner, players, options);
        },
        dump() {
            return dumpRoundRecording(resolveGame());
        },
        getLastRoundMetrics() {
            return getLastRoundRecordingMetrics(resolveGame());
        },
        getAggregateMetrics() {
            return getAggregateRecordingMetrics(resolveGame());
        },
        getLastRoundGhostClip(players, options = undefined) {
            return getLastRoundGhostClip(resolveGame(), players, options);
        },
    });
}
