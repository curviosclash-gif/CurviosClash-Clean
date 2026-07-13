// @ts-nocheck
import * as Mp4MuxerModule from 'mp4-muxer';
import {
    DEFAULT_MIME_TYPE,
    WEB_CODECS_CODEC_CANDIDATES,
    resolveGlobalScope,
} from '../MediaRecorderSupport.js';
import { toPositiveInt } from '../MediaRecorderSystemOps.js';

const Mp4Muxer = Mp4MuxerModule;
const STOP_FLUSH_TIMEOUT_MS = 2000;
const STOP_QUEUE_POLL_MS = 16;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFlushTimeoutError(timeoutMs, queueSize = 0) {
    const error = new Error(`VideoEncoder.flush timed out after ${timeoutMs}ms (queue=${queueSize})`);
    error.name = 'AbortError';
    return error;
}

export class WebCodecsRecorderEngine {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.globalScope = resolveGlobalScope(options.globalScope);
        this.width = toPositiveInt(options.width, 1920);
        this.height = toPositiveInt(options.height, 1080);
        this.bitrate = toPositiveInt(options.bitrate, 8_000_000);
        this.frameRate = toPositiveInt(options.frameRate, 60);
        this._muxer = null;
        this._videoEncoder = null;
        this._resolvedCandidate = null;
        this._resolvedConfig = null;
    }

    _buildEncoderConfig(candidate) {
        const codec = typeof candidate === 'object' ? candidate.codec : candidate;
        const family = typeof candidate === 'object' ? candidate.family : 'avc';
        const config = {
            codec,
            width: this.width,
            height: this.height,
            hardwareAcceleration: 'prefer-hardware',
            bitrate: this.bitrate,
            framerate: this.frameRate,
        };
        if (family === 'avc') {
            config.avc = { format: 'avc' };
        }
        return config;
    }

    async initialize() {
        if (this.isReady()) {
            return {
                ok: true,
                mimeType: DEFAULT_MIME_TYPE,
                codec: this._resolvedCandidate?.codec || null,
                muxerCodec: this._resolvedCandidate?.muxerCodec || null,
            };
        }

        const VideoEncoderCtor = this.globalScope?.VideoEncoder;
        const VideoFrameCtor = this.globalScope?.VideoFrame;
        if (typeof VideoEncoderCtor !== 'function') {
            return { ok: false, reason: 'missing-video-encoder' };
        }
        if (typeof VideoFrameCtor !== 'function') {
            return { ok: false, reason: 'missing-video-frame' };
        }

        let resolvedCandidate = null;
        let resolvedConfig = null;
        for (const candidate of WEB_CODECS_CODEC_CANDIDATES) {
            const config = this._buildEncoderConfig(candidate);
            const codec = typeof candidate === 'object' ? candidate.codec : candidate;
            if (typeof VideoEncoderCtor.isConfigSupported === 'function') {
                try {
                    const probe = await VideoEncoderCtor.isConfigSupported(config);
                    if (probe?.supported) {
                        resolvedCandidate = candidate;
                        resolvedConfig = config;
                        break;
                    }
                    this.logger?.info?.(
                        `[WebCodecsRecorderEngine] codec ${codec} not supported (${this.width}x${this.height}), trying next`
                    );
                } catch (error) {
                    this.logger?.info?.(
                        `[WebCodecsRecorderEngine] codec ${codec} probe failed: ${error?.message || error}`
                    );
                }
            } else {
                resolvedCandidate = candidate;
                resolvedConfig = config;
                break;
            }
        }

        if (!resolvedCandidate || !resolvedConfig) {
            return {
                ok: false,
                reason: 'encoder_config_unsupported',
                candidates: WEB_CODECS_CODEC_CANDIDATES,
            };
        }

        try {
            const muxerCodec = typeof resolvedCandidate === 'object' ? /** @type {'avc' | 'vp9'} */ (resolvedCandidate.muxerCodec) : 'avc';
            this._muxer = new Mp4Muxer.Muxer({
                target: new Mp4Muxer.ArrayBufferTarget(),
                video: {
                    codec: muxerCodec,
                    width: this.width,
                    height: this.height,
                },
                fastStart: 'in-memory',
                firstTimestampBehavior: 'offset',
            });
            this._videoEncoder = new VideoEncoderCtor({
                output: (chunk, meta) => this._muxer.addVideoChunk(chunk, meta),
                error: (error) => this.logger?.error?.('[WebCodecsRecorderEngine] VideoEncoder error', error),
            });
            this._videoEncoder.configure(resolvedConfig);
            this._resolvedCandidate = resolvedCandidate;
            this._resolvedConfig = resolvedConfig;
            return {
                ok: true,
                mimeType: DEFAULT_MIME_TYPE,
                codec: typeof resolvedCandidate === 'object' ? resolvedCandidate.codec : resolvedCandidate,
                muxerCodec,
            };
        } catch (error) {
            this.logger?.warn?.('[WebCodecsRecorderEngine] initialize failed', error);
            this.dispose();
            return { ok: false, reason: 'encoder_creation_failed', error };
        }
    }

    isReady() {
        return !!this._videoEncoder && this._videoEncoder.state === 'configured';
    }

    getEncodeQueueSize() {
        return Number(this._videoEncoder?.encodeQueueSize || 0);
    }

    getEncoderState() {
        return this._videoEncoder?.state || 'inactive';
    }

    getRuntimeState() {
        return {
            muxer: this._muxer,
            videoEncoder: this._videoEncoder,
        };
    }

    async _waitForEncodeQueueDrain(timeoutMs = STOP_FLUSH_TIMEOUT_MS) {
        const encoder = this._videoEncoder;
        if (!encoder) return 0;

        const deadline = Date.now() + Math.max(0, timeoutMs);
        let queueSize = Number(encoder.encodeQueueSize || 0);
        while (queueSize > 0 && Date.now() < deadline) {
            await wait(STOP_QUEUE_POLL_MS);
            queueSize = Number(encoder.encodeQueueSize || 0);
        }
        return queueSize;
    }

    async _flushEncoderSafely(timeoutMs = STOP_FLUSH_TIMEOUT_MS) {
        const encoder = this._videoEncoder;
        if (!encoder) {
            return { ok: true, timedOut: false, queueSize: 0 };
        }

        await this._waitForEncodeQueueDrain(Math.max(250, Math.floor(timeoutMs / 2)));
        let timeoutHandle = null;
        try {
            return await Promise.race([
                encoder.flush().then(() => ({
                    ok: true,
                    timedOut: false,
                    queueSize: Number(encoder.encodeQueueSize || 0),
                })),
                new Promise((resolve) => {
                    timeoutHandle = setTimeout(() => {
                        const queueSize = Number(encoder.encodeQueueSize || 0);
                        resolve({
                            ok: false,
                            timedOut: true,
                            queueSize,
                            error: createFlushTimeoutError(timeoutMs, queueSize),
                        });
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    encodeFrame(frameSource, { timestampUs = 0, keyFrame = false } = {}) {
        if (!this.isReady()) {
            return false;
        }
        const VideoFrameCtor = this.globalScope?.VideoFrame;
        if (typeof VideoFrameCtor !== 'function') {
            return false;
        }
        let frame = null;
        try {
            frame = new VideoFrameCtor(frameSource, {
                timestamp: Math.max(0, Math.trunc(timestampUs)),
            });
            this._videoEncoder.encode(frame, { keyFrame: !!keyFrame });
            return true;
        } catch (error) {
            this.logger?.warn?.('[WebCodecsRecorderEngine] encode failed', error);
            return false;
        } finally {
            frame?.close?.();
        }
    }

    async stop() {
        if (!this._muxer) {
            return { ok: false, reason: 'muxer_missing' };
        }
        try {
            let flushState = { ok: true, timedOut: false, queueSize: 0, error: null };
            if (this._videoEncoder) {
                flushState = await this._flushEncoderSafely();
                if (!flushState.ok && !flushState.timedOut) {
                    throw flushState.error;
                }
                if (flushState.timedOut) {
                    this.logger?.warn?.('[WebCodecsRecorderEngine] flush timed out, finalizing partial buffer', {
                        timeoutMs: STOP_FLUSH_TIMEOUT_MS,
                        queueSize: flushState.queueSize,
                    });
                    try {
                        if (typeof this._videoEncoder.reset === 'function' && this._videoEncoder.state === 'configured') {
                            this._videoEncoder.reset();
                        }
                    } catch {
                        // Ignore timeout cleanup errors; partial muxer data is still usable.
                    }
                }
                try {
                    if (typeof this._videoEncoder.close === 'function' && this._videoEncoder.state !== 'closed') {
                        this._videoEncoder.close();
                    }
                } catch {
                    // Ignore close errors after timed-out flush/reset cleanup.
                }
            }
            this._muxer.finalize();
            const buffer = this._muxer?.target?.buffer
                || this._muxer?.target?.getBuffer?.()
                || new ArrayBuffer(0);
            const bufferSize = Number(buffer?.byteLength || 0);
            if (flushState.timedOut && bufferSize <= 0) {
                return {
                    ok: false,
                    reason: 'flush_timeout',
                    error: flushState.error,
                    bufferSize,
                };
            }
            return {
                ok: true,
                blob: new Blob([buffer], { type: DEFAULT_MIME_TYPE }),
                mimeType: DEFAULT_MIME_TYPE,
                bufferSize,
                partial: flushState.timedOut === true,
                partialReason: flushState.timedOut ? 'flush_timeout' : null,
            };
        } catch (error) {
            this.logger?.warn?.('[WebCodecsRecorderEngine] stop failed', error);
            return { ok: false, reason: 'stop_failed', error };
        }
    }

    dispose() {
        try {
            if (this._videoEncoder && this._videoEncoder.state !== 'closed') {
                this._videoEncoder.close();
            }
        } catch {
            // Ignore cleanup errors during recorder teardown.
        }
        this._videoEncoder = null;
        this._muxer = null;
        this._resolvedCandidate = null;
        this._resolvedConfig = null;
    }
}
