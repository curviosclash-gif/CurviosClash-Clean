import assert from 'node:assert/strict';
import test from 'node:test';

import { KillcamPixelReplayBuffer } from '../src/core/recording/KillcamPixelReplayBuffer.js';

function createCanvasFixture() {
    const drawCalls = [];
    const putCalls = [];
    let imageId = 0;
    class FakeCanvas {
        constructor() {
            this.width = 0;
            this.height = 0;
            this.hidden = false;
            this.style = {};
            this.parentElement = null;
            this.nextSibling = null;
            this.context = {
                clearRect() {},
                drawImage: (...args) => drawCalls.push(args),
                getImageData: () => ({ id: ++imageId, data: new Uint8ClampedArray(8 * 4 * 4) }),
                createImageData: () => ({ id: ++imageId, data: new Uint8ClampedArray(8 * 4 * 4) }),
                putImageData: (...args) => putCalls.push(args),
            };
        }

        getContext() {
            return this.context;
        }

        setAttribute() {}

        remove() {}
    }

    const classNames = new Set();
    const container = {
        classList: {
            add: (name) => classNames.add(name),
            remove: (name) => classNames.delete(name),
        },
        insertBefore(node) {
            node.parentElement = this;
        },
        appendChild(node) {
            node.parentElement = this;
        },
    };
    const sourceCanvas = new FakeCanvas();
    sourceCanvas.width = 8;
    sourceCanvas.height = 4;
    sourceCanvas.parentElement = container;
    const documentRef = {
        createElement: () => new FakeCanvas(),
        getElementById: () => container,
    };
    return {
        classNames,
        documentRef,
        drawCalls,
        putCalls,
        sourceCanvas,
    };
}

test('pixel replay stores lossless rendered frames and redraws the selected frame unchanged', async () => {
    const fixture = createCanvasFixture();
    const buffer = new KillcamPixelReplayBuffer({
        sourceCanvas: fixture.sourceCanvas,
        documentRef: fixture.documentRef,
        captureFps: 60,
        captureScale: 1,
    });

    await buffer.captureFrame({ force: true, timestamp: 0 });
    await buffer.captureFrame({ force: true, timestamp: 400 });
    const terminalFrame = await buffer.captureFrame({ force: true, timestamp: 800 });

    assert.equal(buffer.canReplay(), true);
    assert.deepEqual(buffer._frames.map((frame) => frame.imageData.id), [1, 2, 3]);

    const playback = await buffer.beginPlayback({ terminalFrame, sourceWindowSeconds: 2 });
    assert.equal(playback?.frameCount, 3);
    assert.equal(playback?.sourceDuration, 0.8);
    assert.equal(buffer.seekSourceTime(0.4), true);

    const state = buffer.getState();
    assert.equal(state.active, true);
    assert.equal(state.currentFrameIndex, 1);
    assert.equal(state.width, fixture.sourceCanvas.width);
    assert.equal(state.height, fixture.sourceCanvas.height);
    assert.equal(fixture.classNames.has('killcam-pixel-replay-active'), true);
    assert.equal(fixture.putCalls.at(-1)?.[0]?.id, 2);

    buffer.clearPlayback();
    assert.equal(fixture.classNames.has('killcam-pixel-replay-active'), false);
    buffer.dispose();
});

test('pixel replay defaults keep capture bandwidth and memory bounded', async () => {
    const fixture = createCanvasFixture();
    const buffer = new KillcamPixelReplayBuffer({
        sourceCanvas: fixture.sourceCanvas,
        documentRef: fixture.documentRef,
    });

    const frame = await buffer.captureFrame({ force: true, timestamp: 0 });
    const state = buffer.getState();

    assert.equal(frame?.width, 4);
    assert.equal(frame?.height, 2);
    assert.equal(state.captureScale, 0.5);
    assert.equal(state.effectiveMaxFrames, 36);
    assert.equal(state.captureBackend, 'canvas-2d-scaled');

    fixture.sourceCanvas.width = 3840;
    fixture.sourceCanvas.height = 2160;
    const highResolutionFrame = await buffer.captureFrame({ force: true, timestamp: 100 });
    assert.equal(highResolutionFrame?.width, 960);
    assert.equal(highResolutionFrame?.height, 540);
    assert.equal(buffer.getState().captureScale, 0.25);
    buffer.dispose();
});
