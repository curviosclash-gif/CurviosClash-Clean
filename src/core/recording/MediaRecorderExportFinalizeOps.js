// @ts-nocheck
import { toFiniteNumber } from '../../shared/utils/MathOps.js';
import { attemptAutoDownload, buildDownloadFileName } from './DownloadService.js';
import {
    DEFAULT_FALLBACK_MIME_TYPE,
    DEFAULT_MIME_TYPE,
    RECORDER_ENGINE,
    sanitizeFileToken,
    toSafeDatePart,
} from './MediaRecorderSupport.js';
import { resolveRecordingExportContainerFromMimeType } from './RecordingVideoExportContract.js';

// The desktop save answers only after the native save dialog closed and an optional
// ffmpeg transcode ran. Nobody answers that dialog during automation, so a stop waits
// at most this long and lets the save settle in the background.
export const DEFAULT_EXPORT_WAIT_TIMEOUT_MS = 10_000;
export const RECORDING_EXPORT_PENDING_STATUS = 'export_pending';

export function attachDirectMediaRecorderStopHandler(system) {
    const recorder = system?._mediaRecorder;
    if (!recorder) return false;
    const handleStop = () => {
        const mimeType = system._mediaRecorder?.mimeType
            || system._mediaRecorderChunks?.[0]?.type
            || system._activeMimeType
            || DEFAULT_FALLBACK_MIME_TYPE;
        const blob = new Blob(system._mediaRecorderChunks || [], { type: mimeType });
        system._mediaRecorderChunks = null;
        system.logger?.info?.(
            `[MediaRecorderSystem] MediaRecorder direct stop: chunks collected, blob.size=${blob.size}, mimeType=${mimeType}`
        );
        system._finalizeBlobExport(blob, mimeType).catch((error) => {
            system.logger?.warn?.('[MediaRecorderSystem] direct stop finalize failed', error);
            const resolve = system._activeRecording?.stopResolve;
            system._cleanupRuntimeRecorder();
            system._pendingStop = null;
            if (typeof resolve === 'function') {
                resolve(system._buildStopResult(false, 'export_failed', { error }));
            }
        });
    };
    if (typeof recorder.addEventListener === 'function') {
        recorder.addEventListener('stop', handleStop, { once: true });
    } else {
        const previousOnStop = recorder.onstop;
        recorder.onstop = (...args) => {
            recorder.onstop = previousOnStop || null;
            if (typeof previousOnStop === 'function') previousOnStop.apply(recorder, args);
            handleStop();
        };
    }
    return true;
}

function buildFilename(system, activeRecording, endedAtMs, mimeType) {
    const startedAt = activeRecording?.startedAt || endedAtMs;
    const mode = sanitizeFileToken(activeRecording?.trigger?.context?.activeGameMode, 'classic');
    const profile = sanitizeFileToken(activeRecording?.captureProfile || system.recordingCaptureSettings?.profile, 'standard');
    const matchId = sanitizeFileToken(activeRecording?.trigger?.context?.sessionId, 'session');
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    const ext = normalizedMimeType.includes('webm')
        ? 'webm'
        : (normalizedMimeType.includes('mp4') ? 'mp4' : 'video');
    return `${system.filePrefix}-${mode}-${profile}-${matchId}-${toSafeDatePart(startedAt)}-${toSafeDatePart(endedAtMs)}.${ext}`;
}

function estimateCapturedDurationMs(system, frameIntervalStats = null) {
    const sampleCount = Math.max(0, Math.trunc(toFiniteNumber(frameIntervalStats?.sampleCount, 0)));
    const meanMs = Math.max(0, toFiniteNumber(frameIntervalStats?.mean, 0));
    if (sampleCount > 0 && meanMs > 0) {
        return sampleCount * meanMs;
    }
    return Math.max(0, Math.round(system._captureTimestampUs / 1000));
}

function normalizeExportTiming(system, activeRecording, endedAtMs, frameIntervalStats = null) {
    const rawEndedAt = toFiniteNumber(endedAtMs, system.now());
    const estimatedDurationMs = estimateCapturedDurationMs(system, frameIntervalStats);
    let startedAt = toFiniteNumber(activeRecording?.startedAt, rawEndedAt);
    let endedAt = rawEndedAt;
    let adjusted = false;
    if (!(startedAt > 0)) {
        startedAt = Math.max(0, rawEndedAt - estimatedDurationMs);
        adjusted = true;
    }
    if (!(endedAt >= startedAt)) {
        endedAt = startedAt + Math.max(1, estimatedDurationMs);
        adjusted = true;
    }
    return {
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        adjusted,
        estimatedDurationMs,
    };
}

async function attemptSystemAutoDownload(
    system,
    blob,
    {
        fileName,
        downloadFileName = fileName,
        mimeType,
        captureProfile = null,
        exportPreset = null,
        masterContainer = null,
    } = {}
) {
    return attemptAutoDownload({
        blob,
        fileName: downloadFileName || fileName,
        mimeType,
        captureProfile,
        exportPreset,
        masterContainer,
        autoDownload: system.autoDownload,
        downloadHandler: system.downloadHandler,
        logger: system.logger,
        runtimeGlobal: system._globalScope,
    });
}

function resolveExportWaitTimeoutMs(system) {
    const configured = toFiniteNumber(system?.exportWaitTimeoutMs, DEFAULT_EXPORT_WAIT_TIMEOUT_MS);
    return configured > 0 ? configured : DEFAULT_EXPORT_WAIT_TIMEOUT_MS;
}

/** Resolves with the export status, or with null once the wait timed out. */
function waitForExportStatus(system, exportPromise, timeoutMs) {
    const timerScope = typeof system._globalScope?.setTimeout === 'function' ? system._globalScope : globalThis;
    return new Promise((resolve, reject) => {
        const timeoutHandle = timerScope.setTimeout(() => resolve(null), timeoutMs);
        exportPromise.then((status) => {
            timerScope.clearTimeout?.(timeoutHandle);
            resolve(status);
        }, (error) => {
            timerScope.clearTimeout?.(timeoutHandle);
            reject(error);
        });
    });
}

function createPendingExportStatus(masterContainer, timeoutMs) {
    return {
        requested: true,
        transport: 'pending',
        status: RECORDING_EXPORT_PENDING_STATUS,
        fallbackReason: null,
        failureReason: null,
        apiStatus: null,
        message: 'Aufnahme ist beendet; Speichern (Dialog oder Umwandlung) läuft noch.',
        warnings: [`export_wait_timeout_${timeoutMs}ms`],
        filePath: null,
        container: masterContainer || null,
        masterContainer: masterContainer || null,
        deliveryContainer: masterContainer || null,
        transcodeApplied: false,
        masterPath: null,
        deliveryPath: null,
        saveCapabilityId: null,
        saveCode: null,
        exportMatrix: null,
        nativeTranscodeCapability: null,
        transcodeFailureCode: null,
    };
}

function resolveExportStatusFields(exportStatus, fallbackMasterContainer) {
    const masterContainer = exportStatus?.masterContainer || fallbackMasterContainer;
    const deliveryContainer = exportStatus?.deliveryContainer
        || exportStatus?.container
        || masterContainer;
    const deliveryPath = exportStatus?.deliveryPath || exportStatus?.filePath || null;
    return {
        filePath: deliveryPath,
        container: deliveryContainer,
        masterContainer,
        deliveryContainer,
        transcodeApplied: exportStatus?.transcodeApplied === true,
        nativeTranscodeCapability: exportStatus?.nativeTranscodeCapability
            && typeof exportStatus.nativeTranscodeCapability === 'object'
            ? { ...exportStatus.nativeTranscodeCapability }
            : null,
        transcodeFailureCode: String(exportStatus?.transcodeFailureCode || '').trim() || null,
        masterPath: exportStatus?.masterPath || exportStatus?.filePath || null,
        deliveryPath,
        warnings: Array.isArray(exportStatus?.warnings) ? exportStatus.warnings.slice() : [],
        failureReason: String(exportStatus?.failureReason || exportStatus?.fallbackReason || '').trim() || null,
        saveCapabilityId: exportStatus?.saveCapabilityId || null,
        saveCode: exportStatus?.saveCode || null,
        exportMatrix: exportStatus?.exportMatrix ? { ...exportStatus.exportMatrix } : null,
        exportStatus: { ...exportStatus },
    };
}

function settleLateExport(system, exportRecord, exportPromise) {
    const apply = (lateStatus) => {
        // A disposed recorder or a newer export owns the state now.
        if (system._lastExport !== exportRecord) return;
        Object.assign(exportRecord, resolveExportStatusFields(lateStatus, exportRecord.masterContainer));
        system.logger?.info?.(
            `[MediaRecorderSystem] recording export settled after stop: status=${lateStatus?.status}, filePath=${exportRecord.filePath}`
        );
    };
    exportPromise.then(apply, (error) => {
        system.logger?.warn?.('[MediaRecorderSystem] recording export failed after stop', error);
        apply({
            requested: true,
            transport: 'failed',
            status: 'export_failed',
            failureReason: 'export_failed',
            message: String(error?.message || error || 'export_failed'),
        });
    });
}

export async function finalizeMediaRecorderBlobExport(system, blob, mimeType = DEFAULT_MIME_TYPE) {
    const activeRecording = system._activeRecording || null;
    // Silent switch-stop (for example switching from auto-recording to cinematic) - discard blob, no download.
    const stopType = activeRecording?.stopTrigger?.type;
    if (stopType === 'cinematic_switch_stop') {
        const resolve = activeRecording?.stopResolve;
        system._cleanupRuntimeRecorder();
        const result = system._buildStopResult(true, 'discarded_for_switch');
        if (typeof resolve === 'function') {
            resolve(result);
        }
        system._pendingStop = null;
        return result;
    }

    const safeBlob = blob instanceof Blob ? blob : new Blob([], { type: String(mimeType || DEFAULT_MIME_TYPE) });
    system.logger?.info?.(
        `[MediaRecorderSystem] _finalizeBlobExport: blob.size=${safeBlob.size}, frameCount=${system._frameCount}, autoDownload=${system.autoDownload}`
    );
    const resolvedMimeType = String(mimeType || safeBlob.type || system._activeMimeType || DEFAULT_MIME_TYPE);
    const resolvedMasterContainer = resolveRecordingExportContainerFromMimeType(
        resolvedMimeType
    );
    const frameIntervalStats = system._getFrameIntervalStats(true) || system._lastFrameIntervalStats;
    const timing = normalizeExportTiming(system, activeRecording, system.now(), frameIntervalStats);
    const fileName = buildFilename(
        system,
        activeRecording
            ? { ...activeRecording, startedAt: timing.startedAt }
            : { startedAt: timing.startedAt },
        timing.endedAt,
        resolvedMimeType
    );
    const downloadFileName = buildDownloadFileName(system.downloadDirectoryName, fileName);
    const recorderDiagnostics = system.getRecordingDiagnostics();
    const resolvedRecorderEngine = String(
        recorderDiagnostics?.recorderEngine || system._activeRecorderEngine || RECORDER_ENGINE.NONE
    ).trim() || RECORDER_ENGINE.NONE;
    const captureProfile = activeRecording?.captureProfile || system.recordingCaptureSettings?.profile || null;
    const captureExportPreset = activeRecording?.captureExportPreset
        || system.recordingCaptureSettings?.exportPreset
        || null;
    const exportPromise = attemptSystemAutoDownload(system, safeBlob, {
        fileName,
        downloadFileName,
        mimeType: resolvedMimeType,
        captureProfile,
        exportPreset: captureExportPreset,
        masterContainer: resolvedMasterContainer,
    });
    const exportWaitTimeoutMs = resolveExportWaitTimeoutMs(system);
    const settledExportStatus = await waitForExportStatus(system, exportPromise, exportWaitTimeoutMs);
    const exportPending = settledExportStatus === null;
    if (exportPending) {
        system.logger?.warn?.(
            `[MediaRecorderSystem] recording export still open after ${exportWaitTimeoutMs}ms; stop resolves, save continues`
        );
    }
    const exportStatus = settledExportStatus
        || createPendingExportStatus(resolvedMasterContainer, exportWaitTimeoutMs);
    const exportFields = resolveExportStatusFields(exportStatus, resolvedMasterContainer);

    if (system._lastExport?.objectUrl) {
        URL.revokeObjectURL(system._lastExport.objectUrl);
    }
    const objectUrl = safeBlob.size > 0 ? URL.createObjectURL(safeBlob) : null;
    const exportSummary = {
        fileName,
        downloadFileName,
        mimeType: resolvedMimeType,
        sizeBytes: safeBlob.size,
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        durationMs: timing.durationMs,
        recorderEngine: resolvedRecorderEngine,
        captureProfile,
        hudMode: activeRecording?.hudMode || system.recordingCaptureSettings?.hudMode || null,
        captureExportPreset,
        frameIntervalStats: frameIntervalStats
            ? { ...frameIntervalStats }
            : null,
        recorderDiagnostics: recorderDiagnostics
            ? { ...recorderDiagnostics }
            : null,
        timestampValidation: {
            adjusted: timing.adjusted,
            estimatedDurationMs: timing.estimatedDurationMs,
        },
    };
    const exportRecord = {
        ...exportSummary,
        ...exportFields,
        blob: safeBlob,
        objectUrl,
        trigger: activeRecording?.stopTrigger || activeRecording?.trigger || null,
    };
    system._lastExport = exportRecord;

    const resolve = activeRecording?.stopResolve;
    system._cleanupRuntimeRecorder();
    const result = system._buildStopResult(true, exportPending ? RECORDING_EXPORT_PENDING_STATUS : 'stopped', {
        ...exportSummary,
        ...exportFields,
        exportTransport: exportStatus.transport,
    });
    if (typeof resolve === 'function') {
        resolve(result);
    }
    system._pendingStop = null;
    if (exportPending) {
        settleLateExport(system, exportRecord, exportPromise);
    }
    return result;
}
