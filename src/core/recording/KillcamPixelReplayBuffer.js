const DEFAULT_CAPTURE_FPS = 30;
const DEFAULT_WINDOW_SECONDS = 2.15;
const DEFAULT_MAX_FRAMES = 72;
const DEFAULT_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function createCanvas(documentRef, className = '') {
    const canvas = documentRef?.createElement?.('canvas') || null;
    if (canvas && className) canvas.className = className;
    return canvas;
}

export class KillcamPixelReplayBuffer {
    constructor({
        sourceCanvas = null,
        glContext = null,
        documentRef = globalThis.document,
        now = () => globalThis.performance?.now?.() ?? Date.now(),
        captureFps = DEFAULT_CAPTURE_FPS,
        windowSeconds = DEFAULT_WINDOW_SECONDS,
        maxFrames = DEFAULT_MAX_FRAMES,
        memoryBudgetBytes = DEFAULT_MEMORY_BUDGET_BYTES,
    } = {}) {
        this.sourceCanvas = sourceCanvas || null;
        this.glContext = glContext || null;
        this.documentRef = documentRef || null;
        this.now = typeof now === 'function' ? now : (() => Date.now());
        this.captureIntervalMs = 1000 / Math.max(1, toFiniteNumber(captureFps, DEFAULT_CAPTURE_FPS));
        this.windowMs = Math.max(500, toFiniteNumber(windowSeconds, DEFAULT_WINDOW_SECONDS) * 1000);
        this.maxFrames = Math.max(2, Math.trunc(toFiniteNumber(maxFrames, DEFAULT_MAX_FRAMES)));
        this.memoryBudgetBytes = Math.max(
            8 * 1024 * 1024,
            Math.trunc(toFiniteNumber(memoryBudgetBytes, DEFAULT_MEMORY_BUDGET_BYTES))
        );

        this._captureCanvas = null;
        this._captureContext = null;
        this._overlayCanvas = null;
        this._overlayContext = null;
        this._frames = [];
        this._playbackFrames = [];
        this._lastCaptureRequestAt = -Infinity;
        this._pendingCaptures = 0;
        this._active = false;
        this._sourceDuration = 0;
        this._frameCursor = 0;
        this._generation = 0;
        this._playbackRequestId = 0;
        this._effectiveMaxFrames = this.maxFrames;
        this._lastCaptureError = '';
        this._rowSwapBuffer = null;
    }

    isSupported() {
        return !!this.sourceCanvas
            && !!this.documentRef?.createElement;
    }

    _ensureCaptureSurface(width, height) {
        if (!this._captureCanvas) {
            this._captureCanvas = createCanvas(this.documentRef);
            this._captureContext = this._captureCanvas?.getContext?.('2d', {
                alpha: false,
                willReadFrequently: true,
            }) || null;
        }
        if (!this._captureCanvas || !this._captureContext) return false;
        if (this._captureCanvas.width !== width || this._captureCanvas.height !== height) {
            this._captureCanvas.width = width;
            this._captureCanvas.height = height;
            this._frames.length = 0;
        }
        return true;
    }

    _ensureOverlaySurface(width, height) {
        if (!this._overlayCanvas) {
            this._overlayCanvas = createCanvas(this.documentRef, 'killcam-pixel-replay');
            this._overlayCanvas.setAttribute?.('aria-hidden', 'true');
            const container = this.documentRef?.getElementById?.('game-container')
                || this.sourceCanvas?.parentElement
                || null;
            if (container && this.sourceCanvas?.nextSibling) {
                container.insertBefore(this._overlayCanvas, this.sourceCanvas.nextSibling);
            } else {
                container?.appendChild?.(this._overlayCanvas);
            }
            this._overlayContext = this._overlayCanvas.getContext?.('2d', {
                alpha: false,
                willReadFrequently: false,
            }) || null;
        }
        if (!this._overlayCanvas || !this._overlayContext) return false;
        if (this._overlayCanvas.width !== width || this._overlayCanvas.height !== height) {
            this._overlayCanvas.width = width;
            this._overlayCanvas.height = height;
        }
        return true;
    }

    captureFrame({ force = false, timestamp = this.now() } = {}) {
        if (!this.isSupported() || this._active) return Promise.resolve(null);
        const captureTime = toFiniteNumber(timestamp, this.now());
        const width = Math.max(1, Math.trunc(toFiniteNumber(this.sourceCanvas?.width, 0)));
        const height = Math.max(1, Math.trunc(toFiniteNumber(this.sourceCanvas?.height, 0)));
        if (width <= 1 || height <= 1 || !this._ensureCaptureSurface(width, height)) {
            return Promise.resolve(null);
        }
        const bytesPerFrame = Math.max(4, width * height * 4);
        this._effectiveMaxFrames = Math.max(2, Math.min(
            this.maxFrames,
            Math.floor(this.memoryBudgetBytes / bytesPerFrame)
        ));
        const effectiveCaptureInterval = Math.max(
            this.captureIntervalMs,
            this.windowMs / this._effectiveMaxFrames
        );
        if (!force && captureTime - this._lastCaptureRequestAt < effectiveCaptureInterval) {
            return Promise.resolve(null);
        }
        if (!force && this._pendingCaptures >= 2) return Promise.resolve(null);

        this._lastCaptureRequestAt = captureTime;
        const generation = this._generation;
        this._pendingCaptures += 1;
        const readPromise = this._supportsAsyncWebGlReadback()
            ? this._readWebGlFrameAsync(width, height)
            : Promise.resolve().then(() => this._readCanvasFrame(width, height));
        return readPromise
            .then((imageData) => {
                this._pendingCaptures = Math.max(0, this._pendingCaptures - 1);
                if (!imageData || generation !== this._generation) return null;
                const frame = { imageData, time: captureTime, width, height };
                this._lastCaptureError = '';
                this._insertFrame(frame);
                return frame;
            })
            .catch((error) => {
                this._pendingCaptures = Math.max(0, this._pendingCaptures - 1);
                this._lastCaptureError = String(error?.message || error || 'capture_failed');
                return null;
            });
    }

    _readCanvasFrame(width, height) {
        this._captureContext.clearRect(0, 0, width, height);
        this._captureContext.drawImage(this.sourceCanvas, 0, 0, width, height);
        return this._captureContext.getImageData(0, 0, width, height);
    }

    _supportsAsyncWebGlReadback() {
        const gl = this.glContext;
        return !!gl?.fenceSync
            && !!gl?.clientWaitSync
            && !!gl?.getBufferSubData
            && Number.isFinite(Number(gl?.PIXEL_PACK_BUFFER));
    }

    _readWebGlFrameAsync(width, height) {
        const gl = this.glContext;
        const byteLength = width * height * 4;
        const buffer = gl.createBuffer();
        if (!buffer) return Promise.reject(new Error('pixel_pack_buffer_unavailable'));
        let sync = null;
        try {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
            gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
        } catch (error) {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.deleteBuffer(buffer);
            return Promise.reject(error);
        }
        if (!sync) {
            gl.deleteBuffer(buffer);
            return Promise.reject(new Error('pixel_pack_fence_unavailable'));
        }

        return new Promise((resolve, reject) => {
            const finish = () => {
                try {
                    const imageData = this._captureContext.createImageData(width, height);
                    const pixels = new Uint8Array(
                        imageData.data.buffer,
                        imageData.data.byteOffset,
                        imageData.data.byteLength
                    );
                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
                    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                    this._flipImageDataRows(imageData, width, height);
                    resolve(imageData);
                } catch (error) {
                    reject(error);
                } finally {
                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                    gl.deleteSync(sync);
                    gl.deleteBuffer(buffer);
                }
            };
            const poll = () => {
                const status = gl.clientWaitSync(sync, 0, 0);
                if (status === gl.WAIT_FAILED) {
                    gl.deleteSync(sync);
                    gl.deleteBuffer(buffer);
                    reject(new Error('pixel_pack_fence_failed'));
                    return;
                }
                if (status === gl.TIMEOUT_EXPIRED) {
                    globalThis.setTimeout(poll, 0);
                    return;
                }
                finish();
            };
            poll();
        });
    }

    _flipImageDataRows(imageData, width, height) {
        const rowLength = width * 4;
        if (!this._rowSwapBuffer || this._rowSwapBuffer.length !== rowLength) {
            this._rowSwapBuffer = new Uint8ClampedArray(rowLength);
        }
        const swap = this._rowSwapBuffer;
        for (let topRow = 0; topRow < Math.floor(height / 2); topRow++) {
            const bottomRow = height - topRow - 1;
            const topOffset = topRow * rowLength;
            const bottomOffset = bottomRow * rowLength;
            swap.set(imageData.data.subarray(topOffset, topOffset + rowLength));
            imageData.data.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
            imageData.data.set(swap, bottomOffset);
        }
    }

    _insertFrame(frame) {
        let insertAt = this._frames.length;
        while (insertAt > 0 && this._frames[insertAt - 1].time > frame.time) insertAt--;
        this._frames.splice(insertAt, 0, frame);
        const newestTime = this._frames[this._frames.length - 1]?.time ?? frame.time;
        const cutoff = newestTime - this.windowMs;
        while (this._frames.length > 0 && this._frames[0].time < cutoff) {
            this._frames.shift();
        }
        while (this._frames.length > this._effectiveMaxFrames) {
            this._frames.shift();
        }
    }

    canReplay() {
        if (!this.isSupported() || this._frames.length < 2) return false;
        const first = this._frames[0];
        const last = this._frames[this._frames.length - 1];
        return first.width === last.width
            && first.height === last.height
            && last.time - first.time >= 350;
    }

    async beginPlayback({ terminalFrame = null, sourceWindowSeconds = 2 } = {}) {
        this.clearPlayback();
        const playbackRequestId = this._playbackRequestId;
        const lastFrame = terminalFrame || this._frames[this._frames.length - 1] || null;
        if (!lastFrame) return null;
        const cutoff = lastFrame.time - Math.max(0.5, toFiniteNumber(sourceWindowSeconds, 2)) * 1000;
        const candidates = this._frames.filter((frame) => (
            frame.time <= lastFrame.time
            && frame.width === lastFrame.width
            && frame.height === lastFrame.height
        ));
        let startIndex = 0;
        while (startIndex < candidates.length && candidates[startIndex].time < cutoff) startIndex++;
        if (startIndex > 0) startIndex--;
        const selected = candidates.slice(startIndex);
        if (selected.length < 2) return null;

        if (playbackRequestId !== this._playbackRequestId) {
            return null;
        }
        if (!this._ensureOverlaySurface(lastFrame.width, lastFrame.height)) {
            return null;
        }
        this._frames.length = 0;
        const firstTime = selected[0].time;
        this._playbackFrames = selected.map((frame) => ({
            imageData: frame.imageData,
            time: Math.max(0, (frame.time - firstTime) / 1000),
        }));
        this._sourceDuration = Math.max(
            0.001,
            this._playbackFrames[this._playbackFrames.length - 1].time
        );
        this._frameCursor = 0;
        this._active = true;
        this._overlayCanvas.hidden = false;
        this._overlayCanvas.style.display = 'block';
        this._overlayCanvas.parentElement?.classList?.add?.('killcam-pixel-replay-active');
        this.seekSourceTime(0);
        return {
            sourceDuration: this._sourceDuration,
            frameCount: this._playbackFrames.length,
            width: lastFrame.width,
            height: lastFrame.height,
        };
    }

    seekSourceTime(sourceTime) {
        if (!this._active || this._playbackFrames.length === 0 || !this._overlayContext) {
            return false;
        }
        const safeTime = Math.max(0, Math.min(
            this._sourceDuration,
            toFiniteNumber(sourceTime, 0)
        ));
        if (safeTime < (this._playbackFrames[this._frameCursor]?.time || 0)) {
            this._frameCursor = 0;
        }
        while (
            this._frameCursor < this._playbackFrames.length - 1
            && this._playbackFrames[this._frameCursor + 1].time <= safeTime
        ) {
            this._frameCursor++;
        }
        const frame = this._playbackFrames[this._frameCursor];
        this._overlayContext.putImageData(frame.imageData, 0, 0);
        return true;
    }

    clearPlayback() {
        this._playbackRequestId++;
        this._active = false;
        this._playbackFrames.length = 0;
        this._sourceDuration = 0;
        this._frameCursor = 0;
        if (this._overlayCanvas) {
            this._overlayCanvas.hidden = true;
            this._overlayCanvas.style.display = 'none';
            this._overlayCanvas.parentElement?.classList?.remove?.('killcam-pixel-replay-active');
        }
    }

    resetCapture() {
        this._generation++;
        this.clearPlayback();
        this._frames.length = 0;
        this._lastCaptureRequestAt = -Infinity;
    }

    getState() {
        const firstCapture = this._frames[0]?.time;
        const lastCapture = this._frames[this._frames.length - 1]?.time;
        return {
            supported: this.isSupported(),
            active: this._active,
            capturedFrameCount: this._frames.length,
            capturedDuration: Number.isFinite(firstCapture) && Number.isFinite(lastCapture)
                ? Math.max(0, (lastCapture - firstCapture) / 1000)
                : 0,
            playbackFrameCount: this._playbackFrames.length,
            pendingCaptureCount: this._pendingCaptures,
            effectiveMaxFrames: this._effectiveMaxFrames,
            lastCaptureError: this._lastCaptureError,
            captureBackend: this.glContext?.readPixels ? 'webgl-readpixels' : 'canvas-2d',
            sourceDuration: this._sourceDuration,
            currentFrameIndex: this._frameCursor,
            width: Number(this._overlayCanvas?.width) || 0,
            height: Number(this._overlayCanvas?.height) || 0,
        };
    }

    dispose() {
        this.resetCapture();
        this._overlayCanvas?.remove?.();
        this._captureCanvas?.remove?.();
        this._overlayCanvas = null;
        this._overlayContext = null;
        this._captureCanvas = null;
        this._captureContext = null;
        this.sourceCanvas = null;
        this.glContext = null;
        this.documentRef = null;
        this._rowSwapBuffer = null;
    }
}
