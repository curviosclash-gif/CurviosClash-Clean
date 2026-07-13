const path = require('node:path');
const { existsSync, promises: fsPromises } = require('node:fs');
const { spawn } = require('node:child_process');

const RECORDING_TEMP_FILE_PREFIX = '.recording-export';
const FFMPEG_COMMAND_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const FFMPEG_PATH_ENV = 'CURVIOS_RECORDING_FFMPEG_PATH';
const NATIVE_TRANSCODE_TOOL = 'ffmpeg';
const NATIVE_TRANSCODE_PROBE_TIMEOUT_MS = 6000;
const NATIVE_TRANSCODE_JOB_TIMEOUT_MS = 120000;
const NATIVE_TRANSCODE_SUPPORTED_PAIR = Object.freeze({
    masterContainer: 'webm',
    deliveryContainer: 'mp4',
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeSingleLineToken(value, fallback = '') {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || fallback;
}

function dedupeWarnings(warnings) {
    const unique = [];
    const seen = new Set();
    for (const warning of Array.isArray(warnings) ? warnings : []) {
        const normalized = normalizeString(warning);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}

function normalizeRecordingContainer(value, fallback = 'webm') {
    const normalized = normalizeString(value, fallback).toLowerCase();
    if (normalized === 'mp4') return 'mp4';
    if (normalized === 'webm') return 'webm';
    return fallback;
}

function resolveVideoContainerFromFileNameAndMime(fileName, mimeType, fallback = 'webm') {
    const normalizedExt = path.extname(normalizeString(fileName)).toLowerCase();
    if (normalizedExt === '.mp4') return 'mp4';
    if (normalizedExt === '.webm') return 'webm';
    const normalizedMimeType = normalizeString(mimeType).toLowerCase();
    if (normalizedMimeType.includes('mp4')) return 'mp4';
    if (normalizedMimeType.includes('webm')) return 'webm';
    return normalizeRecordingContainer(fallback, 'webm');
}

function sanitizeVideoFileName(fileName, mimeType, preferredContainer = null) {
    const normalizedName = normalizeString(fileName, 'recording').replace(/\\/g, '/');
    const baseName = normalizedName.split('/').filter(Boolean).pop() || 'recording';
    const parsedName = path.parse(baseName);
    const safeName = normalizeString(parsedName.name, 'recording')
        .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .replace(/[.\s-]+$/g, '')
        || 'recording';
    const extension = normalizeRecordingContainer(
        preferredContainer,
        resolveVideoContainerFromFileNameAndMime(parsedName.base || baseName, mimeType)
    );
    return `${safeName}.${extension}`;
}

function normalizeRecordingVideoExportRequest({
    payload = null,
    defaultContractVersion = 'recording-video-export-request.v1',
    defaultCapabilityId = 'recording-video-export-save',
} = {}) {
    const request = payload && typeof payload === 'object' ? payload : {};
    const fileName = sanitizeVideoFileName(request.fileName, request.mimeType);
    const container = resolveVideoContainerFromFileNameAndMime(fileName, request.mimeType, 'webm');
    const masterContainer = normalizeRecordingContainer(
        request.masterContainer || request.container,
        container
    );
    const deliveryContainer = normalizeRecordingContainer(
        request.deliveryContainer,
        masterContainer
    );
    const normalizedWarnings = dedupeWarnings(request.warnings);

    return Object.freeze({
        contractVersion: normalizeString(request.contractVersion, defaultContractVersion),
        capabilityId: normalizeString(request.capabilityId, defaultCapabilityId),
        runtimeKind: normalizeString(request.runtimeKind, 'desktop'),
        profileVariant: normalizeString(request.profileVariant, 'standard'),
        captureProfile: normalizeString(request.captureProfile, 'standard'),
        exportPreset: normalizeString(request.exportPreset, 'youtube-mp4'),
        fileName,
        mimeType: normalizeString(
            request.mimeType,
            container === 'mp4' ? 'video/mp4' : 'video/webm'
        ),
        container: masterContainer,
        masterContainer,
        deliveryContainer,
        transcodeApplied: request.transcodeApplied === true,
        transcodeRequested: request.transcodeRequested === true,
        surfaceClassification: normalizeString(request.surfaceClassification),
        warnings: normalizedWarnings,
        exportMatrix: request.exportMatrix && typeof request.exportMatrix === 'object'
            ? { ...request.exportMatrix }
            : null,
        videoBytes: toUint8Array(request.videoBytes),
    });
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (Array.isArray(value)) {
        return Uint8Array.from(value);
    }
    return new Uint8Array(0);
}

function withContainerExtension(filePath, container) {
    const normalizedPath = normalizeString(filePath);
    if (!normalizedPath) return normalizedPath;
    const parsedPath = path.parse(normalizedPath);
    return path.join(parsedPath.dir, `${parsedPath.name}.${normalizeRecordingContainer(container, 'webm')}`);
}

function buildRecordingVideoTempPath(filePath, token = 'artifact') {
    const parsed = path.parse(filePath);
    const safeToken = normalizeString(token, 'artifact')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'artifact';
    const extension = parsed.ext || '';
    const tempName = `${RECORDING_TEMP_FILE_PREFIX}-${safeToken}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp${extension}`;
    return path.join(parsed.dir, tempName);
}

async function persistRecordingVideoBytes(filePath, videoBytes) {
    const tempPath = buildRecordingVideoTempPath(filePath, 'persist');
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    try {
        await fsPromises.writeFile(tempPath, Buffer.from(videoBytes));
    } catch (error) {
        error.code = 'RECORDING_SAVE_TEMP_WRITE_FAILED';
        throw error;
    }

    try {
        await fsPromises.copyFile(tempPath, filePath);
    } catch (error) {
        error.code = 'RECORDING_SAVE_FINALIZE_FAILED';
        throw error;
    } finally {
        await fsPromises.rm(tempPath, { force: true }).catch(() => {});
    }
}

function buildRecordingVideoFilters(container) {
    if (normalizeRecordingContainer(container) === 'mp4') {
        return [{ name: 'MP4 Video', extensions: ['mp4'] }];
    }
    return [
        { name: 'WebM Video', extensions: ['webm'] },
        { name: 'MP4 Video', extensions: ['mp4'] },
    ];
}

function resolveVideoSaveDialogPath(app, fileName) {
    const safeFileName = sanitizeVideoFileName(fileName, '');
    try {
        const videosDirectory = app?.getPath?.('videos');
        if (normalizeString(videosDirectory)) {
            return path.join(videosDirectory, safeFileName);
        }
    } catch {
        // Ignore missing OS video paths and fall back to documents.
    }
    try {
        const documentsDirectory = app?.getPath?.('documents');
        if (normalizeString(documentsDirectory)) {
            return path.join(documentsDirectory, safeFileName);
        }
    } catch {
        // Ignore unavailable documents path.
    }
    return safeFileName;
}

function resolvePlatformFolder(platformName) {
    if (platformName === 'win32') return 'win32';
    if (platformName === 'darwin') return 'darwin';
    return 'linux';
}

function resolveNativeTranscodeCandidates({
    env = process.env,
    platformName = process.platform,
    resourcesPath = process.resourcesPath,
}) {
    const candidates = [];
    const envBinaryPath = normalizeString(env?.[FFMPEG_PATH_ENV]);
    if (envBinaryPath) {
        candidates.push({
            command: path.resolve(envBinaryPath),
            source: `env:${FFMPEG_PATH_ENV}`,
            requiresExistsCheck: true,
        });
    }

    try {
        const ffmpegStaticPath = require('ffmpeg-static');
        const normalizedStaticPath = normalizeString(ffmpegStaticPath);
        if (normalizedStaticPath) {
            candidates.push({
                command: normalizedStaticPath,
                source: 'ffmpeg-static',
                requiresExistsCheck: true,
            });
            if (normalizedStaticPath.includes(`${path.sep}app.asar${path.sep}`)) {
                candidates.push({
                    command: normalizedStaticPath.replace(
                        `${path.sep}app.asar${path.sep}`,
                        `${path.sep}app.asar.unpacked${path.sep}`
                    ),
                    source: 'ffmpeg-static-asar-unpacked',
                    requiresExistsCheck: true,
                });
            }
        }
    } catch {
        // Optional dependency: continue with other deterministic candidates.
    }

    const platformFolder = resolvePlatformFolder(platformName);
    const binaryName = platformName === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const vendorCandidateRoots = [
        resourcesPath ? path.join(resourcesPath, 'vendor', 'ffmpeg', platformFolder) : '',
        path.join(__dirname, 'vendor', 'ffmpeg', platformFolder),
    ];
    for (const root of vendorCandidateRoots) {
        const normalizedRoot = normalizeString(root);
        if (!normalizedRoot) continue;
        candidates.push({
            command: path.join(normalizedRoot, binaryName),
            source: normalizedRoot.includes('resources')
                ? 'resources-vendor'
                : 'workspace-vendor',
            requiresExistsCheck: true,
        });
    }

    candidates.push({
        command: FFMPEG_COMMAND_NAME,
        source: 'system-path',
        requiresExistsCheck: false,
    });

    return candidates;
}

function createUnavailableNativeTranscodeCapability({
    statusCode = 'missing_binary',
    source = null,
    binaryPath = null,
    version = null,
    errorCode = null,
    errorMessage = null,
    checkedAt = Date.now(),
} = {}) {
    return Object.freeze({
        tool: NATIVE_TRANSCODE_TOOL,
        available: false,
        statusCode,
        source: source || null,
        binaryPath: binaryPath || null,
        command: binaryPath || null,
        version: version || null,
        errorCode: normalizeString(errorCode) || null,
        errorMessage: normalizeString(errorMessage) || null,
        checkedAt,
    });
}

function createReadyNativeTranscodeCapability({
    source,
    command,
    version = null,
    checkedAt = Date.now(),
} = {}) {
    return Object.freeze({
        tool: NATIVE_TRANSCODE_TOOL,
        available: true,
        statusCode: 'ready',
        source: source || null,
        binaryPath: command || null,
        command: command || null,
        version: version || null,
        errorCode: null,
        errorMessage: null,
        checkedAt,
    });
}

function extractFfmpegVersion(output = '') {
    const firstLine = String(output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    return firstLine || null;
}

function terminateChildProcess(child) {
    if (!child || typeof child.kill !== 'function') {
        return;
    }
    const pid = Number(child.pid || 0);
    if (process.platform === 'win32' && pid > 0) {
        try {
            spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            return;
        } catch {
            // Fall back to direct process kill.
        }
    }
    try {
        child.kill('SIGKILL');
    } catch {
        // Ignore kill failures; caller owns timeout fallback.
    }
}

function executeProcess(command, args, timeoutMs) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        let timeoutHandle = null;
        let timeoutForceResolveHandle = null;
        let child = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
            if (timeoutForceResolveHandle !== null) {
                clearTimeout(timeoutForceResolveHandle);
            }
            resolve(result);
        };
        try {
            child = spawn(command, args, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            finish({
                ok: false,
                code: null,
                signal: null,
                errorCode: normalizeString(error?.code, 'spawn_failed'),
                errorMessage: normalizeString(error?.message, 'spawn_failed'),
                stdout,
                stderr,
            });
            return;
        }
        timeoutHandle = setTimeout(() => {
            timedOut = true;
            terminateChildProcess(child);
            timeoutForceResolveHandle = setTimeout(() => {
                finish({
                    ok: false,
                    code: null,
                    signal: null,
                    errorCode: 'timeout',
                    errorMessage: `process_timeout_${timeoutMs}ms`,
                    stdout,
                    stderr,
                });
            }, 1500);
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk || '');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk || '');
        });
        child.once('error', (error) => {
            finish({
                ok: false,
                code: null,
                signal: null,
                errorCode: normalizeString(error?.code) || null,
                errorMessage: normalizeString(error?.message) || null,
                stdout,
                stderr,
            });
        });
        child.once('close', (code, signal) => {
            if (timedOut) {
                finish({
                    ok: false,
                    code,
                    signal: signal || null,
                    errorCode: 'timeout',
                    errorMessage: `process_timeout_${timeoutMs}ms`,
                    stdout,
                    stderr,
                });
                return;
            }
            finish({
                ok: code === 0,
                code,
                signal: signal || null,
                errorCode: code === 0 ? null : 'process_non_zero_exit',
                errorMessage: code === 0 ? null : `process_exit_${code}`,
                stdout,
                stderr,
            });
        });
    });
}

async function probeNativeTranscodeCapability({
    env = process.env,
    platformName = process.platform,
    resourcesPath = process.resourcesPath,
    now = () => Date.now(),
} = {}) {
    const candidates = resolveNativeTranscodeCandidates({
        env,
        platformName,
        resourcesPath,
    });
    let lastFailure = null;
    for (const candidate of candidates) {
        const command = normalizeString(candidate?.command);
        if (!command) continue;
        if (candidate?.requiresExistsCheck === true && !existsSync(command)) {
            continue;
        }
        const probe = await executeProcess(
            command,
            ['-hide_banner', '-version'],
            NATIVE_TRANSCODE_PROBE_TIMEOUT_MS
        );
        if (probe.ok) {
            return createReadyNativeTranscodeCapability({
                source: candidate.source,
                command,
                version: extractFfmpegVersion(probe.stdout || probe.stderr),
                checkedAt: now(),
            });
        }
        lastFailure = {
            source: candidate.source,
            command,
            errorCode: probe.errorCode,
            errorMessage: probe.errorMessage,
        };
    }
    if (lastFailure) {
        return createUnavailableNativeTranscodeCapability({
            statusCode: 'probe_failed',
            source: lastFailure.source,
            binaryPath: lastFailure.command,
            errorCode: lastFailure.errorCode,
            errorMessage: lastFailure.errorMessage,
            checkedAt: now(),
        });
    }
    return createUnavailableNativeTranscodeCapability({
        statusCode: 'missing_binary',
        checkedAt: now(),
    });
}

function resolveRecordingVideoExportTranscodeIntent(request) {
    const normalizedRequest = request && typeof request === 'object' ? request : {};
    const masterContainer = normalizeRecordingContainer(
        normalizedRequest.masterContainer || normalizedRequest.container,
        'webm'
    );
    const deliveryContainer = normalizeRecordingContainer(
        normalizedRequest.deliveryContainer,
        masterContainer
    );
    const requested = normalizedRequest.transcodeRequested === true
        || deliveryContainer !== masterContainer;
    const supportedPair = requested !== true || (
        masterContainer === NATIVE_TRANSCODE_SUPPORTED_PAIR.masterContainer
        && deliveryContainer === NATIVE_TRANSCODE_SUPPORTED_PAIR.deliveryContainer
    );
    return Object.freeze({
        requested,
        supportedPair,
        masterContainer,
        deliveryContainer,
    });
}

async function resolveRecordingVideoSaveCapabilityStatus(
    request,
    resolveNativeCapability
) {
    const transcodeIntent = resolveRecordingVideoExportTranscodeIntent(request);
    if (!transcodeIntent.requested) {
        return createUnavailableNativeTranscodeCapability({
            statusCode: 'not_requested',
        });
    }
    if (!transcodeIntent.supportedPair) {
        return createUnavailableNativeTranscodeCapability({
            statusCode: 'unsupported_pair',
            errorMessage: `${transcodeIntent.masterContainer}_to_${transcodeIntent.deliveryContainer}`,
        });
    }
    return resolveNativeCapability();
}

function createSaveResult({
    request,
    saved,
    code,
    container,
    masterContainer,
    deliveryContainer,
    transcodeApplied,
    filePath = null,
    masterPath = null,
    deliveryPath = null,
    fileName = null,
    failureReason = null,
    warnings = [],
    tempFileStrategy = null,
    nativeTranscodeCapability = null,
    transcodeFailureCode = null,
}) {
    const resolvedContainer = normalizeRecordingContainer(
        container || deliveryContainer || masterContainer || request.masterContainer,
        request.masterContainer
    );
    const resolvedMasterContainer = normalizeRecordingContainer(
        masterContainer,
        request.masterContainer
    );
    const resolvedDeliveryContainer = normalizeRecordingContainer(
        deliveryContainer,
        resolvedContainer
    );
    const resolvedDeliveryPath = deliveryPath || filePath || null;
    const resolvedMasterPath = masterPath
        || (transcodeApplied === true ? null : resolvedDeliveryPath);
    return {
        saved: saved === true,
        code: normalizeString(code, 'RECORDING_SAVE_FINALIZE_FAILED'),
        capabilityId: request.capabilityId,
        contractVersion: request.contractVersion,
        filePath: resolvedDeliveryPath,
        container: resolvedContainer,
        masterContainer: resolvedMasterContainer,
        deliveryContainer: resolvedDeliveryContainer,
        transcodeApplied: transcodeApplied === true,
        transcodeRequested: request.transcodeRequested === true,
        masterPath: resolvedMasterPath || null,
        deliveryPath: resolvedDeliveryPath || null,
        fileName: normalizeString(fileName) || (
            resolvedDeliveryPath
                ? path.basename(resolvedDeliveryPath)
                : null
        ),
        tempFileStrategy: normalizeString(tempFileStrategy) || null,
        failureReason: normalizeString(failureReason) || null,
        warnings: dedupeWarnings(warnings),
        exportMatrix: request.exportMatrix
            ? { ...request.exportMatrix }
            : null,
        nativeTranscodeCapability: nativeTranscodeCapability && typeof nativeTranscodeCapability === 'object'
            ? { ...nativeTranscodeCapability }
            : null,
        transcodeFailureCode: normalizeString(transcodeFailureCode) || null,
    };
}

async function runNativeTranscode({
    capability,
    sourcePath,
    targetPath,
}) {
    const command = normalizeString(capability?.command || capability?.binaryPath);
    if (!command) {
        return {
            ok: false,
            transcodeFailureCode: 'native_transcode_binary_missing',
            message: 'native_transcode_binary_missing',
        };
    }
    const result = await executeProcess(command, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        sourcePath,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        '-f',
        'mp4',
        targetPath,
    ], NATIVE_TRANSCODE_JOB_TIMEOUT_MS);
    if (result.ok !== true) {
        return {
            ok: false,
            transcodeFailureCode: normalizeString(result.errorCode, 'native_transcode_failed'),
            message: normalizeSingleLineToken(
                result.stderr || result.stdout,
                result.errorMessage || 'native_transcode_failed'
            ),
        };
    }
    return {
        ok: true,
        transcodeFailureCode: null,
        message: null,
    };
}

function createRecordingVideoExportJob({
    app,
    dialog,
    resolveWindow,
    contractVersion = 'recording-video-export-request.v1',
    capabilityId = 'recording-video-export-save',
} = {}) {
    const resolveDialogWindow = typeof resolveWindow === 'function' ? resolveWindow : (() => null);
    let cachedNativeCapability = null;
    let cachedAt = 0;

    async function resolveNativeCapability({ forceRefresh = false } = {}) {
        const nowMs = Date.now();
        if (!forceRefresh && cachedNativeCapability && (nowMs - cachedAt) < 15000) {
            return cachedNativeCapability;
        }
        cachedNativeCapability = await probeNativeTranscodeCapability({
            env: process.env,
            platformName: process.platform,
            resourcesPath: process.resourcesPath,
            now: () => Date.now(),
        });
        cachedAt = nowMs;
        return cachedNativeCapability;
    }

    async function getCapabilityStatus(options = null) {
        const hasRequestShape = options
            && typeof options === 'object'
            && (
                options.transcodeRequested === true
                || normalizeString(options.masterContainer) !== ''
                || normalizeString(options.deliveryContainer) !== ''
            );
        if (!hasRequestShape) {
            return resolveNativeCapability({
                forceRefresh: options?.forceRefresh === true,
            });
        }
        return resolveRecordingVideoSaveCapabilityStatus(options, () => (
            resolveNativeCapability({
                forceRefresh: options?.forceRefresh === true,
            })
        ));
    }

    async function handle(payload = null) {
        const request = normalizeRecordingVideoExportRequest({
            payload,
            defaultContractVersion: contractVersion,
            defaultCapabilityId: capabilityId,
        });
        const warnings = [...request.warnings];
        if (request.videoBytes.byteLength <= 0) {
            return createSaveResult({
                request,
                saved: false,
                code: 'RECORDING_SAVE_BYTES_INVALID',
                container: request.masterContainer,
                masterContainer: request.masterContainer,
                deliveryContainer: request.masterContainer,
                transcodeApplied: false,
                failureReason: 'bytes_invalid',
                warnings,
            });
        }

        const transcodeIntent = resolveRecordingVideoExportTranscodeIntent(request);
        const nativeCapability = await resolveRecordingVideoSaveCapabilityStatus(
            {
                ...request,
                transcodeRequested: transcodeIntent.requested,
                masterContainer: transcodeIntent.masterContainer,
                deliveryContainer: transcodeIntent.deliveryContainer,
            },
            resolveNativeCapability
        );
        const wantsNativeTranscode = transcodeIntent.requested === true
            && transcodeIntent.supportedPair === true
            && nativeCapability.available === true;
        if (transcodeIntent.requested === true && wantsNativeTranscode !== true) {
            warnings.push(`native_transcode_${nativeCapability.statusCode || 'unavailable'}`);
            warnings.push('delivery_degraded_to_master');
        }
        const effectiveDeliveryContainer = wantsNativeTranscode
            ? transcodeIntent.deliveryContainer
            : transcodeIntent.masterContainer;

        let dialogResult = null;
        try {
            dialogResult = await dialog.showSaveDialog(resolveDialogWindow(), {
                title: 'Video speichern',
                defaultPath: resolveVideoSaveDialogPath(
                    app,
                    sanitizeVideoFileName(
                        request.fileName,
                        request.mimeType,
                        effectiveDeliveryContainer
                    )
                ),
                filters: buildRecordingVideoFilters(effectiveDeliveryContainer),
                showOverwriteConfirmation: true,
            });
        } catch {
            return createSaveResult({
                request,
                saved: false,
                code: 'RECORDING_SAVE_DIALOG_FAILED',
                container: effectiveDeliveryContainer,
                masterContainer: transcodeIntent.masterContainer,
                deliveryContainer: effectiveDeliveryContainer,
                transcodeApplied: false,
                failureReason: 'dialog_failed',
                warnings,
                nativeTranscodeCapability: nativeCapability,
            });
        }

        if (dialogResult?.canceled || !dialogResult?.filePath) {
            return createSaveResult({
                request,
                saved: false,
                code: 'RECORDING_SAVE_CANCELLED',
                container: effectiveDeliveryContainer,
                masterContainer: transcodeIntent.masterContainer,
                deliveryContainer: effectiveDeliveryContainer,
                transcodeApplied: false,
                failureReason: 'cancelled',
                warnings,
                nativeTranscodeCapability: nativeCapability,
            });
        }

        const targetDeliveryPath = withContainerExtension(
            dialogResult.filePath,
            effectiveDeliveryContainer
        );
        if (!wantsNativeTranscode) {
            try {
                await persistRecordingVideoBytes(targetDeliveryPath, request.videoBytes);
                return createSaveResult({
                    request,
                    saved: true,
                    code: 'RECORDING_SAVE_OK',
                    container: transcodeIntent.masterContainer,
                    masterContainer: transcodeIntent.masterContainer,
                    deliveryContainer: transcodeIntent.masterContainer,
                    transcodeApplied: false,
                    filePath: targetDeliveryPath,
                    masterPath: targetDeliveryPath,
                    deliveryPath: targetDeliveryPath,
                    fileName: path.basename(targetDeliveryPath),
                    tempFileStrategy: 'dialog-temp-copy-final',
                    warnings,
                    nativeTranscodeCapability: nativeCapability,
                });
            } catch (error) {
                return createSaveResult({
                    request,
                    saved: false,
                    code: normalizeString(error?.code, 'RECORDING_SAVE_FINALIZE_FAILED'),
                    container: transcodeIntent.masterContainer,
                    masterContainer: transcodeIntent.masterContainer,
                    deliveryContainer: transcodeIntent.masterContainer,
                    transcodeApplied: false,
                    failureReason: 'persist_failed',
                    warnings,
                    nativeTranscodeCapability: nativeCapability,
                });
            }
        }

        const masterTempPath = buildRecordingVideoTempPath(targetDeliveryPath, 'master-webm');
        const deliveryTempPath = buildRecordingVideoTempPath(targetDeliveryPath, 'delivery-mp4');
        let transcodeFailureCode = null;
        let transcodeFailureMessage = null;
        try {
            await fsPromises.mkdir(path.dirname(targetDeliveryPath), { recursive: true });
            await fsPromises.writeFile(masterTempPath, Buffer.from(request.videoBytes));
            const transcodeResult = await runNativeTranscode({
                capability: nativeCapability,
                sourcePath: masterTempPath,
                targetPath: deliveryTempPath,
            });
            if (transcodeResult.ok !== true) {
                transcodeFailureCode = transcodeResult.transcodeFailureCode || 'native_transcode_failed';
                transcodeFailureMessage = normalizeSingleLineToken(
                    transcodeResult.message,
                    'native_transcode_failed'
                ).slice(0, 240);
                throw new Error(transcodeFailureMessage);
            }
            await fsPromises.copyFile(deliveryTempPath, targetDeliveryPath);
            return createSaveResult({
                request,
                saved: true,
                code: 'RECORDING_SAVE_OK',
                container: transcodeIntent.deliveryContainer,
                masterContainer: transcodeIntent.masterContainer,
                deliveryContainer: transcodeIntent.deliveryContainer,
                transcodeApplied: true,
                filePath: targetDeliveryPath,
                masterPath: null,
                deliveryPath: targetDeliveryPath,
                fileName: path.basename(targetDeliveryPath),
                tempFileStrategy: 'master-temp-native-transcode-final',
                warnings,
                nativeTranscodeCapability: nativeCapability,
            });
        } catch {
            const fallbackMasterPath = withContainerExtension(
                targetDeliveryPath,
                transcodeIntent.masterContainer
            );
            try {
                await persistRecordingVideoBytes(fallbackMasterPath, request.videoBytes);
            } catch (persistError) {
                return createSaveResult({
                    request,
                    saved: false,
                    code: normalizeString(persistError?.code, 'RECORDING_SAVE_FINALIZE_FAILED'),
                    container: transcodeIntent.masterContainer,
                    masterContainer: transcodeIntent.masterContainer,
                    deliveryContainer: transcodeIntent.masterContainer,
                    transcodeApplied: false,
                    failureReason: 'persist_failed',
                    warnings: [
                        ...warnings,
                        'native_transcode_failed_master_persist_failed',
                    ],
                    nativeTranscodeCapability: nativeCapability,
                    transcodeFailureCode: transcodeFailureCode || 'native_transcode_failed',
                });
            }
            return createSaveResult({
                request,
                saved: true,
                code: 'RECORDING_SAVE_OK_MASTER_FALLBACK',
                container: transcodeIntent.masterContainer,
                masterContainer: transcodeIntent.masterContainer,
                deliveryContainer: transcodeIntent.masterContainer,
                transcodeApplied: false,
                filePath: fallbackMasterPath,
                masterPath: fallbackMasterPath,
                deliveryPath: fallbackMasterPath,
                fileName: path.basename(fallbackMasterPath),
                tempFileStrategy: 'master-temp-native-transcode-final',
                failureReason: 'native_transcode_failed',
                warnings: [
                    ...warnings,
                    'native_transcode_failed_master_retained',
                    transcodeFailureCode ? `native_transcode_failure_code:${transcodeFailureCode}` : null,
                    transcodeFailureMessage ? `native_transcode_failure:${transcodeFailureMessage}` : null,
                ],
                nativeTranscodeCapability: nativeCapability,
                transcodeFailureCode: transcodeFailureCode || 'native_transcode_failed',
            });
        } finally {
            await Promise.allSettled([
                fsPromises.rm(masterTempPath, { force: true }),
                fsPromises.rm(deliveryTempPath, { force: true }),
            ]);
        }
    }

    return Object.freeze({
        handle,
        getCapabilityStatus,
    });
}

module.exports = Object.freeze({
    buildRecordingVideoTempPath,
    createRecordingVideoExportJob,
    createUnavailableNativeTranscodeCapability,
    normalizeRecordingVideoExportRequest,
    resolveRecordingVideoExportTranscodeIntent,
    resolveRecordingVideoSaveCapabilityStatus,
});
