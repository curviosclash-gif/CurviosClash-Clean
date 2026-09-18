import { EDITOR_API_ROUTES } from '../../shared/contracts/EditorPathContract.js';
import { resolveArtifactVersionState } from '../../shared/contracts/ArtifactVersionMigrationContract.js';
import { PLATFORM_CAPABILITY_IDS } from '../../shared/contracts/PlatformCapabilityContract.js';
import { PLATFORM_PRODUCT_SURFACE_IDS, resolveSurfaceCapabilityAccess } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS, PLATFORM_SURFACE_FEATURE_IDS, resolveSurfaceBlockedFeatureFeedback, resolveSurfaceFeatureClassification } from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import { createBrowserSaveAdapter } from '../../platform/browser/BrowserPlatformAdapters.js';
import {
    createElectronPreloadSaveAdapter,
    resolveElectronRuntimeSnapshot,
} from '../../platform/electron/ElectronPlatformBridge.js';
import { createRecordingVideoExportRequest, RECORDING_DESKTOP_SAVE_CAPABILITY_IDS } from './RecordingVideoExportContract.js';

const DESKTOP_SAVE_VERSION_FIELDS = Object.freeze(['contractVersion']);
const DESKTOP_SAVE_SUPPORTED_VERSIONS = Object.freeze(['preload.save.v1', 'preload.save.v2']);
const DESKTOP_SAVE_CURRENT_VERSION = 'preload.save.v2';

function dedupeWarnings(warnings) {
    const unique = [];
    const seen = new Set();
    for (const warning of Array.isArray(warnings) ? warnings : []) {
        const normalized = typeof warning === 'string' ? warning.trim() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}

function createDownloadStatus({
    requested,
    transport,
    status,
    fallbackReason = null,
    failureReason = null,
    apiStatus = null,
    message = '',
    warnings = [],
    surfaceClassification = '',
    filePath = null,
    container = '',
    masterContainer = '',
    deliveryContainer = '',
    transcodeApplied = false,
    masterPath = null,
    deliveryPath = null,
    saveCapabilityId = '',
    saveCode = '',
    exportMatrix = null,
    nativeTranscodeCapability = null,
    transcodeFailureCode = null,
}) {
    const resolvedMasterContainer = String(masterContainer || container || '').trim();
    const resolvedDeliveryContainer = String(deliveryContainer || container || masterContainer || '').trim();
    const resolvedDeliveryPath = deliveryPath ? String(deliveryPath) : (filePath ? String(filePath) : null);
    const resolvedMasterPath = masterPath
        ? String(masterPath)
        : (resolvedDeliveryPath && transcodeApplied !== true ? resolvedDeliveryPath : null);
    return {
        requested: requested === true,
        transport: String(transport || ''),
        status: String(status || ''),
        fallbackReason: fallbackReason ? String(fallbackReason) : null,
        failureReason: failureReason ? String(failureReason) : null,
        apiStatus: Number.isFinite(Number(apiStatus)) ? Number(apiStatus) : null,
        message: String(message || '').trim(),
        warnings: dedupeWarnings(warnings),
        surfaceClassification: String(surfaceClassification || '').trim(),
        filePath: resolvedDeliveryPath,
        container: resolvedDeliveryContainer || null,
        masterContainer: resolvedMasterContainer || null,
        deliveryContainer: resolvedDeliveryContainer || null,
        transcodeApplied: transcodeApplied === true,
        masterPath: resolvedMasterPath,
        deliveryPath: resolvedDeliveryPath,
        saveCapabilityId: String(saveCapabilityId || '').trim() || null,
        saveCode: String(saveCode || '').trim() || null,
        exportMatrix: exportMatrix && typeof exportMatrix === 'object' ? { ...exportMatrix } : null,
        nativeTranscodeCapability: nativeTranscodeCapability && typeof nativeTranscodeCapability === 'object' ? { ...nativeTranscodeCapability } : null,
        transcodeFailureCode: String(transcodeFailureCode || '').trim() || null,
    };
}

function resolveRecordingVideoExportInvoker(desktopSaveAdapter) {
    if (typeof desktopSaveAdapter?.saveRecordingVideoExport === 'function') {
        return {
            kind: 'named',
            invoke: desktopSaveAdapter.saveRecordingVideoExport,
        };
    }
    if (typeof desktopSaveAdapter?.saveVideo === 'function') {
        return {
            kind: 'legacy',
            invoke: ({ videoBytes, fileName, mimeType }) => desktopSaveAdapter.saveVideo(videoBytes, fileName, mimeType),
        };
    }
    return {
        kind: 'unavailable',
        invoke: null,
    };
}

function resolveDesktopSaveContractState(adapter) {
    return resolveArtifactVersionState(adapter && typeof adapter === 'object' ? adapter : {}, {
        artifactType: 'desktop-save-adapter',
        versionFields: DESKTOP_SAVE_VERSION_FIELDS,
        supportedVersions: DESKTOP_SAVE_SUPPORTED_VERSIONS,
        currentVersion: DESKTOP_SAVE_CURRENT_VERSION,
        allowMissingVersion: true,
    });
}

function isSupportedDesktopSaveAdapterContract(adapter) {
    const versionState = resolveDesktopSaveContractState(adapter);
    const hasExplicitContractVersion = !!adapter
        && typeof adapter === 'object'
        && Object.prototype.hasOwnProperty.call(adapter, 'contractVersion');
    if (!hasExplicitContractVersion) {
        return true;
    }
    return !versionState.shouldReject && versionState.resolvedVersion !== null;
}

/**
 * Triggers a browser anchor-click download for the given Blob.
 * @param {{ blob: Blob, fileName: string, globalScope?: typeof globalThis }} params
 */
export function defaultDownload({ blob, fileName, globalScope = globalThis }) {
    const doc = globalScope?.document ?? null;
    const urlApi = globalScope?.URL ?? globalThis.URL;
    if (!doc || !blob || !fileName || typeof urlApi?.createObjectURL !== 'function') return;
    const anchor = doc.createElement?.('a');
    if (!anchor || typeof anchor.click !== 'function') return;
    const body = doc.body;
    if (!body || typeof body.appendChild !== 'function') return;
    const url = urlApi.createObjectURL(blob);
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    globalScope?.setTimeout?.(() => {
        if (typeof urlApi?.revokeObjectURL === 'function') {
            urlApi.revokeObjectURL(url);
        }
    }, 0);
}

/**
 * Prepends the directory name to the file name when present.
 * @param {string} downloadDirectoryName
 * @param {string} fileName
 * @returns {string}
 */
export function buildDownloadFileName(downloadDirectoryName, fileName) {
    const baseName = String(fileName || '').trim();
    if (!baseName) return baseName;
    if (!downloadDirectoryName) return baseName;
    return `${downloadDirectoryName}/${baseName}`;
}

/**
 * Attempts to save the blob: tries the editor API first, falls back to a browser download.
 * @param {{
 *   blob: Blob,
 *   fileName: string,
 *   mimeType: string,
 *   captureProfile?: string,
 *   exportPreset?: string,
 *   masterContainer?: string,
 *   autoDownload: boolean,
 *   downloadHandler: function,
 *   logger: object
 * }} params
 * @returns {Promise<{requested: boolean, transport: string, status: string, fallbackReason: string|null, apiStatus: number|null, masterContainer?: string, deliveryContainer?: string, container?: string, transcodeApplied?: boolean, masterPath?: string, filePath?: string, deliveryPath?: string, warnings?: string[], failureReason?: string, nativeTranscodeCapability?: any, transcodeFailureCode?: string, saveCapabilityId?: string, saveCode?: string, exportMatrix?: any}>}
 */
export async function attemptAutoDownload({
    blob,
    fileName,
    mimeType,
    captureProfile = null,
    exportPreset = null,
    masterContainer = null,
    autoDownload,
    downloadHandler,
    logger,
}) {
    const platformRuntimeSnapshot = resolveElectronRuntimeSnapshot(globalThis);
    const videoFeatureClassification = resolveSurfaceFeatureClassification(
        PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT,
        { runtimeGlobal: globalThis, platformRuntimeSnapshot }
    );
    const safeFileName = String(fileName || '').trim();
    const browserFileName = safeFileName.replace(/\\/g, '/').split('/').filter(Boolean).pop() || safeFileName;
    const desktopSaveAdapter = createElectronPreloadSaveAdapter(globalThis);
    const saveRequest = createRecordingVideoExportRequest({
        runtimeKind: desktopSaveAdapter.isAvailable() ? 'desktop' : 'web',
        fileName: safeFileName,
        mimeType,
        captureProfile,
        exportPreset,
        masterContainer,
        surfaceClassification: videoFeatureClassification.classification,
        videoBytes: null,
    });
    const requestMasterContainer = saveRequest.masterContainer || saveRequest.container || null;
    const requestDeliveryContainer = saveRequest.deliveryContainer || requestMasterContainer;
    const requestTranscodeRequested = saveRequest.transcodeRequested === true;
    const resolveResultContainers = (result = null) => {
        const resolvedMasterContainer = String(
            result?.masterContainer || requestMasterContainer || ''
        ).trim() || null;
        const resolvedDeliveryContainer = String(
            result?.deliveryContainer
            || result?.container
            || requestDeliveryContainer
            || resolvedMasterContainer
            || ''
        ).trim() || null;
        const transcodeApplied = result?.transcodeApplied === true;
        const resolvedDeliveryPath = result?.deliveryPath || result?.filePath || null;
        const resolvedMasterPath = result?.masterPath
            || (transcodeApplied ? null : resolvedDeliveryPath)
            || null;
        return {
            masterContainer: resolvedMasterContainer,
            deliveryContainer: resolvedDeliveryContainer,
            transcodeApplied,
            masterPath: resolvedMasterPath,
            deliveryPath: resolvedDeliveryPath,
        };
    };
    if (!autoDownload || !blob || blob.size <= 0) {
        const containers = resolveResultContainers();
        return createDownloadStatus({
            requested: false,
            transport: 'disabled',
            status: 'not_requested',
            message: 'Recording-Export wurde nicht angefordert.',
            surfaceClassification: videoFeatureClassification.classification,
            masterContainer: containers.masterContainer,
            deliveryContainer: containers.deliveryContainer,
            transcodeApplied: containers.transcodeApplied,
            masterPath: containers.masterPath,
            deliveryPath: containers.deliveryPath,
            exportMatrix: saveRequest.exportMatrix,
        });
    }
    const isBrowserDemoSurface = videoFeatureClassification.productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
    const browserVideoFallbackAllowed = !isBrowserDemoSurface
        || videoFeatureClassification.classification === PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DEMO_SAFE;
    if (!desktopSaveAdapter.isAvailable() && !browserVideoFallbackAllowed) {
        const blockedFeatureFeedback = resolveSurfaceBlockedFeatureFeedback('Video-Export', {
            runtimeGlobal: globalThis,
            platformRuntimeSnapshot,
        });
        const containers = resolveResultContainers();
        return createDownloadStatus({
            requested: true,
            transport: 'blocked',
            status: 'surface_policy_blocked',
            fallbackReason: 'surface-policy',
            failureReason: 'surface-policy',
            message: blockedFeatureFeedback.message,
            warnings: [
                'Video-Export bleibt für diese Surface ein future opt-in; Browser- und Disk-Fallbacks bleiben bis zu einem echten Demo-Mehrwert deaktiviert.',
            ],
            surfaceClassification: videoFeatureClassification.classification,
            masterContainer: containers.masterContainer,
            deliveryContainer: containers.deliveryContainer,
            transcodeApplied: containers.transcodeApplied,
            masterPath: containers.masterPath,
            deliveryPath: containers.deliveryPath,
            exportMatrix: saveRequest.exportMatrix,
        });
    }
    const saveSurfaceCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.SAVE, {
        runtimeGlobal: globalThis,
        platformRuntimeSnapshot,
    });
    const fileIoFeatureClassification = resolveSurfaceFeatureClassification(
        PLATFORM_SURFACE_FEATURE_IDS.FILE_IO,
        { runtimeGlobal: globalThis, platformRuntimeSnapshot }
    );
    const desktopSaveAdapterVersionSupported = isSupportedDesktopSaveAdapterContract(desktopSaveAdapter);
    const recordingVideoExportInvoker = resolveRecordingVideoExportInvoker(desktopSaveAdapter);
    const browserSaveAdapter = createBrowserSaveAdapter({
        saveVideo: saveSurfaceCapability.available === true
            && browserVideoFallbackAllowed
            ? (payload, downloadFileName, resolvedMimeType) => {
                if (typeof downloadHandler !== 'function') {
                    return {
                        saved: false,
                        error: new Error('download_handler_unavailable'),
                    };
                }
                const blobPayload = payload instanceof Blob
                    ? payload
                    : new Blob([payload], { type: resolvedMimeType || mimeType || 'application/octet-stream' });
                downloadHandler({ blob: blobPayload, fileName: downloadFileName, mimeType: resolvedMimeType || mimeType });
                return {
                    saved: true,
                    transport: 'download',
                };
            }
            : null,
    });
    const statusWarnings = [];
    const pushStatusWarning = (message) => {
        const normalized = typeof message === 'string' ? message.trim() : '';
        if (!normalized || statusWarnings.includes(normalized)) return;
        statusWarnings.push(normalized);
    };
    const withTranscodeDegradationWarning = (warnings, transcodeApplied = false) => {
        if (!requestTranscodeRequested || transcodeApplied === true) {
            return warnings;
        }
        return [
            ...warnings,
            'Export-Preset youtube-mp4 ist aktiv; Delivery wurde auf den Master-Container degradiert.',
        ];
    };
    if (fileIoFeatureClassification.classification === PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY && !desktopSaveAdapter.isAvailable()) {
        pushStatusWarning('Dateioperationen bleiben desktop-only; ohne Desktop-Speicheradapter wird ein degradiertes Fallback genutzt.');
    }
    const downloadViaBrowser = async (reason, error = null) => {
        if (saveSurfaceCapability.available !== true) {
            return false;
        }
        if (typeof browserSaveAdapter.saveVideo !== 'function') {
            pushStatusWarning('Browser-Download-Handler ist nicht verfügbar; Download-Fallback wurde übersprungen.');
            if (error) {
                logger?.warn?.(`[DownloadService] recording export fallback unavailable (${reason})`, error);
            }
            return false;
        }
        if (error) {
            logger?.warn?.(`[DownloadService] recording export fallback (${reason})`, error);
        }
        const result = await browserSaveAdapter.saveVideo(blob, browserFileName, mimeType);
        if (result?.saved === true) {
            return true;
        }
        logger?.warn?.('[DownloadService] recording export browser download failed', result?.error || null);
        return false;
    };
    if (desktopSaveAdapter.isAvailable() && !desktopSaveAdapterVersionSupported) {
        logger?.warn?.('[DownloadService] recording export desktop save skipped due to unsupported adapter contractVersion', desktopSaveAdapter?.contractVersion || null);
        pushStatusWarning('Desktop-Speicheradapter ist veraltet oder inkompatibel; Browser-/API-Fallback wird verwendet.');
    }
    if (
        desktopSaveAdapterVersionSupported
        && desktopSaveAdapter.isAvailable()
        && typeof recordingVideoExportInvoker.invoke === 'function'
        && typeof blob.arrayBuffer === 'function'
    ) {
        try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const appResult = await recordingVideoExportInvoker.invoke({
                ...saveRequest,
                videoBytes: bytes,
            });
            if (appResult?.saved === true) {
                logger?.info?.('[DownloadService] recording export saved via electron app', browserFileName);
                const containers = resolveResultContainers(appResult);
                const appWarnings = withTranscodeDegradationWarning(
                    [
                        ...statusWarnings,
                        ...(Array.isArray(appResult?.warnings) ? appResult.warnings : []),
                    ],
                    containers.transcodeApplied
                );
                return createDownloadStatus({
                    requested: true,
                    transport: 'app',
                    status: 'saved_via_app',
                    message: 'Recording wurde direkt über die Desktop-App gespeichert.',
                    warnings: appWarnings,
                    surfaceClassification: videoFeatureClassification.classification,
                    filePath: containers.deliveryPath,
                    container: containers.deliveryContainer,
                    masterContainer: containers.masterContainer,
                    deliveryContainer: containers.deliveryContainer,
                    transcodeApplied: containers.transcodeApplied,
                    masterPath: containers.masterPath,
                    deliveryPath: containers.deliveryPath,
                    saveCapabilityId: appResult.capabilityId
                        || saveRequest.capabilityId
                        || RECORDING_DESKTOP_SAVE_CAPABILITY_IDS.VIDEO_EXPORT_SAVE,
                    saveCode: appResult.code || '',
                    failureReason: appResult.failureReason || '',
                    exportMatrix: saveRequest.exportMatrix,
                    nativeTranscodeCapability: appResult.nativeTranscodeCapability || null,
                    transcodeFailureCode: appResult.transcodeFailureCode || null,
                });
            }
            const desktopCancelled = appResult?.cancelled === true
                || appResult?.code === 'RECORDING_SAVE_CANCELLED';
            if (appResult?.code) {
                pushStatusWarning(`Desktop-Speicheradapter meldete ${appResult.code}.`);
            }
            if (desktopCancelled || saveRequest.browserFallbackAllowed !== true) {
                const containers = resolveResultContainers(appResult);
                return createDownloadStatus({
                    requested: true,
                    transport: 'app',
                    status: desktopCancelled ? 'cancelled' : 'desktop_save_failed',
                    fallbackReason: desktopCancelled ? 'cancelled' : 'desktop-save-failed',
                    failureReason: desktopCancelled ? 'cancelled' : (appResult?.failureReason || 'desktop-save-failed'),
                    message: desktopCancelled
                        ? 'Speicherdialog wurde abgebrochen; es wurde kein Fallback gestartet.'
                        : 'Desktop-Speichern ist fehlgeschlagen; Browser-Fallback ist für dieses Profil nicht erlaubt.',
                    warnings: [
                        ...statusWarnings,
                        ...(Array.isArray(appResult?.warnings) ? appResult.warnings : []),
                    ],
                    surfaceClassification: videoFeatureClassification.classification,
                    container: containers.deliveryContainer,
                    masterContainer: containers.masterContainer,
                    deliveryContainer: containers.deliveryContainer,
                    transcodeApplied: containers.transcodeApplied,
                    masterPath: containers.masterPath,
                    deliveryPath: containers.deliveryPath,
                    saveCapabilityId: appResult?.capabilityId || saveRequest.capabilityId || null,
                    saveCode: appResult?.code || '',
                    exportMatrix: saveRequest.exportMatrix,
                });
            }
            if (appResult?.code) {
                pushStatusWarning(`Desktop-Speicheradapter meldete ${appResult.code}.`);
            }
        } catch (error) {
            logger?.warn?.('[DownloadService] recording export app save failed', error);
            if (saveRequest.browserFallbackAllowed !== true) {
                const containers = resolveResultContainers();
                return createDownloadStatus({
                    requested: true,
                    transport: 'app',
                    status: 'desktop_save_failed',
                    fallbackReason: 'desktop-save-failed',
                    failureReason: 'desktop-save-failed',
                    message: 'Desktop-Speichern ist fehlgeschlagen; Browser-Fallback ist nicht erlaubt.',
                    warnings: [...statusWarnings, 'Desktop-App konnte die Aufnahme nicht speichern.'],
                    surfaceClassification: videoFeatureClassification.classification,
                    container: containers.deliveryContainer,
                    masterContainer: containers.masterContainer,
                    deliveryContainer: containers.deliveryContainer,
                    transcodeApplied: containers.transcodeApplied,
                    masterPath: containers.masterPath,
                    deliveryPath: containers.deliveryPath,
                    exportMatrix: saveRequest.exportMatrix,
                });
            }
            pushStatusWarning('Desktop-App konnte die Aufnahme nicht direkt speichern; Dateipfad-Fallback wird versucht.');
        }
    }
    if (typeof fetch !== 'function') {
        const downloaded = await downloadViaBrowser('fetch-unavailable');
        const containers = resolveResultContainers({
            container: requestMasterContainer,
            masterContainer: requestMasterContainer,
            deliveryContainer: requestMasterContainer,
        });
        return createDownloadStatus({
            requested: true,
            transport: downloaded ? 'download' : 'download-failed',
            status: downloaded ? 'saved_via_download' : 'download_failed',
            fallbackReason: 'fetch-unavailable',
            failureReason: downloaded ? null : 'fetch-unavailable',
            message: downloaded
                ? 'Recording wurde als Browser-Download gespeichert, weil keine Disk-API verfügbar ist.'
                : 'Recording konnte ohne Disk-API auch nicht als Browser-Download gespeichert werden.',
            warnings: withTranscodeDegradationWarning(
                [...statusWarnings, 'Disk-API ist in dieser Umgebung nicht verfügbar.']
            ),
            surfaceClassification: videoFeatureClassification.classification,
            container: containers.deliveryContainer,
            masterContainer: containers.masterContainer,
            deliveryContainer: containers.deliveryContainer,
            transcodeApplied: containers.transcodeApplied,
            masterPath: containers.masterPath,
            deliveryPath: containers.deliveryPath,
            exportMatrix: saveRequest.exportMatrix,
        });
    }
    try {
        const response = await fetch(EDITOR_API_ROUTES.SAVE_VIDEO_DISK, {
            method: 'POST',
            headers: { 'x-file-name': safeFileName },
            body: blob,
        });
        if (response?.ok) {
            logger?.info?.('[DownloadService] recording export saved via api', safeFileName);
            const containers = resolveResultContainers({
                container: requestMasterContainer,
                masterContainer: requestMasterContainer,
                deliveryContainer: requestMasterContainer,
            });
            return createDownloadStatus({
                requested: true,
                transport: 'api',
                status: 'saved_via_api',
                apiStatus: Number(response.status) || 200,
                message: 'Recording wurde über die lokale Disk-API gespeichert.',
                warnings: withTranscodeDegradationWarning(statusWarnings),
                surfaceClassification: videoFeatureClassification.classification,
                container: containers.deliveryContainer,
                masterContainer: containers.masterContainer,
                deliveryContainer: containers.deliveryContainer,
                transcodeApplied: containers.transcodeApplied,
                masterPath: containers.masterPath,
                deliveryPath: containers.deliveryPath,
                exportMatrix: saveRequest.exportMatrix,
            });
        }
        const apiStatus = Number(response?.status) || 0;
        const apiError = new Error(`http_${apiStatus || 'unknown'}`);
        const downloaded = await downloadViaBrowser('api-failed', apiError);
        const containers = resolveResultContainers({
            container: requestMasterContainer,
            masterContainer: requestMasterContainer,
            deliveryContainer: requestMasterContainer,
        });
        return createDownloadStatus({
            requested: true,
            transport: downloaded ? 'api-fallback-download' : 'api-fallback-download-failed',
            status: downloaded ? 'saved_via_download_fallback' : 'download_fallback_failed',
            fallbackReason: 'api-failed',
            failureReason: downloaded ? null : 'api-failed',
            apiStatus: apiStatus || null,
            message: downloaded
                ? 'Recording wurde als Browser-Download gespeichert, weil die Disk-API fehlgeschlagen ist.'
                : 'Recording konnte nach fehlgeschlagener Disk-API auch nicht als Browser-Download gespeichert werden.',
            warnings: withTranscodeDegradationWarning(
                [...statusWarnings, `Disk-API-Fehler: HTTP ${apiStatus || 'unknown'}.`]
            ),
            surfaceClassification: videoFeatureClassification.classification,
            container: containers.deliveryContainer,
            masterContainer: containers.masterContainer,
            deliveryContainer: containers.deliveryContainer,
            transcodeApplied: containers.transcodeApplied,
            masterPath: containers.masterPath,
            deliveryPath: containers.deliveryPath,
            exportMatrix: saveRequest.exportMatrix,
        });
    } catch (error) {
        const downloaded = await downloadViaBrowser('api-throw', error);
        const containers = resolveResultContainers({
            container: requestMasterContainer,
            masterContainer: requestMasterContainer,
            deliveryContainer: requestMasterContainer,
        });
        return createDownloadStatus({
            requested: true,
            transport: downloaded ? 'download' : 'download-failed',
            status: downloaded ? 'saved_via_download' : 'download_failed',
            fallbackReason: 'api-throw',
            failureReason: downloaded ? null : 'api-throw',
            message: downloaded
                ? 'Recording wurde als Browser-Download gespeichert, weil die Disk-API nicht erreichbar war.'
                : 'Recording konnte weder über die Disk-API noch als Browser-Download gespeichert werden.',
            warnings: withTranscodeDegradationWarning(
                [...statusWarnings, 'Disk-API war nicht erreichbar.']
            ),
            surfaceClassification: videoFeatureClassification.classification,
            container: containers.deliveryContainer,
            masterContainer: containers.masterContainer,
            deliveryContainer: containers.deliveryContainer,
            transcodeApplied: containers.transcodeApplied,
            masterPath: containers.masterPath,
            deliveryPath: containers.deliveryPath,
            exportMatrix: saveRequest.exportMatrix,
        });
    }
}
