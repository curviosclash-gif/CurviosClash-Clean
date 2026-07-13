// @ts-nocheck
import { toFiniteNumber } from '../../utils/MathOps.js';
import { attemptAutoDownload, buildDownloadFileName } from './DownloadService.js';
import {
    DEFAULT_MIME_TYPE,
    RECORDER_ENGINE,
    sanitizeFileToken,
    toSafeDatePart,
} from './MediaRecorderSupport.js';
import { resolveRecordingExportContainerFromMimeType } from './RecordingVideoExportContract.js';

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
    const captureExportPreset = activeRecording?.captureExportPreset
        || system.recordingCaptureSettings?.exportPreset
        || null;
    const exportStatus = await attemptSystemAutoDownload(system, safeBlob, {
        fileName,
        downloadFileName,
        mimeType: resolvedMimeType,
        captureProfile: activeRecording?.captureProfile || system.recordingCaptureSettings?.profile || null,
        exportPreset: captureExportPreset,
        masterContainer: resolvedMasterContainer,
    });
    const resolvedMasterContainerFromStatus = exportStatus?.masterContainer || resolvedMasterContainer;
    const resolvedDeliveryContainer = exportStatus?.deliveryContainer
        || exportStatus?.container
        || resolvedMasterContainerFromStatus;
    const resolvedTranscodeApplied = exportStatus?.transcodeApplied === true;
    const resolvedMasterPath = exportStatus?.masterPath || exportStatus?.filePath || null;
    const resolvedDeliveryPath = exportStatus?.deliveryPath || exportStatus?.filePath || null;
    const resolvedWarnings = Array.isArray(exportStatus?.warnings)
        ? exportStatus.warnings.slice()
        : [];
    const resolvedFailureReason = String(
        exportStatus?.failureReason || exportStatus?.fallbackReason || ''
    ).trim() || null;
    const resolvedNativeTranscodeCapability = exportStatus?.nativeTranscodeCapability
        && typeof exportStatus.nativeTranscodeCapability === 'object'
        ? { ...exportStatus.nativeTranscodeCapability }
        : null;
    const resolvedTranscodeFailureCode = String(
        exportStatus?.transcodeFailureCode || ''
    ).trim() || null;

    if (system._lastExport?.objectUrl) {
        URL.revokeObjectURL(system._lastExport.objectUrl);
    }
    const objectUrl = safeBlob.size > 0 ? URL.createObjectURL(safeBlob) : null;
    system._lastExport = {
        blob: safeBlob,
        objectUrl,
        fileName,
        downloadFileName,
        filePath: resolvedDeliveryPath,
        mimeType: resolvedMimeType,
        container: resolvedDeliveryContainer,
        sizeBytes: safeBlob.size,
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        durationMs: timing.durationMs,
        trigger: activeRecording?.stopTrigger || activeRecording?.trigger || null,
        recorderEngine: resolvedRecorderEngine,
        captureProfile: activeRecording?.captureProfile || system.recordingCaptureSettings?.profile || null,
        hudMode: activeRecording?.hudMode || system.recordingCaptureSettings?.hudMode || null,
        captureExportPreset: captureExportPreset || null,
        masterContainer: resolvedMasterContainerFromStatus,
        deliveryContainer: resolvedDeliveryContainer,
        transcodeApplied: resolvedTranscodeApplied,
        nativeTranscodeCapability: resolvedNativeTranscodeCapability,
        transcodeFailureCode: resolvedTranscodeFailureCode,
        masterPath: resolvedMasterPath,
        deliveryPath: resolvedDeliveryPath,
        warnings: resolvedWarnings,
        failureReason: resolvedFailureReason,
        saveCapabilityId: exportStatus?.saveCapabilityId || null,
        saveCode: exportStatus?.saveCode || null,
        exportMatrix: exportStatus?.exportMatrix
            ? { ...exportStatus.exportMatrix }
            : null,
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
        exportStatus: { ...exportStatus },
    };

    const resolve = activeRecording?.stopResolve;
    system._cleanupRuntimeRecorder();
    const result = system._buildStopResult(true, 'stopped', {
        fileName,
        downloadFileName,
        filePath: resolvedDeliveryPath,
        mimeType: resolvedMimeType,
        container: resolvedDeliveryContainer,
        recorderEngine: resolvedRecorderEngine,
        masterContainer: resolvedMasterContainerFromStatus,
        deliveryContainer: resolvedDeliveryContainer,
        transcodeApplied: resolvedTranscodeApplied,
        nativeTranscodeCapability: resolvedNativeTranscodeCapability,
        transcodeFailureCode: resolvedTranscodeFailureCode,
        masterPath: resolvedMasterPath,
        deliveryPath: resolvedDeliveryPath,
        warnings: resolvedWarnings,
        failureReason: resolvedFailureReason,
        sizeBytes: safeBlob.size,
        exportTransport: exportStatus.transport,
        exportStatus: { ...exportStatus },
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        durationMs: timing.durationMs,
        captureProfile: system._lastExport.captureProfile,
        hudMode: system._lastExport.hudMode,
        captureExportPreset: system._lastExport.captureExportPreset,
        saveCapabilityId: system._lastExport.saveCapabilityId || null,
        saveCode: system._lastExport.saveCode || null,
        exportMatrix: system._lastExport.exportMatrix
            ? { ...system._lastExport.exportMatrix }
            : null,
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
    });
    if (typeof resolve === 'function') {
        resolve(result);
    }
    system._pendingStop = null;
    return result;
}
