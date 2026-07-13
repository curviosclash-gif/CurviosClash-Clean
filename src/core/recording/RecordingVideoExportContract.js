// @ts-nocheck
import {
    isCinematicCaptureProfile,
    normalizeRecordingExportPreset,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_EXPORT_PRESET,
} from '../../shared/contracts/RecordingCaptureContract.js';

export const RECORDING_EXPORT_RUNTIME_KINDS = Object.freeze({
    WEB: 'web',
    DESKTOP: 'desktop',
});

export const RECORDING_EXPORT_PROFILE_VARIANTS = Object.freeze({
    STANDARD: 'standard',
    CINEMATIC: 'cinematic',
});

export const RECORDING_EXPORT_CONTAINERS = Object.freeze({
    WEBM: 'webm',
    MP4: 'mp4',
    UNKNOWN: 'unknown',
});

export const RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION = 'recording-video-export-request.v1';

export const RECORDING_DESKTOP_SAVE_CAPABILITY_IDS = Object.freeze({
    VIDEO_EXPORT_SAVE: 'recording-video-export-save',
});

export const RECORDING_DESKTOP_SAVE_RESULT_CODES = Object.freeze({
    OK: 'RECORDING_SAVE_OK',
    OK_MASTER_FALLBACK: 'RECORDING_SAVE_OK_MASTER_FALLBACK',
    CANCELLED: 'RECORDING_SAVE_CANCELLED',
    INVALID_BYTES: 'RECORDING_SAVE_BYTES_INVALID',
    DIALOG_FAILED: 'RECORDING_SAVE_DIALOG_FAILED',
    TEMP_WRITE_FAILED: 'RECORDING_SAVE_TEMP_WRITE_FAILED',
    FINALIZE_FAILED: 'RECORDING_SAVE_FINALIZE_FAILED',
    NATIVE_TRANSCODE_FAILED: 'RECORDING_SAVE_NATIVE_TRANSCODE_FAILED',
});

const DELIVERY_CONTAINER_TARGETS = Object.freeze({
    MASTER: 'master',
});

function createExportMatrixEntry({
    runtimeKind,
    profileVariant,
    primarySaveTransport,
    saveCapabilityId,
    supportedContainers,
    tempFileStrategy,
    browserFallbackAllowed,
    defaultExportPreset = RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
    deliveryContainerByPreset = null,
}) {
    const containerList = Array.isArray(supportedContainers) && supportedContainers.length > 0
        ? supportedContainers
        : [RECORDING_EXPORT_CONTAINERS.WEBM];
    return Object.freeze({
        runtimeKind,
        profileVariant,
        primarySaveTransport,
        saveCapabilityId,
        supportedContainers: Object.freeze([...containerList]),
        tempFileStrategy,
        browserFallbackAllowed: browserFallbackAllowed === true,
        defaultMasterContainer: RECORDING_EXPORT_CONTAINERS.WEBM,
        defaultExportPreset: normalizeRecordingExportPreset(defaultExportPreset),
        supportedExportPresets: Object.freeze([
            RECORDING_EXPORT_PRESET.MASTER,
            RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
        ]),
        deliveryContainerByPreset: Object.freeze({
            [RECORDING_EXPORT_PRESET.MASTER]: DELIVERY_CONTAINER_TARGETS.MASTER,
            [RECORDING_EXPORT_PRESET.YOUTUBE_MP4]: RECORDING_EXPORT_CONTAINERS.MP4,
            ...(deliveryContainerByPreset && typeof deliveryContainerByPreset === 'object'
                ? deliveryContainerByPreset
                : {}),
        }),
    });
}

export const RECORDING_VIDEO_EXPORT_MATRIX = Object.freeze({
    [RECORDING_EXPORT_RUNTIME_KINDS.DESKTOP]: Object.freeze({
        [RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD]: createExportMatrixEntry({
            runtimeKind: RECORDING_EXPORT_RUNTIME_KINDS.DESKTOP,
            profileVariant: RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD,
            primarySaveTransport: 'desktop-save-capability',
            saveCapabilityId: RECORDING_DESKTOP_SAVE_CAPABILITY_IDS.VIDEO_EXPORT_SAVE,
            supportedContainers: [
                RECORDING_EXPORT_CONTAINERS.WEBM,
                RECORDING_EXPORT_CONTAINERS.MP4,
            ],
            tempFileStrategy: 'dialog-temp-copy-final',
            browserFallbackAllowed: false,
        }),
        [RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC]: createExportMatrixEntry({
            runtimeKind: RECORDING_EXPORT_RUNTIME_KINDS.DESKTOP,
            profileVariant: RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC,
            primarySaveTransport: 'desktop-save-capability',
            saveCapabilityId: RECORDING_DESKTOP_SAVE_CAPABILITY_IDS.VIDEO_EXPORT_SAVE,
            supportedContainers: [
                RECORDING_EXPORT_CONTAINERS.WEBM,
                RECORDING_EXPORT_CONTAINERS.MP4,
            ],
            tempFileStrategy: 'dialog-temp-copy-final',
            browserFallbackAllowed: false,
        }),
    }),
    [RECORDING_EXPORT_RUNTIME_KINDS.WEB]: Object.freeze({
        [RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD]: createExportMatrixEntry({
            runtimeKind: RECORDING_EXPORT_RUNTIME_KINDS.WEB,
            profileVariant: RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD,
            primarySaveTransport: 'browser-download',
            saveCapabilityId: '',
            supportedContainers: [
                RECORDING_EXPORT_CONTAINERS.WEBM,
                RECORDING_EXPORT_CONTAINERS.MP4,
            ],
            tempFileStrategy: 'none',
            browserFallbackAllowed: true,
        }),
        [RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC]: createExportMatrixEntry({
            runtimeKind: RECORDING_EXPORT_RUNTIME_KINDS.WEB,
            profileVariant: RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC,
            primarySaveTransport: 'browser-download',
            saveCapabilityId: '',
            supportedContainers: [
                RECORDING_EXPORT_CONTAINERS.WEBM,
                RECORDING_EXPORT_CONTAINERS.MP4,
            ],
            tempFileStrategy: 'none',
            browserFallbackAllowed: true,
        }),
    }),
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeFileToken(value, fallback = 'recording') {
    const normalized = normalizeString(value, fallback)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function normalizeRuntimeKind(value) {
    return normalizeString(value, RECORDING_EXPORT_RUNTIME_KINDS.WEB).toLowerCase() === RECORDING_EXPORT_RUNTIME_KINDS.DESKTOP
        ? RECORDING_EXPORT_RUNTIME_KINDS.DESKTOP
        : RECORDING_EXPORT_RUNTIME_KINDS.WEB;
}

function normalizeContainer(value, fallback = RECORDING_EXPORT_CONTAINERS.WEBM) {
    const normalized = normalizeString(value, fallback).toLowerCase();
    if (normalized === RECORDING_EXPORT_CONTAINERS.MP4) return RECORDING_EXPORT_CONTAINERS.MP4;
    if (normalized === RECORDING_EXPORT_CONTAINERS.WEBM) return RECORDING_EXPORT_CONTAINERS.WEBM;
    return fallback;
}

function resolvePreferredFileName(baseName, preferredExtension) {
    const normalizedBaseName = normalizeString(baseName, 'recording');
    const extension = normalizeContainer(preferredExtension, RECORDING_EXPORT_CONTAINERS.WEBM);
    const lastDotIndex = normalizedBaseName.lastIndexOf('.');
    const rawName = lastDotIndex > 0
        ? normalizedBaseName.slice(0, lastDotIndex)
        : normalizedBaseName;
    const normalizedName = normalizeFileToken(rawName, 'recording');
    return `${normalizedName}.${extension}`;
}

function resolveDeliveryContainerByPreset(matrixEntry, exportPreset, masterContainer) {
    const target = matrixEntry?.deliveryContainerByPreset?.[exportPreset];
    if (target === DELIVERY_CONTAINER_TARGETS.MASTER) {
        return masterContainer;
    }
    return normalizeContainer(target, masterContainer);
}

export function splitLogicalRecordingFileName(fileName = '') {
    const normalized = normalizeString(fileName, '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        return {
            logicalPath: '',
            logicalDirectoryName: '',
            baseName: '',
        };
    }
    return {
        logicalPath: parts.join('/'),
        logicalDirectoryName: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
        baseName: parts[parts.length - 1] || '',
    };
}

export function resolveRecordingExportProfileVariant(profile) {
    return isCinematicCaptureProfile(profile)
        ? RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC
        : RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD;
}

export function resolveRecordingExportContainerFromMimeType(
    mimeType,
    fallback = RECORDING_EXPORT_CONTAINERS.WEBM
) {
    const normalizedMimeType = normalizeString(mimeType).toLowerCase();
    if (normalizedMimeType.includes('mp4')) {
        return RECORDING_EXPORT_CONTAINERS.MP4;
    }
    if (normalizedMimeType.includes('webm')) {
        return RECORDING_EXPORT_CONTAINERS.WEBM;
    }
    return normalizeContainer(fallback, RECORDING_EXPORT_CONTAINERS.WEBM);
}

export function resolveRecordingExportMatrixEntry(options = {}) {
    const runtimeKind = normalizeRuntimeKind(options.runtimeKind);
    const profileVariant = resolveRecordingExportProfileVariant(options.captureProfile);
    const matrixEntry = RECORDING_VIDEO_EXPORT_MATRIX[runtimeKind]?.[profileVariant]
        || RECORDING_VIDEO_EXPORT_MATRIX[RECORDING_EXPORT_RUNTIME_KINDS.WEB][RECORDING_EXPORT_PROFILE_VARIANTS.STANDARD];
    const resolvedContainer = resolveRecordingExportContainerFromMimeType(
        options.mimeType,
        matrixEntry.defaultMasterContainer || RECORDING_EXPORT_CONTAINERS.WEBM
    );
    const preferredMasterContainer = normalizeContainer(
        options.masterContainer || options.container,
        resolvedContainer
    );
    const masterContainer = matrixEntry.supportedContainers.includes(preferredMasterContainer)
        ? preferredMasterContainer
        : resolvedContainer;
    const exportPreset = normalizeRecordingExportPreset(
        options.exportPreset,
        matrixEntry.defaultExportPreset
    );
    const deliveryContainerCandidate = resolveDeliveryContainerByPreset(
        matrixEntry,
        exportPreset,
        masterContainer
    );
    const deliveryContainer = matrixEntry.supportedContainers.includes(deliveryContainerCandidate)
        ? deliveryContainerCandidate
        : masterContainer;

    return Object.freeze({
        ...matrixEntry,
        runtimeKind,
        profileVariant,
        exportPreset,
        resolvedContainer: masterContainer,
        masterContainer,
        deliveryContainer,
        transcodeRequested: deliveryContainer !== masterContainer,
        preferredFileExtension: masterContainer,
    });
}

export function createRecordingVideoExportRequest(options = {}) {
    const runtimeKind = normalizeRuntimeKind(options.runtimeKind);
    const matrixEntry = resolveRecordingExportMatrixEntry({
        runtimeKind,
        captureProfile: options.captureProfile,
        mimeType: options.mimeType,
        exportPreset: options.exportPreset,
        masterContainer: options.masterContainer,
        container: options.container,
    });
    const logicalFileName = normalizeString(
        options.downloadFileName,
        normalizeString(options.fileName, 'recording')
    );
    const fileNameParts = splitLogicalRecordingFileName(logicalFileName);
    const fileName = resolvePreferredFileName(
        fileNameParts.baseName || normalizeString(options.fileName, 'recording'),
        matrixEntry.preferredFileExtension
    );

    return Object.freeze({
        contractVersion: RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION,
        capabilityId: matrixEntry.saveCapabilityId,
        fileName,
        logicalDirectoryName: fileNameParts.logicalDirectoryName || normalizeString(options.downloadDirectoryName),
        mimeType: normalizeString(options.mimeType, ''),
        captureProfile: normalizeString(options.captureProfile, RECORDING_CAPTURE_PROFILE.STANDARD),
        runtimeKind: matrixEntry.runtimeKind,
        profileVariant: matrixEntry.profileVariant,
        exportPreset: matrixEntry.exportPreset,
        container: matrixEntry.masterContainer,
        masterContainer: matrixEntry.masterContainer,
        deliveryContainer: matrixEntry.deliveryContainer,
        transcodeApplied: false,
        transcodeRequested: matrixEntry.transcodeRequested,
        surfaceClassification: normalizeString(options.surfaceClassification, ''),
        exportMatrix: Object.freeze({
            runtimeKind: matrixEntry.runtimeKind,
            profileVariant: matrixEntry.profileVariant,
            exportPreset: matrixEntry.exportPreset,
            defaultExportPreset: matrixEntry.defaultExportPreset,
            primarySaveTransport: matrixEntry.primarySaveTransport,
            tempFileStrategy: matrixEntry.tempFileStrategy,
            masterContainer: matrixEntry.masterContainer,
            deliveryContainer: matrixEntry.deliveryContainer,
            transcodeRequested: matrixEntry.transcodeRequested,
        }),
        videoBytes: options.videoBytes ?? null,
    });
}
