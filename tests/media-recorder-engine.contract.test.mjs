import assert from 'node:assert/strict';
import test from 'node:test';

import { NativeMediaRecorderEngine } from '../src/core/recording/engines/NativeMediaRecorderEngine.js';

class FakeMediaRecorderWithoutStopEvent {
    constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || 'video/webm';
        this.videoBitsPerSecond = options.videoBitsPerSecond || 1_000_000;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
        this._listeners = new Map();
    }

    addEventListener(type, handler) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
        this._listeners.get(type)?.delete(handler);
    }

    start() {
        this.state = 'recording';
    }

    requestData() {
        const chunk = new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType });
        this.ondataavailable?.({ data: chunk });
    }

    stop() {
        this.state = 'inactive';
        this.requestData();
        // Intentionally no stop event emission to simulate hanging stop callbacks.
    }
}

function createFakeCaptureCanvas() {
    return {
        captureStream() {
            return {
                getVideoTracks() {
                    return [{
                        requestFrame() {},
                        stop() {},
                    }];
                },
            };
        },
    };
}

test('NativeMediaRecorderEngine stop resolves with partial blob when stop event never arrives', async () => {
    const engine = new NativeMediaRecorderEngine({
        globalScope: {
            MediaRecorder: FakeMediaRecorderWithoutStopEvent,
            Blob,
            setTimeout,
            clearTimeout,
        },
        canvas: createFakeCaptureCanvas(),
        mimeType: 'video/webm',
        stopTimeoutMs: 20,
    });

    const initResult = await engine.initialize();
    assert.equal(initResult.ok, true);
    assert.equal(engine.start(32), true);

    const stopResult = await engine.stop();

    assert.equal(stopResult.ok, true);
    assert.equal(stopResult.partial, true);
    assert.equal(stopResult.partialReason, 'stop_timeout');
    assert.equal(stopResult.blob instanceof Blob, true);
    assert.ok(stopResult.blob.size > 0);
});

