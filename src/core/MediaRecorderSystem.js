// @ts-nocheck
/* eslint-disable max-lines */
import { WebCodecsRecorderEngine } from './recording/engines/WebCodecsRecorderEngine.js';
import { NativeMediaRecorderEngine } from './recording/engines/NativeMediaRecorderEngine.js';
import {
    MATCH_LIFECYCLE_CONTRACT_VERSION,
    MATCH_LIFECYCLE_EVENT_TYPES,
} from '../shared/contracts/MatchLifecycleContract.js';
import {
    defaultDownload,
} from './recording/DownloadService.js';
import { toFiniteNumber } from '../utils/MathOps.js';
import {
    createPlatformRecordingCapabilityAdapter,
    DEFAULT_FALLBACK_MIME_TYPE,
    DEFAULT_MIME_TYPE,
    detectNativeRecorderSupport,
    isDesktopAppRuntime,
    RECORDER_ENGINE,
    resolveDesktopAppMediaRecorderMimeType,
    resolveGlobalScope,
    resolvePerfNow,
    resolveSafeMediaRecorderMimeType,
    sanitizeFileToken,
} from './recording/MediaRecorderSupport.js';
import {
    createDefaultRecordingCaptureSettings,
    RECORDING_CINEMATIC_QUALITY_PROFILE,
    isCinematicCaptureProfile,
    normalizeRecordingCaptureSettings,
    RECORDING_DOWNLOAD_DIRECTORY,
} from '../shared/contracts/RecordingCaptureContract.js';
import {
    CAPTURE_LOAD_LEVELS,
    computePercentile,
    ENCODE_QUEUE_DROP_LIMIT,
    ENCODE_QUEUE_SOFT_LIMIT,
    MAX_CAPTURE_BACKLOG_STEPS,
    MAX_CAPTURE_STEPS_PER_RENDER,
    MAX_CAPTURE_TIMESTAMPS,
    MEDIARECORDER_SYNTHETIC_QUEUE_HARD_MS,
    MEDIARECORDER_SYNTHETIC_QUEUE_SOFT_MS,
    toPositiveInt,
} from './recording/MediaRecorderSystemOps.js';
import { finalizeMediaRecorderBlobExport } from './recording/MediaRecorderExportFinalizeOps.js';
const DEFAULT_CONTRACT_VERSION = MATCH_LIFECYCLE_CONTRACT_VERSION;
export const LIFECYCLE_EVENT_TYPES = MATCH_LIFECYCLE_EVENT_TYPES;
export class MediaRecorderSystem {
    constructor({
        canvas = null,
        autoRecordingEnabled = true,
        autoDownload = false,
        downloadDirectoryName = RECORDING_DOWNLOAD_DIRECTORY,
        captureFps = 60,
        onRecordingStateChange = null,
        contractVersion = DEFAULT_CONTRACT_VERSION,
        filePrefix = 'aero-arena',
        logger = console,
        now = () => Date.now(),
        downloadHandler = defaultDownload,
        capabilityProbe = null,
        captureSourceResolver = null,
        recordingCaptureSettings = null,
        globalScope = null,
        runtimePerfProfiler = null,
    } = {}) {
        this.canvas = canvas || null;
        this.autoRecordingEnabled = autoRecordingEnabled !== false;
        this.autoDownload = !!autoDownload;
        this.downloadDirectoryName = sanitizeFileToken(downloadDirectoryName, RECORDING_DOWNLOAD_DIRECTORY);
        this.captureFps = Math.max(1, Number(captureFps) || 60);
        this._activeCaptureFps = this.captureFps;
        this.onRecordingStateChange = typeof onRecordingStateChange === 'function' ? onRecordingStateChange : null;
        this.contractVersion = String(contractVersion || DEFAULT_CONTRACT_VERSION);
        this.filePrefix = sanitizeFileToken(filePrefix, 'aero-arena');
        this.logger = logger || console;
        this.now = typeof now === 'function' ? now : (() => Date.now());
        this.downloadHandler = typeof downloadHandler === 'function' ? downloadHandler : defaultDownload;
        this._capabilityProbe = typeof capabilityProbe === 'function' ? capabilityProbe : null;
        this.captureSourceResolver = typeof captureSourceResolver === 'function' ? captureSourceResolver : null;
        this.recordingCaptureSettings = normalizeRecordingCaptureSettings(
            recordingCaptureSettings,
            createDefaultRecordingCaptureSettings()
        );
        this._globalScope = resolveGlobalScope(globalScope);
        this._perfNow = resolvePerfNow(this._globalScope);
        this.runtimePerfProfiler = runtimePerfProfiler || null;
        this._muxer = null;
        this._videoEncoder = null;
        this._mediaRecorder = null;
        this._mediaRecorderChunks = null;
        this._mediaRecorderStream = null;
        this._mediaRecorderVideoTrack = null;
        this._mediaRecorderSupportsRequestFrame = false;
        this._mediaRecorderUsesCaptureCanvas = false;
        this._mediaRecorderPumpTimer = null;
        this._mediaRecorderPumpResolutionScale = 1;
        this._activeRecorderStrategy = null;
        this._activeRecording = null;
        this._pendingStop = null;
        this._lastExport = null;
        this._lifecycleEvents = [];
        this._frameCount = 0;
        this._isRecording = false;
        this._activeMimeType = DEFAULT_MIME_TYPE;
        this._activeRecorderEngine = RECORDER_ENGINE.NONE;
        this._encoderWidth = 0;
        this._encoderHeight = 0;
        this._captureLevelIndex = 0;
        this._captureAccumulatorMs = 0;
        this._captureLastNowMs = 0;
        this._captureTimestampUs = 0;
        this._captureHighPressureFrames = 0;
        this._captureLowPressureFrames = 0;
        this._captureDroppedFrames = 0;
        this._captureEncodedFrames = 0;
        this._captureBackpressureEvents = 0;
        this._captureMaxEncodeQueueSize = 0;
        this._captureCanvas = null;
        this._captureCanvasCtx = null;
        this._captureCanvasWidth = 0;
        this._captureCanvasHeight = 0;
        this._resolvedCaptureCanvas = this.canvas || null;
        this._captureTimestampHistoryUs = new Float64Array(MAX_CAPTURE_TIMESTAMPS);
        this._captureTimestampHistoryCount = 0;
        this._captureTimestampHistoryWriteIndex = 0;
        this._lastFrameIntervalStats = null;
        this._frameIntervalStatsDirty = false;
    }
    getContractVersion() {
        return this.contractVersion;
    }
    _resolveSupportState() {
        const sourceCanvas = this._resolveCaptureCanvas();
        const canCapture = !!sourceCanvas;
        let customSupport = null;
        if (typeof this._capabilityProbe === 'function') {
            try {
                customSupport = this._capabilityProbe({
                    canvas: sourceCanvas,
                    globalScope: this._globalScope,
                    mimeType: DEFAULT_MIME_TYPE,
                });
            } catch (error) {
                this.logger?.warn?.('[MediaRecorderSystem] capability probe failed', error);
            }
        }
        if (customSupport && typeof customSupport === 'object') {
            const hasRecorder = !!customSupport.hasRecorder;
            const canRecord = !!customSupport.canRecord;
            const recorderEngine = String(
                customSupport.recorderEngine || (hasRecorder ? RECORDER_ENGINE.NATIVE_WEBCODECS : RECORDER_ENGINE.NONE)
            );
            const selectedMimeType = String(customSupport.selectedMimeType || DEFAULT_MIME_TYPE);
            return {
                canCapture,
                hasRecorder,
                hasWebCodecs: recorderEngine === RECORDER_ENGINE.NATIVE_WEBCODECS,
                hasMediaRecorder: recorderEngine === RECORDER_ENGINE.NATIVE_MEDIARECORDER,
                canRecord,
                selectedMimeType,
                recorderEngine,
                supportReason: String(customSupport.supportReason || (canRecord ? 'capability-probe' : 'probe-disabled')),
            };
        }
        const recordingAdapter = createPlatformRecordingCapabilityAdapter(this._globalScope, sourceCanvas);
        const nativeSupport = recordingAdapter.support || detectNativeRecorderSupport(this._globalScope, sourceCanvas);
        const hasRecorder = nativeSupport.hasRecorder;
        if (isDesktopAppRuntime(this._globalScope) && nativeSupport.hasMediaRecorder) {
            const preferredMimeType = resolveDesktopAppMediaRecorderMimeType(this._globalScope);
            return {
                canCapture,
                hasRecorder,
                hasWebCodecs: nativeSupport.hasWebCodecs,
                hasMediaRecorder: true,
                mediaRecorderMimeType: preferredMimeType,
                canRecord: canCapture && hasRecorder,
                selectedMimeType: preferredMimeType,
                recorderEngine: RECORDER_ENGINE.NATIVE_MEDIARECORDER,
                supportReason: canCapture ? 'desktop-prefer-mediarecorder' : 'missing-canvas',
                capability: recordingAdapter.capability,
            };
        }
        return {
            canCapture,
            hasRecorder,
            hasWebCodecs: nativeSupport.hasWebCodecs,
            hasMediaRecorder: nativeSupport.hasMediaRecorder,
            mediaRecorderMimeType: nativeSupport.mediaRecorderMimeType || null,
            canRecord: canCapture && hasRecorder,
            selectedMimeType: nativeSupport.selectedMimeType,
            recorderEngine: nativeSupport.recorderEngine,
            supportReason: canCapture ? nativeSupport.supportReason : 'missing-canvas',
            capability: recordingAdapter.capability,
        };
    }
    getSupportState() {
        return this._resolveSupportState();
    }
    setCaptureSourceResolver(resolver = null) {
        this.captureSourceResolver = typeof resolver === 'function' ? resolver : null;
        this._resolvedCaptureCanvas = null;
    }
    setRecordingCaptureSettings(settings = null) {
        this.recordingCaptureSettings = normalizeRecordingCaptureSettings(
            settings,
            this.recordingCaptureSettings || createDefaultRecordingCaptureSettings()
        );
        return { ...this.recordingCaptureSettings };
    }
    getRecordingCaptureSettings() {
        return { ...this.recordingCaptureSettings };
    }
    _setActiveRecorderStrategy(strategy = null) {
        this._activeRecorderStrategy = strategy || null;
        this._syncRecorderRuntimeState();
    }
    _syncRecorderRuntimeState() {
        const runtimeState = this._activeRecorderStrategy?.getRuntimeState?.() || null;
        this._muxer = runtimeState?.muxer || null;
        this._videoEncoder = runtimeState?.videoEncoder || null;
        this._mediaRecorder = runtimeState?.mediaRecorder || null;
        this._mediaRecorderChunks = runtimeState?.mediaRecorderChunks || null;
        this._mediaRecorderStream = runtimeState?.mediaRecorderStream || null;
        this._mediaRecorderVideoTrack = runtimeState?.mediaRecorderVideoTrack || null;
        this._mediaRecorderSupportsRequestFrame = !!runtimeState?.mediaRecorderSupportsRequestFrame;
    }
    _resolveCaptureCanvas() {
        let resolvedCanvas = this.canvas || null;
        if (typeof this.captureSourceResolver === 'function') {
            try {
                const candidate = this.captureSourceResolver();
                if (candidate && typeof candidate === 'object') {
                    resolvedCanvas = candidate;
                }
            } catch (error) {
                this.logger?.warn?.('[MediaRecorderSystem] capture source resolver failed', error);
            }
        }
        this._resolvedCaptureCanvas = resolvedCanvas;
        return resolvedCanvas;
    }
    _getCaptureCanvas() {
        return this._resolvedCaptureCanvas || this._resolveCaptureCanvas();
    }
    setAutoRecordingEnabled(enabled) {
        this.autoRecordingEnabled = !!enabled;
    }
    isRecording() {
        return this._isRecording;
    }
    setCaptureFps(fps) {
        const nextFps = Math.max(1, Math.floor(Number(fps) || 0));
        if (!Number.isFinite(nextFps)) {
            return this.captureFps;
        }
        this.captureFps = nextFps;
        if (!this._isRecording) {
            this._activeCaptureFps = nextFps;
        }
        if (this._isRecording && this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_WEBCODECS) {
            this._resetWebCodecsCaptureState();
        }
        return this.captureFps;
    }
    _notifyRecordingStateChange(isRecording) {
        if (typeof this.onRecordingStateChange !== 'function') return;
        try {
            this.onRecordingStateChange(!!isRecording);
        } catch (error) {
            this.logger?.warn?.('[MediaRecorderSystem] recording state callback failed', error);
        }
    }
    _resetWebCodecsCaptureState(initialLevelIndex = 1) {
        this._captureAccumulatorMs = 0;
        this._captureLastNowMs = 0;
        this._captureTimestampUs = 0;
        this._captureLevelIndex = Math.max(
            0,
            Math.min(CAPTURE_LOAD_LEVELS.length - 1, Math.trunc(toFiniteNumber(initialLevelIndex, 1)))
        );
        this._captureHighPressureFrames = 0;
        this._captureLowPressureFrames = 0;
        this._captureDroppedFrames = 0;
        this._captureEncodedFrames = 0;
        this._captureBackpressureEvents = 0;
        this._captureMaxEncodeQueueSize = 0;
        this._captureTimestampHistoryCount = 0;
        this._captureTimestampHistoryWriteIndex = 0;
        this._lastFrameIntervalStats = null;
        this._frameIntervalStatsDirty = false;
    }
    _stopMediaRecorderPump() {
        if (this._mediaRecorderPumpTimer != null && typeof clearInterval === 'function') {
            clearInterval(this._mediaRecorderPumpTimer);
        }
        this._mediaRecorderPumpTimer = null;
    }
    _startMediaRecorderPump(resolutionScale = 1, captureFps = null) {
        this._stopMediaRecorderPump();
        this._mediaRecorderPumpResolutionScale = Math.max(0.2, Math.min(1, toFiniteNumber(resolutionScale, 1)));
        if (typeof setInterval !== 'function') return;
        if (!this._mediaRecorderUsesCaptureCanvas && !this._mediaRecorderSupportsRequestFrame) return;
        const effectiveCaptureFps = Math.max(1, toFiniteNumber(captureFps, this._getActiveCaptureFps()));
        const intervalMs = Math.max(16, Math.round(1000 / effectiveCaptureFps));
        this._mediaRecorderPumpTimer = setInterval(() => {
            if (!this._isRecording || this._activeRecorderEngine !== RECORDER_ENGINE.NATIVE_MEDIARECORDER) return;
            try {
                if (this._mediaRecorderUsesCaptureCanvas) {
                    this._ensureMediaRecorderCaptureSurface(this._mediaRecorderPumpResolutionScale);
                }
                if (this._mediaRecorderVideoTrack?.requestFrame) {
                    this._mediaRecorderVideoTrack.requestFrame();
                }
            } catch {
                // Ignore timer-driven capture hiccups.
            }
        }, intervalMs);
    }
    _getActiveCaptureFps() {
        return Math.max(1, toFiniteNumber(this._activeCaptureFps, this.captureFps));
    }
    _getCaptureLevel() {
        return CAPTURE_LOAD_LEVELS[Math.max(0, Math.min(CAPTURE_LOAD_LEVELS.length - 1, this._captureLevelIndex))];
    }
    _resolveRecordingTargetFps() {
        if (isCinematicCaptureProfile(this.recordingCaptureSettings?.profile)) {
            return Math.max(
                1,
                toPositiveInt(
                    RECORDING_CINEMATIC_QUALITY_PROFILE?.targetFps,
                    this.captureFps,
                    1,
                    240
                )
            );
        }
        return Math.max(1, this.captureFps);
    }
    _resolveEffectiveCaptureFps() {
        const activeCaptureFps = this._getActiveCaptureFps();
        if (isCinematicCaptureProfile(this.recordingCaptureSettings?.profile)) {
            return activeCaptureFps;
        }
        const level = this._getCaptureLevel();
        return Math.max(1, activeCaptureFps * level.fpsScale);
    }
    _resolveCaptureResolutionScale(level = null) {
        if (isCinematicCaptureProfile(this.recordingCaptureSettings?.profile)) {
            return 1;
        }
        return Math.max(0.2, Math.min(1, toFiniteNumber(level?.resolutionScale, 1)));
    }
    _advanceCaptureTimelineMs(deltaMs) {
        const safeDeltaMs = Math.max(0, toFiniteNumber(deltaMs, 0));
        if (!(safeDeltaMs > 0)) {
            return 0;
        }
        const deltaUs = Math.max(1, Math.round(safeDeltaMs * 1000));
        this._captureTimestampUs += deltaUs;
        return deltaUs;
    }
    _ensureCaptureSurface(scale = 1) {
        const sourceCanvas = this._getCaptureCanvas();
        if (!sourceCanvas) return null;
        const resolutionScale = Math.max(0.2, Math.min(1, toFiniteNumber(scale, 1)));
        const sourceWidth = Math.max(2, Math.floor(toFiniteNumber(sourceCanvas?.width, 0)));
        const sourceHeight = Math.max(2, Math.floor(toFiniteNumber(sourceCanvas?.height, 0)));
        // If encoder dimensions are set (aspect-ratio clamped), always use an
        // intermediate capture canvas to rescale to the encoder target size.
        const hasEncoderDims = this._encoderWidth > 0 && this._encoderHeight > 0;
        if (!hasEncoderDims && resolutionScale >= 0.999 || typeof document === 'undefined') {
            this._captureCanvas = null;
            this._captureCanvasCtx = null;
            this._captureCanvasWidth = sourceWidth;
            this._captureCanvasHeight = sourceHeight;
            return sourceCanvas;
        }
        let targetWidth, targetHeight;
        if (hasEncoderDims) {
            // Apply resolution scale on top of encoder dimensions
            targetWidth = Math.max(2, Math.floor(this._encoderWidth * resolutionScale)) & ~1;
            targetHeight = Math.max(2, Math.floor(this._encoderHeight * resolutionScale)) & ~1;
        } else {
            targetWidth = Math.max(2, Math.floor(sourceWidth * resolutionScale));
            targetHeight = Math.max(2, Math.floor(sourceHeight * resolutionScale));
        }
        if (!this._captureCanvas) {
            this._captureCanvas = document.createElement('canvas');
            this._captureCanvasCtx = this._captureCanvas.getContext('2d', { alpha: false });
        }
        if (!this._captureCanvas || !this._captureCanvasCtx) {
            return sourceCanvas;
        }
        if (this._captureCanvas.width !== targetWidth || this._captureCanvas.height !== targetHeight) {
            this._captureCanvas.width = targetWidth;
            this._captureCanvas.height = targetHeight;
        }
        this._captureCanvasWidth = targetWidth;
        this._captureCanvasHeight = targetHeight;
        this._captureCanvasCtx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in this._captureCanvasCtx) {
            this._captureCanvasCtx.imageSmoothingQuality = 'high';
        }
        this._captureCanvasCtx.clearRect(0, 0, targetWidth, targetHeight);
        this._captureCanvasCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
        return this._captureCanvas;
    }
    _ensureMediaRecorderCaptureSurface(scale = 1) {
        const sourceCanvas = this._getCaptureCanvas();
        if (!sourceCanvas) return null;
        if (typeof document === 'undefined') {
            return sourceCanvas;
        }
        const resolutionScale = Math.max(0.2, Math.min(1, toFiniteNumber(scale, 1)));
        const sourceWidth = Math.max(2, Math.floor(toFiniteNumber(sourceCanvas?.width, 0)));
        const sourceHeight = Math.max(2, Math.floor(toFiniteNumber(sourceCanvas?.height, 0)));
        if (!this._captureCanvas) {
            this._captureCanvas = document.createElement('canvas');
            this._captureCanvasCtx = this._captureCanvas.getContext('2d', { alpha: false });
        }
        if (!this._captureCanvas || !this._captureCanvasCtx) {
            return sourceCanvas;
        }
        const targetWidth = Math.max(2, Math.floor(sourceWidth * resolutionScale));
        const targetHeight = Math.max(2, Math.floor(sourceHeight * resolutionScale));
        if (this._captureCanvas.width !== targetWidth || this._captureCanvas.height !== targetHeight) {
            this._captureCanvas.width = targetWidth;
            this._captureCanvas.height = targetHeight;
        }
        this._captureCanvasWidth = targetWidth;
        this._captureCanvasHeight = targetHeight;
        this._captureCanvasCtx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in this._captureCanvasCtx) {
            this._captureCanvasCtx.imageSmoothingQuality = 'high';
        }
        this._captureCanvasCtx.clearRect(0, 0, targetWidth, targetHeight);
        this._captureCanvasCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
        return this._captureCanvas;
    }
    _recordCaptureTimestampUs(timestampUs) {
        this._captureTimestampHistoryUs[this._captureTimestampHistoryWriteIndex] = timestampUs;
        this._captureTimestampHistoryWriteIndex = (this._captureTimestampHistoryWriteIndex + 1) % MAX_CAPTURE_TIMESTAMPS;
        this._captureTimestampHistoryCount = Math.min(MAX_CAPTURE_TIMESTAMPS, this._captureTimestampHistoryCount + 1);
        this._frameIntervalStatsDirty = true;
    }
    _resolveCaptureTimestampUs(sequenceIndex) {
        if (sequenceIndex < 0 || sequenceIndex >= this._captureTimestampHistoryCount) return null;
        const oldestIndex = (this._captureTimestampHistoryWriteIndex - this._captureTimestampHistoryCount + MAX_CAPTURE_TIMESTAMPS) % MAX_CAPTURE_TIMESTAMPS;
        const ringIndex = (oldestIndex + sequenceIndex) % MAX_CAPTURE_TIMESTAMPS;
        return this._captureTimestampHistoryUs[ringIndex];
    }
    _computeFrameIntervalStats() {
        if (this._captureTimestampHistoryCount < 2) {
            return null;
        }
        const intervals = [];
        for (let i = 1; i < this._captureTimestampHistoryCount; i++) {
            const previous = this._resolveCaptureTimestampUs(i - 1);
            const current = this._resolveCaptureTimestampUs(i);
            if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
            const deltaMs = (current - previous) / 1000;
            if (deltaMs > 0) {
                intervals.push(deltaMs);
            }
        }
        if (intervals.length === 0) {
            return null;
        }
        let sum = 0;
        let max = 0;
        for (let i = 0; i < intervals.length; i++) {
            const value = intervals[i];
            sum += value;
            if (value > max) max = value;
        }
        const sorted = intervals.slice().sort((a, b) => a - b);
        return {
            sampleCount: intervals.length,
            mean: sum / intervals.length,
            p95: computePercentile(sorted, 0.95),
            p99: computePercentile(sorted, 0.99),
            max,
        };
    }
    _getFrameIntervalStats(forceRecompute = false) {
        if (!forceRecompute && this._frameIntervalStatsDirty !== true) {
            return this._lastFrameIntervalStats;
        }
        this._lastFrameIntervalStats = this._computeFrameIntervalStats();
        this._frameIntervalStatsDirty = false;
        return this._lastFrameIntervalStats;
    }
    _updateCaptureLoadLevel(encodeQueueSize) {
        const safeQueueSize = Math.max(0, Math.trunc(toFiniteNumber(encodeQueueSize, 0)));
        this._captureMaxEncodeQueueSize = Math.max(this._captureMaxEncodeQueueSize, safeQueueSize);
        if (safeQueueSize >= ENCODE_QUEUE_DROP_LIMIT) {
            const nextLevel = Math.min(CAPTURE_LOAD_LEVELS.length - 1, this._captureLevelIndex + 2);
            if (nextLevel !== this._captureLevelIndex) {
                this._captureLevelIndex = nextLevel;
                this._captureBackpressureEvents += 1;
                this.logger?.warn?.('[MediaRecorderSystem] capture load level increased', {
                    level: this._captureLevelIndex,
                    encodeQueueSize: safeQueueSize,
                    immediate: true,
                });
            }
            this._captureHighPressureFrames = 0;
            this._captureLowPressureFrames = 0;
            return;
        }
        if (safeQueueSize >= ENCODE_QUEUE_SOFT_LIMIT) {
            this._captureHighPressureFrames += 1;
            this._captureLowPressureFrames = 0;
        } else if (safeQueueSize <= 1) {
            this._captureLowPressureFrames += 1;
            this._captureHighPressureFrames = Math.max(0, this._captureHighPressureFrames - 1);
        } else {
            this._captureHighPressureFrames = Math.max(0, this._captureHighPressureFrames - 1);
            this._captureLowPressureFrames = Math.max(0, this._captureLowPressureFrames - 1);
        }
        if (
            this._captureHighPressureFrames >= 2
            && this._captureLevelIndex < (CAPTURE_LOAD_LEVELS.length - 1)
        ) {
            this._captureLevelIndex += 1;
            this._captureHighPressureFrames = 0;
            this._captureBackpressureEvents += 1;
            this.logger?.warn?.('[MediaRecorderSystem] capture load level increased', {
                level: this._captureLevelIndex,
                encodeQueueSize: safeQueueSize,
            });
        } else if (this._captureLowPressureFrames >= 240 && this._captureLevelIndex > 0) {
            this._captureLevelIndex -= 1;
            this._captureLowPressureFrames = 0;
            this.logger?.info?.('[MediaRecorderSystem] capture load level recovered', {
                level: this._captureLevelIndex,
            });
        }
    }
    _resolveSyntheticQueueSizeFromRenderDelta(deltaMs) {
        const safeDeltaMs = Math.max(0, toFiniteNumber(deltaMs, 0));
        if (safeDeltaMs >= MEDIARECORDER_SYNTHETIC_QUEUE_HARD_MS) {
            return ENCODE_QUEUE_DROP_LIMIT;
        }
        if (safeDeltaMs >= (MEDIARECORDER_SYNTHETIC_QUEUE_SOFT_MS * 1.5)) {
            return ENCODE_QUEUE_SOFT_LIMIT + 2;
        }
        if (safeDeltaMs >= MEDIARECORDER_SYNTHETIC_QUEUE_SOFT_MS) {
            return ENCODE_QUEUE_SOFT_LIMIT;
        }
        return 0;
    }
    _dropCaptureBacklog(stepIntervalMs) {
        const safeStepIntervalMs = Math.max(1, toFiniteNumber(stepIntervalMs, 1000 / Math.max(1, this.captureFps)));
        const maxBacklogMs = safeStepIntervalMs * MAX_CAPTURE_BACKLOG_STEPS;
        if (!(this._captureAccumulatorMs > maxBacklogMs)) {
            return 0;
        }
        const retainedAccumulatorMs = safeStepIntervalMs;
        const overflowMs = Math.max(0, this._captureAccumulatorMs - retainedAccumulatorMs);
        const droppedFrames = Math.max(1, Math.floor(overflowMs / safeStepIntervalMs));
        this._captureAccumulatorMs = retainedAccumulatorMs;
        this._captureDroppedFrames += droppedFrames;
        this._advanceCaptureTimelineMs(overflowMs);
        return droppedFrames;
    }
    _captureWebCodecsFrame(stepIntervalMs) {
        if (!this._isRecording || !this._videoEncoder || this._videoEncoder.state !== 'configured') {
            if (this._frameCount === 0) {
                this.logger?.warn?.(`[MediaRecorderSystem] captureFrame skipped: recording=${this._isRecording}, encoder=${!!this._videoEncoder}, state=${this._videoEncoder?.state}`);
            }
            return;
        }
        const VideoFrameCtor = this._globalScope?.VideoFrame;
        if (typeof VideoFrameCtor !== 'function') {
            if (this._frameCount === 0) {
                this.logger?.warn?.('[MediaRecorderSystem] captureFrame skipped: VideoFrame constructor not available');
            }
            return;
        }
        const encodeQueueSize = toPositiveInt(this._videoEncoder.encodeQueueSize, 0, 0, 10_000);
        this._updateCaptureLoadLevel(encodeQueueSize);
        this._advanceCaptureTimelineMs(stepIntervalMs);
        if (encodeQueueSize >= ENCODE_QUEUE_DROP_LIMIT) {
            this._captureDroppedFrames += 1;
            return;
        }
        const level = this._getCaptureLevel();
        const frameSource = this._ensureCaptureSurface(this._resolveCaptureResolutionScale(level));
        if (!frameSource) {
            this._captureDroppedFrames += 1;
            return;
        }
        const encodeStart = this._perfNow();
        try {
            const frame = new VideoFrameCtor(frameSource, { timestamp: this._captureTimestampUs });
            const insertKeyFrame = (this._captureEncodedFrames % Math.max(1, Math.round(this._getActiveCaptureFps() * 2))) === 0;
            this._videoEncoder.encode(frame, { keyFrame: insertKeyFrame });
            frame.close();
            this._frameCount += 1;
            this._captureEncodedFrames += 1;
            this._recordCaptureTimestampUs(this._captureTimestampUs);
        } catch {
            // Ignore transient frame capture errors (e.g. canvas resized)
        } finally {
            const durationMs = this._perfNow() - encodeStart;
            this.runtimePerfProfiler?.recordSubsystemDuration?.('recorder_encode', durationMs);
        }
    }
    _captureMediaRecorderFrame(stepIntervalMs) {
        if (!this._isRecording || this._activeRecorderEngine !== RECORDER_ENGINE.NATIVE_MEDIARECORDER) return;
        this._advanceCaptureTimelineMs(stepIntervalMs);
        const encodeStart = this._perfNow();
        try {
            if (this._mediaRecorderUsesCaptureCanvas) {
                const level = this._getCaptureLevel();
                this._ensureMediaRecorderCaptureSurface(this._resolveCaptureResolutionScale(level));
            }
            if (this._mediaRecorderSupportsRequestFrame && this._mediaRecorderVideoTrack?.requestFrame) {
                this._mediaRecorderVideoTrack.requestFrame();
            }
            this._frameCount += 1;
            this._captureEncodedFrames += 1;
            this._recordCaptureTimestampUs(this._captureTimestampUs);
        } catch {
            this._captureDroppedFrames += 1;
        } finally {
            const durationMs = this._perfNow() - encodeStart;
            this.runtimePerfProfiler?.recordSubsystemDuration?.('recorder_encode', durationMs);
        }
    }
    captureRenderedFrame(renderDelta = null) {
        if (!this._isRecording) return;
        if (
            this._activeRecorderEngine !== RECORDER_ENGINE.NATIVE_WEBCODECS
            && this._activeRecorderEngine !== RECORDER_ENGINE.NATIVE_MEDIARECORDER
        ) {
            return;
        }
        if (
            this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_WEBCODECS
            && (!this._videoEncoder || this._videoEncoder.state !== 'configured')
        ) {
            return;
        }
        const now = this._perfNow();
        if (!(this._captureLastNowMs > 0)) {
            this._captureLastNowMs = now;
            return;
        }
        let deltaMs = now - this._captureLastNowMs;
        this._captureLastNowMs = now;
        if (!(deltaMs > 0)) {
            deltaMs = Math.max(1, Math.round(toFiniteNumber(renderDelta, 1 / 60) * 1000));
        }
        const unclampedDeltaMs = deltaMs;
        deltaMs = Math.min(250, deltaMs);
        this._advanceCaptureTimelineMs(Math.max(0, unclampedDeltaMs - deltaMs));
        this._captureAccumulatorMs += deltaMs;
        let syntheticQueueSize = 0;
        if (this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_MEDIARECORDER) {
            syntheticQueueSize = this._resolveSyntheticQueueSizeFromRenderDelta(
                Math.max(deltaMs, this._captureAccumulatorMs)
            );
            this._updateCaptureLoadLevel(syntheticQueueSize);
        }
        const effectiveFps = this._resolveEffectiveCaptureFps();
        const stepIntervalMs = 1000 / effectiveFps;
        this._dropCaptureBacklog(stepIntervalMs);
        if (
            this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_MEDIARECORDER
            && !this._mediaRecorderSupportsRequestFrame
            && syntheticQueueSize >= ENCODE_QUEUE_DROP_LIMIT
        ) {
            const retainedAccumulatorMs = Math.min(this._captureAccumulatorMs, stepIntervalMs);
            const discardedAccumulatorMs = Math.max(0, this._captureAccumulatorMs - retainedAccumulatorMs);
            this._captureAccumulatorMs = retainedAccumulatorMs;
            this._captureDroppedFrames += 1;
            this._advanceCaptureTimelineMs(discardedAccumulatorMs);
            return;
        }
        let captureSteps = 0;
        while (
            this._captureAccumulatorMs >= stepIntervalMs
            && captureSteps < MAX_CAPTURE_STEPS_PER_RENDER
        ) {
            this._captureAccumulatorMs -= stepIntervalMs;
            if (this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_WEBCODECS) {
                this._captureWebCodecsFrame(stepIntervalMs);
            } else {
                this._captureMediaRecorderFrame(stepIntervalMs);
            }
            captureSteps += 1;
        }
        this._dropCaptureBacklog(stepIntervalMs);
    }
    getRecordingDiagnostics() {
        const level = this._getCaptureLevel();
        const sourceCanvas = this._getCaptureCanvas();
        const cinematicQualityProfile = isCinematicCaptureProfile(this.recordingCaptureSettings?.profile)
            ? { ...RECORDING_CINEMATIC_QUALITY_PROFILE }
            : null;
        const lastExport = this._lastExport
            ? {
                recorderEngine: this._lastExport.recorderEngine || null,
                masterContainer: this._lastExport.masterContainer || null,
                deliveryContainer: this._lastExport.deliveryContainer || null,
                transcodeApplied: this._lastExport.transcodeApplied === true,
                transcodeFailureCode: this._lastExport.transcodeFailureCode || null,
                masterPath: this._lastExport.masterPath || null,
                deliveryPath: this._lastExport.deliveryPath || null,
                warnings: Array.isArray(this._lastExport.warnings)
                    ? this._lastExport.warnings.slice()
                    : [],
            }
            : null;
        return {
            recording: this._isRecording,
            recorderEngine: this._activeRecorderEngine,
            captureProfile: this.recordingCaptureSettings?.profile || null,
            hudMode: this.recordingCaptureSettings?.hudMode || null,
            captureExportPreset: this.recordingCaptureSettings?.exportPreset || null,
            captureFps: this.captureFps,
            activeCaptureFps: this._getActiveCaptureFps(),
            captureTargetFps: this._resolveRecordingTargetFps(),
            effectiveCaptureFps: this._resolveEffectiveCaptureFps(),
            captureResolutionScale: this._resolveCaptureResolutionScale(level),
            captureLevel: this._captureLevelIndex,
            captureSourceWidth: Math.max(0, Math.floor(toFiniteNumber(sourceCanvas?.width, 0))),
            captureSourceHeight: Math.max(0, Math.floor(toFiniteNumber(sourceCanvas?.height, 0))),
            cinematicQualityProfile,
            lastExport,
            requestFrameSupported: this._mediaRecorderSupportsRequestFrame,
            encodeQueueSoftLimit: ENCODE_QUEUE_SOFT_LIMIT,
            encodeQueueDropLimit: ENCODE_QUEUE_DROP_LIMIT,
            droppedFrames: this._captureDroppedFrames,
            encodedFrames: this._captureEncodedFrames,
            maxEncodeQueueSize: this._captureMaxEncodeQueueSize,
            backpressureEvents: this._captureBackpressureEvents,
            frameIntervalStats: this._getFrameIntervalStats()
                ? { ...this._lastFrameIntervalStats }
                : null,
        };
    }
    getLifecycleEvents() {
        return this._lifecycleEvents.slice();
    }
    getLastExportMeta() {
        if (!this._lastExport) return null;
        return {
            fileName: this._lastExport.fileName,
            downloadFileName: this._lastExport.downloadFileName,
            filePath: this._lastExport.filePath || null,
            mimeType: this._lastExport.mimeType,
            container: this._lastExport.container || null,
            sizeBytes: this._lastExport.sizeBytes,
            startedAt: this._lastExport.startedAt,
            endedAt: this._lastExport.endedAt,
            durationMs: this._lastExport.durationMs,
            trigger: this._lastExport.trigger,
            recorderEngine: this._lastExport.recorderEngine || null,
            captureProfile: this._lastExport.captureProfile || null,
            hudMode: this._lastExport.hudMode || null,
            captureExportPreset: this._lastExport.captureExportPreset || null,
            masterContainer: this._lastExport.masterContainer || null,
            deliveryContainer: this._lastExport.deliveryContainer || null,
            transcodeApplied: this._lastExport.transcodeApplied === true,
            nativeTranscodeCapability: this._lastExport.nativeTranscodeCapability
                ? { ...this._lastExport.nativeTranscodeCapability }
                : null,
            transcodeFailureCode: this._lastExport.transcodeFailureCode || null,
            masterPath: this._lastExport.masterPath || null,
            deliveryPath: this._lastExport.deliveryPath || null,
            failureReason: this._lastExport.failureReason || null,
            warnings: Array.isArray(this._lastExport.warnings)
                ? this._lastExport.warnings.slice()
                : [],
            saveCapabilityId: this._lastExport.saveCapabilityId || null,
            saveCode: this._lastExport.saveCode || null,
            exportMatrix: this._lastExport.exportMatrix
                ? { ...this._lastExport.exportMatrix }
                : null,
            frameIntervalStats: this._lastExport.frameIntervalStats
                ? { ...this._lastExport.frameIntervalStats }
                : null,
            recorderDiagnostics: this._lastExport.recorderDiagnostics
                ? { ...this._lastExport.recorderDiagnostics }
                : null,
            timestampValidation: this._lastExport.timestampValidation
                ? { ...this._lastExport.timestampValidation }
                : null,
            exportStatus: this._lastExport.exportStatus
                ? { ...this._lastExport.exportStatus }
                : null,
        };
    }
    notifyLifecycleEvent(type, context = null) {
        const eventType = String(type || '').trim();
        if (!eventType) return null;
        const event = {
            version: this.contractVersion,
            type: eventType,
            timestampMs: this.now(),
            context: context && typeof context === 'object' ? { ...context } : null,
        };
        this._lifecycleEvents.push(event);
        if (this._lifecycleEvents.length > 24) {
            this._lifecycleEvents.shift();
        }
        if (eventType === LIFECYCLE_EVENT_TYPES.MATCH_STARTED && this.autoRecordingEnabled) {
            this.startRecording(event);
            return event;
        }
        if (eventType === LIFECYCLE_EVENT_TYPES.MATCH_ENDED || eventType === LIFECYCLE_EVENT_TYPES.MENU_OPENED) {
            this.settleRecording(event).catch((error) => {
                this.logger?.warn?.('[MediaRecorderSystem] settle failed after lifecycle event', error);
            });
            return event;
        }
        if (eventType === LIFECYCLE_EVENT_TYPES.RECORDING_REQUESTED) {
            const command = String(context?.command || 'toggle').toLowerCase();
            if (command === 'start') {
                this.startRecording(event);
            } else if (command === 'stop') {
                this.stopRecording(event).catch((error) => {
                    this.logger?.warn?.('[MediaRecorderSystem] stop failed for recording request', error);
                });
            } else if (this.isRecording()) {
                this.stopRecording(event).catch((error) => {
                    this.logger?.warn?.('[MediaRecorderSystem] toggle-stop failed', error);
                });
            } else {
                this.startRecording(event);
            }
        }
        return event;
    }
    _buildStartResult(started, reason, extra = null) {
        const result = {
            action: 'start',
            ok: !!started,
            started: !!started,
            reason: String(reason || (started ? 'started' : 'unknown')),
        };
        if (extra && typeof extra === 'object') {
            Object.assign(result, extra);
        }
        return result;
    }
    _buildStopResult(stopped, reason, extra = null) {
        const result = {
            action: 'stop',
            ok: !!stopped,
            stopped: !!stopped,
            reason: String(reason || (stopped ? 'stopped' : 'unknown')),
        };
        if (extra && typeof extra === 'object') {
            Object.assign(result, extra);
        }
        return result;
    }
    _resolveRecordingDimensions(scale = 1) {
        const profile = this.recordingCaptureSettings?.profile;
        const sourceCanvas = this._getCaptureCanvas();
        const rawWidth = Number(sourceCanvas?.width || 0);
        const rawHeight = Number(sourceCanvas?.height || 0);
        const resolutionScale = Math.max(0.2, Math.min(1, toFiniteNumber(scale, 1)));
        let width = Math.max(16, Math.floor(rawWidth * resolutionScale));
        let height = Math.max(16, Math.floor(rawHeight * resolutionScale));
        const cinematicProfileActive = isCinematicCaptureProfile(profile);
        if (cinematicProfileActive) {
            const cinematicMaxWidth = Math.max(
                16,
                toPositiveInt(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxWidth, 1920, 16, 8192)
            ) & ~1;
            const cinematicMaxHeight = Math.max(
                16,
                toPositiveInt(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxHeight, 1080, 16, 8192)
            ) & ~1;
            width = Math.min(width, cinematicMaxWidth);
            height = Math.min(height, cinematicMaxHeight);
            width = Math.max(16, width) & ~1;
            height = Math.max(16, height) & ~1;
        } else {
            // H.264 macroblock alignment: round to nearest multiple of 16.
            width = Math.round(width / 16) * 16 || 16;
            height = Math.round(height / 16) * 16 || 16;
        }
        // Clamp extreme aspect ratios (>3:1) â€” some encoders reject these.
        const MAX_ASPECT = 3;
        if (width > height * MAX_ASPECT) {
            width = cinematicProfileActive
                ? (Math.max(16, Math.floor(height * MAX_ASPECT)) & ~1)
                : ((Math.round((height * MAX_ASPECT) / 16) * 16) || 16);
        } else if (height > width * MAX_ASPECT) {
            height = cinematicProfileActive
                ? (Math.max(16, Math.floor(width * MAX_ASPECT)) & ~1)
                : ((Math.round((width * MAX_ASPECT) / 16) * 16) || 16);
        }
        return { width, height };
    }
    _resolveRecordingBitrate(width, height) {
        const pixelCount = Math.max(1, toPositiveInt(width, 1) * toPositiveInt(height, 1));
        if (isCinematicCaptureProfile(this.recordingCaptureSettings?.profile)) {
            const bitrate1080p = toPositiveInt(
                RECORDING_CINEMATIC_QUALITY_PROFILE?.bitrate1080p,
                18_000_000,
                1,
                250_000_000
            );
            const bitrate720p = toPositiveInt(
                RECORDING_CINEMATIC_QUALITY_PROFILE?.bitrate720p,
                14_000_000,
                1,
                250_000_000
            );
            const bitrateBase = toPositiveInt(
                RECORDING_CINEMATIC_QUALITY_PROFILE?.bitrateBase,
                10_000_000,
                1,
                250_000_000
            );
            if (pixelCount >= (1920 * 1080)) {
                return bitrate1080p;
            }
            if (pixelCount >= (1280 * 720)) {
                return bitrate720p;
            }
            return bitrateBase;
        }
        return 8_000_000;
    }
    _buildWebCodecsEncoderConfig(width, height, candidate) {
        const codec = typeof candidate === 'object' ? candidate.codec : candidate;
        const family = typeof candidate === 'object' ? candidate.family : 'avc';
        const config = {
            codec,
            width,
            height,
            hardwareAcceleration: 'prefer-hardware',
            bitrate: this._resolveRecordingBitrate(width, height),
            framerate: this._getActiveCaptureFps(),
        };
        // AVC-specific: annex-b format needed for mp4-muxer
        if (family === 'avc') {
            config.avc = { format: 'avc' };
        }
        return config;
    }
    async _startWithWebCodecs(trigger, support) {
        const targetCaptureFps = this._resolveRecordingTargetFps();
        const { width, height } = this._resolveRecordingDimensions();
        const bitrate = this._resolveRecordingBitrate(width, height);
        const strategy = new WebCodecsRecorderEngine({
            logger: this.logger,
            globalScope: this._globalScope,
            width,
            height,
            frameRate: targetCaptureFps,
            bitrate,
        });
        const initializeResult = await strategy.initialize();
        if (!initializeResult?.ok) {
            strategy.dispose?.();
            this._setActiveRecorderStrategy(null);
            return this._buildStartResult(false, initializeResult?.reason || 'encoder_creation_failed', {
                error: initializeResult?.error,
                support,
            });
        }
        this.logger?.info?.(
            `[MediaRecorderSystem] Using codec ${initializeResult?.codec || 'unknown'} (muxer: ${initializeResult?.muxerCodec || 'unknown'}) for ${width}x${height}`
        );
        this._setActiveRecorderStrategy(strategy);
        this._isRecording = true;
        this._activeRecorderEngine = RECORDER_ENGINE.NATIVE_WEBCODECS;
        this._activeMimeType = initializeResult?.mimeType || DEFAULT_MIME_TYPE;
        this._activeCaptureFps = targetCaptureFps;
        this._frameCount = 0;
        this._encoderWidth = width;
        this._encoderHeight = height;
        this._resetWebCodecsCaptureState(1);
        this._activeRecording = {
            startedAt: this.now(),
            trigger: trigger || null,
            captureProfile: this.recordingCaptureSettings?.profile || null,
            hudMode: this.recordingCaptureSettings?.hudMode || null,
            captureExportPreset: this.recordingCaptureSettings?.exportPreset || null,
        };
        this._notifyRecordingStateChange(true);
        return this._buildStartResult(true, 'started', {
            mimeType: this._activeMimeType,
            timestampMs: this._activeRecording.startedAt,
            recorderEngine: this._activeRecorderEngine,
            captureFps: targetCaptureFps,
            captureProfile: this._activeRecording.captureProfile,
            hudMode: this._activeRecording.hudMode,
            captureExportPreset: this._activeRecording.captureExportPreset,
        });
    }
    async _startWithMediaRecorder(trigger, support, fallbackFromReason = null) {
        const sourceCanvas = this._getCaptureCanvas();
        if (!sourceCanvas || typeof sourceCanvas.captureStream !== 'function') {
            return this._buildStartResult(false, 'missing-capture-stream', { support });
        }
        const targetCaptureFps = this._resolveRecordingTargetFps();
        const { width, height } = this._resolveRecordingDimensions();
        // WebCodecs can report MP4 support while MediaRecorder still needs a WebM fallback.
        const preferredMediaRecorderMimeType = fallbackFromReason
            ? (support?.mediaRecorderMimeType || '')
            : (support?.mediaRecorderMimeType || support?.selectedMimeType || '');
        const selectedMimeType = resolveSafeMediaRecorderMimeType(
            this._globalScope,
            preferredMediaRecorderMimeType
        ) || DEFAULT_FALLBACK_MIME_TYPE;
        this._captureLevelIndex = Math.min(2, CAPTURE_LOAD_LEVELS.length - 1);
        const level = this._getCaptureLevel();
        const captureResolutionScale = this._resolveCaptureResolutionScale(level);
        const captureStreamSource = this._ensureMediaRecorderCaptureSurface(captureResolutionScale);
        const streamSourceCanvas = captureStreamSource && typeof captureStreamSource.captureStream === 'function'
            ? captureStreamSource
            : sourceCanvas;
        this._mediaRecorderUsesCaptureCanvas = streamSourceCanvas !== sourceCanvas;
        const strategy = new NativeMediaRecorderEngine({
            logger: this.logger,
            globalScope: this._globalScope,
            canvas: streamSourceCanvas,
            mimeType: selectedMimeType,
            captureFps: targetCaptureFps,
            videoBitsPerSecond: this._resolveRecordingBitrate(width, height),
        });
        const initializeResult = await strategy.initialize();
        if (!initializeResult?.ok) {
            strategy.dispose?.();
            this._setActiveRecorderStrategy(null);
            return this._buildStartResult(false, 'mediarecorder_creation_failed', {
                error: initializeResult?.error,
                support,
                fallbackFromReason: fallbackFromReason || undefined,
            });
        }
        if (!strategy.start(1000)) {
            strategy.dispose?.();
            this._setActiveRecorderStrategy(null);
            return this._buildStartResult(false, 'mediarecorder_start_failed', {
                support,
                fallbackFromReason: fallbackFromReason || undefined,
            });
        }
        this._setActiveRecorderStrategy(strategy);
        this._startMediaRecorderPump(captureResolutionScale, targetCaptureFps);
        this._isRecording = true;
        this._activeRecorderEngine = RECORDER_ENGINE.NATIVE_MEDIARECORDER;
        this._activeMimeType = initializeResult?.mimeType || selectedMimeType || DEFAULT_FALLBACK_MIME_TYPE;
        this._activeCaptureFps = targetCaptureFps;
        this._frameCount = 0;
        this._resetWebCodecsCaptureState(Math.min(2, CAPTURE_LOAD_LEVELS.length - 1));
        this._activeRecording = {
            startedAt: this.now(),
            trigger: trigger || null,
            captureProfile: this.recordingCaptureSettings?.profile || null,
            hudMode: this.recordingCaptureSettings?.hudMode || null,
            captureExportPreset: this.recordingCaptureSettings?.exportPreset || null,
        };
        this._notifyRecordingStateChange(true);
        return this._buildStartResult(true, 'started', {
            mimeType: this._activeMimeType,
            timestampMs: this._activeRecording.startedAt,
            recorderEngine: this._activeRecorderEngine,
            fallbackFromReason: fallbackFromReason || undefined,
            captureFps: targetCaptureFps,
            captureProfile: this._activeRecording.captureProfile,
            hudMode: this._activeRecording.hudMode,
            captureExportPreset: this._activeRecording.captureExportPreset,
        });
    }
    async startRecording(trigger = null) {
        if (this._pendingStop) {
            return this._buildStartResult(false, 'stop_pending');
        }
        if (this.isRecording()) {
            return this._buildStartResult(false, 'already_recording');
        }
        this._resolveCaptureCanvas();
        const support = this.getSupportState();
        if (!support.canRecord) {
            this.logger?.warn?.('[MediaRecorderSystem] recording unsupported on this runtime', support);
            return this._buildStartResult(false, 'unsupported', { support });
        }
        if (support.recorderEngine === RECORDER_ENGINE.NATIVE_WEBCODECS) {
            const webCodecsResult = await this._startWithWebCodecs(trigger, support);
            if (webCodecsResult.started) {
                return webCodecsResult;
            }
            if (support.hasMediaRecorder) {
                this.logger?.warn?.('[MediaRecorderSystem] WebCodecs start failed, falling back to MediaRecorder', webCodecsResult);
                return this._startWithMediaRecorder(trigger, support, webCodecsResult.reason);
            }
            return webCodecsResult;
        }
        if (support.recorderEngine === RECORDER_ENGINE.NATIVE_MEDIARECORDER) {
            return this._startWithMediaRecorder(trigger, support);
        }
        this.logger?.warn?.('[MediaRecorderSystem] no recorder engine available', support);
        return this._buildStartResult(false, 'unsupported_engine', { support });
    }
    async stopRecording(trigger = null) {
        if (this._pendingStop) {
            return this._pendingStop;
        }
        if (!this._isRecording) {
            return this._buildStopResult(false, 'not_recording');
        }
        this._isRecording = false;
        this._pendingStop = new Promise((resolve) => {
            this._activeRecording = {
                ...(this._activeRecording || {}),
                stopTrigger: trigger || null,
                stopResolve: resolve,
            };
        });
        const pendingStop = this._pendingStop;
        try {
            if (this._activeRecorderEngine === RECORDER_ENGINE.NATIVE_MEDIARECORDER) {
                this.logger?.info?.(`[MediaRecorderSystem] stopping MediaRecorder (state=${this._mediaRecorder?.state}, chunks=${this._mediaRecorderChunks?.length})`);
                if (this._activeRecorderStrategy?.stop) {
                    if (this._mediaRecorderUsesCaptureCanvas) {
                        try {
                            this._ensureMediaRecorderCaptureSurface(this._mediaRecorderPumpResolutionScale);
                        } catch {
                            // Ignore final capture-copy failures on stop.
                        }
                    }
                    const strategyStopResult = await this._activeRecorderStrategy.stop();
                    this._syncRecorderRuntimeState();
                    if (!strategyStopResult?.ok || !(strategyStopResult.blob instanceof Blob)) {
                        const result = this._buildStopResult(false, strategyStopResult?.reason || 'mediarecorder_stop_failed', {
                            error: strategyStopResult?.error,
                        });
                        const resolve = this._activeRecording?.stopResolve;
                        this._cleanupRuntimeRecorder();
                        this._pendingStop = null;
                        if (typeof resolve === 'function') {
                            resolve(result);
                        }
                        return result;
                    }
                    this.logger?.info?.(
                        `[MediaRecorderSystem] MediaRecorder stopped: chunks=${this._mediaRecorderChunks?.length || 0}, blob.size=${strategyStopResult.blob.size}, mimeType=${strategyStopResult.mimeType || this._activeMimeType}`
                    );
                    await this._finalizeBlobExport(
                        strategyStopResult.blob,
                        strategyStopResult.mimeType || this._activeMimeType || DEFAULT_FALLBACK_MIME_TYPE
                    );
                    return pendingStop;
                }
                if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') {
                    const result = this._buildStopResult(false, 'mediarecorder_inactive');
                    const resolve = this._activeRecording?.stopResolve;
                    this._cleanupRuntimeRecorder();
                    this._pendingStop = null;
                    if (typeof resolve === 'function') {
                        resolve(result);
                    }
                    return result;
                }
                if (this._mediaRecorderUsesCaptureCanvas) {
                    try {
                        this._ensureMediaRecorderCaptureSurface(this._mediaRecorderPumpResolutionScale);
                    } catch {
                        // Ignore final capture-copy failures on stop.
                    }
                }
                if (this._mediaRecorderVideoTrack?.requestFrame) {
                    try {
                        this._mediaRecorderVideoTrack.requestFrame();
                    } catch {
                        // Ignore final-frame request errors on stop.
                    }
                }
                if (typeof this._mediaRecorder.requestData === 'function') {
                    try {
                        this._mediaRecorder.requestData();
                    } catch {
                        // Ignore flush failures and still attempt final stop.
                    }
                }
                this._mediaRecorder.stop();
                return pendingStop;
            }
            if (this._activeRecorderStrategy?.stop) {
                this.logger?.info?.(
                    `[MediaRecorderSystem] flush encoder (state=${this._videoEncoder?.state}, frameCount=${this._frameCount}, encodeQueueSize=${this._videoEncoder?.encodeQueueSize})`
                );
                const strategyStopResult = await this._activeRecorderStrategy.stop();
                this._syncRecorderRuntimeState();
                if (!strategyStopResult?.ok || !(strategyStopResult.blob instanceof Blob)) {
                    const result = this._buildStopResult(false, strategyStopResult?.reason || 'muxer_null', {
                        error: strategyStopResult?.error,
                    });
                    const resolve = this._activeRecording?.stopResolve;
                    this._cleanupRuntimeRecorder();
                    this._pendingStop = null;
                    if (typeof resolve === 'function') {
                        resolve(result);
                    }
                    return result;
                }
                this.logger?.info?.(
                    `[MediaRecorderSystem] muxer finalized (bufferSize=${strategyStopResult.bufferSize || strategyStopResult.blob.size || 0}, frameCount=${this._frameCount})`
                );
                await this._finalizeBlobExport(
                    strategyStopResult.blob,
                    strategyStopResult.mimeType || DEFAULT_MIME_TYPE
                );
                return pendingStop;
            } else {
                if (this._videoEncoder) {
                    this.logger?.info?.(`[MediaRecorderSystem] flush encoder (state=${this._videoEncoder.state}, frameCount=${this._frameCount}, encodeQueueSize=${this._videoEncoder.encodeQueueSize})`);
                    await this._videoEncoder.flush();
                    this._videoEncoder.close();
                }
                if (this._muxer) {
                    this._muxer.finalize();
                    const bufferSize = this._muxer?.target?.buffer?.byteLength || 0;
                    this.logger?.info?.(`[MediaRecorderSystem] muxer finalized (bufferSize=${bufferSize}, frameCount=${this._frameCount})`);
                    await this._handleRecorderStop();
                } else {
                    const result = this._buildStopResult(false, 'muxer_null');
                    const resolve = this._activeRecording?.stopResolve;
                    this._cleanupRuntimeRecorder();
                    this._pendingStop = null;
                    if (typeof resolve === 'function') {
                        resolve(result);
                    }
                    return result;
                }
            }
        } catch (error) {
            const resolve = this._activeRecording?.stopResolve;
            const result = this._buildStopResult(false, 'stop_failed', { error });
            this._cleanupRuntimeRecorder();
            this._pendingStop = null;
            if (typeof resolve === 'function') {
                resolve(result);
            }
            return result;
        }
        return pendingStop;
    }
    async settleRecording(trigger = null) {
        if (this._pendingStop) {
            return this._pendingStop;
        }
        if (this._isRecording) {
            return this.stopRecording(trigger || { type: 'settle_recording' });
        }
        return this._buildStopResult(false, 'not_recording');
    }
    async _finalizeBlobExport(blob, mimeType = DEFAULT_MIME_TYPE) {
        return finalizeMediaRecorderBlobExport(this, blob, mimeType);
    }
    async _handleRecorderStop() {
        const buffer = this._muxer?.target?.buffer;
        const blob = new Blob([buffer || new ArrayBuffer(0)], { type: DEFAULT_MIME_TYPE });
        await this._finalizeBlobExport(blob, DEFAULT_MIME_TYPE);
    }
    _cleanupRuntimeRecorder() {
        this._isRecording = false;
        this._stopMediaRecorderPump();
        if (this._activeRecorderStrategy?.dispose) {
            try {
                this._activeRecorderStrategy.dispose();
            } catch {
                // Ignore strategy cleanup errors during recorder teardown.
            }
        } else if (this._mediaRecorderStream && typeof this._mediaRecorderStream.getTracks === 'function') {
            for (const track of this._mediaRecorderStream.getTracks()) {
                try {
                    track.stop();
                } catch {
                    // Ignore track-stop cleanup errors.
                }
            }
        }
        this._muxer = this._videoEncoder = null;
        this._encoderWidth = this._encoderHeight = 0;
        this._mediaRecorder = this._mediaRecorderChunks = null;
        this._mediaRecorderStream = this._mediaRecorderVideoTrack = null;
        this._mediaRecorderSupportsRequestFrame = false;
        this._mediaRecorderUsesCaptureCanvas = false;
        this._mediaRecorderPumpResolutionScale = 1;
        this._activeCaptureFps = this.captureFps;
        this._activeRecorderStrategy = this._activeRecording = null;
        this._frameCount = 0;
        this._captureCanvas = this._captureCanvasCtx = null;
        this._captureCanvasWidth = this._captureCanvasHeight = 0;
        this._resolvedCaptureCanvas = null;
        this._resetWebCodecsCaptureState();
        this._activeMimeType = DEFAULT_MIME_TYPE;
        this._activeRecorderEngine = RECORDER_ENGINE.NONE;
        this._notifyRecordingStateChange(false);
    }
    dispose() {
        if (this._pendingStop || this._isRecording) this.settleRecording({ type: 'dispose' }).catch(() => {
            this._cleanupRuntimeRecorder();
            this._pendingStop = null;
        });
        if (this._lastExport?.objectUrl) {
            URL.revokeObjectURL(this._lastExport.objectUrl);
        }
        this._lastExport = null;
        this._lifecycleEvents.length = 0;
        if (!this._pendingStop && !this._isRecording) {
            this._cleanupRuntimeRecorder();
            this._pendingStop = null;
        }
    }
}
