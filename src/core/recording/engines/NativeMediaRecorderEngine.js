import {
    DEFAULT_FALLBACK_MIME_TYPE,
    resolveGlobalScope,
    resolveSafeMediaRecorderMimeType,
} from '../MediaRecorderSupport.js';
import { toPositiveInt } from '../MediaRecorderSystemOps.js';

const NATIVE_MEDIARECORDER_STOP_TIMEOUT_MS = 4000;

export class NativeMediaRecorderEngine {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.globalScope = resolveGlobalScope(options.globalScope);
        this.canvas = options.canvas || null;
        this.captureFps = toPositiveInt(options.captureFps, 60);
        this.videoBitsPerSecond = toPositiveInt(options.videoBitsPerSecond, 15_000_000);
        this.mimeType = resolveSafeMediaRecorderMimeType(this.globalScope, options.mimeType) || DEFAULT_FALLBACK_MIME_TYPE;
        this.stopTimeoutMs = Math.max(
            250,
            toPositiveInt(options.stopTimeoutMs, NATIVE_MEDIARECORDER_STOP_TIMEOUT_MS)
        );
        this._mediaRecorder = null;
        this._mediaRecorderChunks = [];
        this._mediaRecorderStream = null;
        this._mediaRecorderVideoTrack = null;
        this._mediaRecorderSupportsRequestFrame = false;
        this._isRecording = false;
    }

    getRuntimeState() {
        return {
            mediaRecorder: this._mediaRecorder,
            mediaRecorderChunks: this._mediaRecorderChunks,
            mediaRecorderStream: this._mediaRecorderStream,
            mediaRecorderVideoTrack: this._mediaRecorderVideoTrack,
            mediaRecorderSupportsRequestFrame: this._mediaRecorderSupportsRequestFrame,
        };
    }

    async initialize() {
        if (this._mediaRecorder) {
            return {
                ok: true,
                mimeType: this.mimeType,
                requestFrameSupported: this._mediaRecorderSupportsRequestFrame,
            };
        }
        const MediaRecorderCtor = this.globalScope?.MediaRecorder;
        if (typeof MediaRecorderCtor !== 'function') {
            return { ok: false, reason: 'missing-media-recorder' };
        }
        if (!this.canvas || typeof this.canvas.captureStream !== 'function') {
            return { ok: false, reason: 'missing-capture-stream' };
        }

        try {
            this._mediaRecorderChunks = [];
            this._mediaRecorderStream = this.canvas.captureStream(this.captureFps);
            this._mediaRecorderVideoTrack = typeof this._mediaRecorderStream?.getVideoTracks === 'function'
                ? this._mediaRecorderStream.getVideoTracks()[0] || null
                : null;
            this._mediaRecorderSupportsRequestFrame = !!(
                this._mediaRecorderVideoTrack
                && typeof this._mediaRecorderVideoTrack.requestFrame === 'function'
            );
            const recorderOptions = this.mimeType
                ? {
                    mimeType: this.mimeType,
                    videoBitsPerSecond: this.videoBitsPerSecond,
                }
                : {
                    videoBitsPerSecond: this.videoBitsPerSecond,
                };
            this._mediaRecorder = new MediaRecorderCtor(this._mediaRecorderStream, recorderOptions);
            this._mediaRecorder.ondataavailable = (event) => {
                const chunk = event?.data;
                if (chunk && Number(chunk.size) > 0) {
                    this._mediaRecorderChunks.push(chunk);
                }
            };
            this._mediaRecorder.onerror = (event) => {
                this.logger?.error?.('[NativeMediaRecorderEngine] MediaRecorder error', event?.error || event);
            };
            return {
                ok: true,
                mimeType: this.mimeType,
                requestFrameSupported: this._mediaRecorderSupportsRequestFrame,
            };
        } catch (error) {
            this.logger?.warn?.('[NativeMediaRecorderEngine] initialize failed', error);
            this.dispose();
            return { ok: false, reason: 'mediarecorder_creation_failed', error };
        }
    }

    start(timeslice = 1000) {
        if (!this._mediaRecorder || this._isRecording) {
            return false;
        }
        try {
            this._mediaRecorder.start(toPositiveInt(timeslice, 1000));
            this._isRecording = true;
            return true;
        } catch (error) {
            this.logger?.warn?.('[NativeMediaRecorderEngine] start failed', error);
            return false;
        }
    }

    isRecording() {
        return this._isRecording;
    }

    requestFrame() {
        if (!this._mediaRecorderSupportsRequestFrame || !this._mediaRecorderVideoTrack) {
            return false;
        }
        try {
            this._mediaRecorderVideoTrack.requestFrame();
            return true;
        } catch (error) {
            this.logger?.warn?.('[NativeMediaRecorderEngine] requestFrame failed', error);
            return false;
        }
    }

    _attachStopHandler(handler) {
        if (!this._mediaRecorder || typeof handler !== 'function') {
            return () => {};
        }
        if (typeof this._mediaRecorder.addEventListener === 'function') {
            this._mediaRecorder.addEventListener('stop', handler, { once: true });
            return () => {
                this._mediaRecorder?.removeEventListener?.('stop', handler);
            };
        }

        const previousOnStop = this._mediaRecorder.onstop;
        const wrappedHandler = (...args) => {
            if (typeof previousOnStop === 'function') {
                previousOnStop.apply(this._mediaRecorder, args);
            }
            handler(...args);
        };
        this._mediaRecorder.onstop = wrappedHandler;
        return () => {
            if (this._mediaRecorder?.onstop === wrappedHandler) {
                this._mediaRecorder.onstop = previousOnStop || null;
            }
        };
    }

    async stop() {
        if (!this._mediaRecorder || !this._isRecording) {
            return { ok: false, reason: 'not-recording' };
        }

        return new Promise((resolve) => {
            let settled = false;
            let detachStopHandler = () => {};
            const timeoutHandle = this.globalScope?.setTimeout?.(() => {
                this.logger?.warn?.('[NativeMediaRecorderEngine] stop timed out, resolving with partial blob', {
                    timeoutMs: this.stopTimeoutMs,
                    chunkCount: this._mediaRecorderChunks?.length || 0,
                });
                try {
                    if (typeof this._mediaRecorder?.requestData === 'function') {
                        this._mediaRecorder.requestData();
                    }
                } catch {
                    // Ignore final data flush failures during timeout fallback.
                }
                finalize({
                    partial: true,
                    partialReason: 'stop_timeout',
                });
            }, this.stopTimeoutMs);

            const finalize = (extra = null) => {
                if (settled) return;
                settled = true;
                if (typeof this.globalScope?.clearTimeout === 'function' && timeoutHandle) {
                    this.globalScope.clearTimeout(timeoutHandle);
                }
                detachStopHandler();
                const mimeType = this.mimeType
                    || this._mediaRecorder?.mimeType
                    || this._mediaRecorderChunks?.[0]?.type
                    || DEFAULT_FALLBACK_MIME_TYPE;
                const blob = new Blob(this._mediaRecorderChunks || [], { type: mimeType });
                this._mediaRecorderChunks = [];
                this._isRecording = false;
                const result = {
                    ok: true,
                    blob,
                    mimeType,
                };
                if (extra && typeof extra === 'object') {
                    Object.assign(result, extra);
                }
                resolve(result);
            };

            detachStopHandler = this._attachStopHandler(() => {
                finalize();
            });

            try {
                this.requestFrame();
            } catch {
                // Ignore final requestFrame failures during stop.
            }

            try {
                if (typeof this._mediaRecorder.requestData === 'function') {
                    this._mediaRecorder.requestData();
                }
            } catch {
                // Ignore data flush failures and still stop the recorder.
            }

            try {
                this._mediaRecorder.stop();
            } catch (error) {
                this.logger?.warn?.('[NativeMediaRecorderEngine] stop failed', error);
                if (typeof this.globalScope?.clearTimeout === 'function' && timeoutHandle) {
                    this.globalScope.clearTimeout(timeoutHandle);
                }
                detachStopHandler();
                this._isRecording = false;
                resolve({ ok: false, reason: 'stop_failed', error });
            }
        });
    }

    dispose() {
        if (this._mediaRecorderStream && typeof this._mediaRecorderStream.getTracks === 'function') {
            for (const track of this._mediaRecorderStream.getTracks()) {
                try {
                    track.stop();
                } catch {
                    // Ignore track-stop cleanup errors.
                }
            }
        }
        this._mediaRecorder = null;
        this._mediaRecorderChunks = [];
        this._mediaRecorderStream = null;
        this._mediaRecorderVideoTrack = null;
        this._mediaRecorderSupportsRequestFrame = false;
        this._isRecording = false;
    }
}
