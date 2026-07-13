import { MATCH_LIFECYCLE_EVENT_TYPES } from '../../shared/contracts/MatchLifecycleContract.js';
import {
    isCinematicCaptureProfile,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_EXPORT_PRESET,
} from '../../shared/contracts/RecordingCaptureContract.js';
import { RECORDER_ENGINE } from '../recording/MediaRecorderSupport.js';

function getRoundRecorder(game) {
    return game?.recorder || null;
}

function resolveRecorderEngineLabel(engine) {
    const normalized = String(engine || '').trim().toLowerCase();
    if (normalized === RECORDER_ENGINE.NATIVE_WEBCODECS) return 'WebCodecs';
    if (normalized === RECORDER_ENGINE.NATIVE_MEDIARECORDER) return 'MediaRecorder';
    if (normalized === RECORDER_ENGINE.NONE) return 'Kein Recorder';
    return normalized || 'unbekannt';
}

function resolveContainerLabel(container, mimeType = '') {
    const normalized = String(container || '').trim().toLowerCase();
    if (normalized === 'mp4') return 'MP4';
    if (normalized === 'webm') return 'WEBM';
    const mime = String(mimeType || '').trim().toLowerCase();
    if (mime.includes('mp4')) return 'MP4';
    if (mime.includes('webm')) return 'WEBM';
    return normalized ? normalized.toUpperCase() : 'UNBEKANNT';
}

function resolvePathTail(pathValue) {
    const normalized = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!normalized) return '';
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
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
        const deliveryContainer = String(result?.deliveryContainer || '').toLowerCase();
        const engine = result?.recorderEngine || 'unknown';
        const engineLabel = resolveRecorderEngineLabel(engine);
        const format = deliveryContainer === 'mp4'
            ? 'MP4'
            : (engine === RECORDER_ENGINE.NATIVE_WEBCODECS ? 'MP4' : 'WebM');
        showStatusToast(`Cinematic-Aufnahme: gestartet als ${format} via ${engineLabel} (F9 zum Stoppen)`, 2200, 'success');
    } else {
        showStatusToast('Cinematic-Aufnahme konnte nicht gestartet werden', 1800, 'error');
    }
    return result;
}

export function toggleCinematicRecordingFromHotkey({ game, getRuntimeHandle, showStatusToast }) {
    const recorder = getRuntimeHandle('mediaRecorderSystem');
    if (!recorder || typeof recorder.notifyLifecycleEvent !== 'function') return undefined;
    const support = recorder.getSupportState?.() || null;
    if (support && support.canRecord === false) {
        showStatusToast('Videoaufnahme nicht verfuegbar', 1600, 'error');
        return false;
    }
    const supportsDirectRecording = typeof recorder.startRecording === 'function'
        && typeof recorder.stopRecording === 'function';
    if (!supportsDirectRecording) {
        recorder.notifyLifecycleEvent(MATCH_LIFECYCLE_EVENT_TYPES.RECORDING_REQUESTED, { command: 'toggle' });
        return true;
    }
    const wasRecording = !!recorder.isRecording?.();
    const isCinematicRecording = wasRecording
        && isCinematicCaptureProfile(recorder.getRecordingCaptureSettings?.()?.profile);
    if (isCinematicRecording) {
        showStatusToast('Cinematic-Aufnahme: wird gespeichert...', 1200, 'info');
        recorder.stopRecording({ type: 'cinematic_manual_stop' }).then((result) => {
            if (result?.stopped) {
                const sizeMB = ((result.sizeBytes || 0) / (1024 * 1024)).toFixed(1);
                const masterContainerLabel = resolveContainerLabel(result?.masterContainer, result?.mimeType);
                const deliveryContainerLabel = resolveContainerLabel(
                    result?.deliveryContainer || result?.container,
                    result?.mimeType
                );
                const ext = deliveryContainerLabel;
                const recorderEngineLabel = resolveRecorderEngineLabel(
                    result?.recorderEngine || result?.recorderDiagnostics?.recorderEngine
                );
                const captureExportPreset = String(result?.captureExportPreset || '').toLowerCase();
                const degradedToMaster = captureExportPreset === RECORDING_EXPORT_PRESET.YOUTUBE_MP4
                    && result?.transcodeApplied !== true
                    && deliveryContainerLabel
                    && deliveryContainerLabel !== 'MP4';
                const targetArtifact = resolvePathTail(
                    result?.deliveryPath || result?.filePath || result?.masterPath
                );
                const baseDetails = degradedToMaster
                    ? `Engine: ${recorderEngineLabel} | Master: ${masterContainerLabel} (MP4-Delivery degradiert)`
                    : `Engine: ${recorderEngineLabel} | Master: ${masterContainerLabel} -> Delivery: ${deliveryContainerLabel}`;
                const detailSuffix = targetArtifact ? ` | Ziel: ${targetArtifact}` : '';
                if (degradedToMaster) {
                    showStatusToast(
                        `Cinematic ${ext} gespeichert (${sizeMB} MB) | ${baseDetails}${detailSuffix}`,
                        3600,
                        'info'
                    );
                    return;
                }
                showStatusToast(
                    `Cinematic ${ext} gespeichert (${sizeMB} MB) | ${baseDetails}${detailSuffix}`,
                    3400,
                    'success'
                );
            } else {
                showStatusToast('Cinematic-Aufnahme: Speichern fehlgeschlagen', 2000, 'error');
            }
        }).catch(() => showStatusToast('Cinematic-Aufnahme: Fehler beim Stoppen', 2000, 'error'));
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
        toggleCinematicRecordingFromHotkey() {
            return toggleCinematicRecordingFromHotkey({
                game: resolveGame(),
                getRuntimeHandle: resolveRuntimeHandle,
                showStatusToast: notifyStatusToast,
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
