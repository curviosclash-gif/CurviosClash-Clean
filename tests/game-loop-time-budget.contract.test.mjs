import assert from 'node:assert/strict';
import test from 'node:test';
import { GameLoop } from '../src/core/GameLoop.js';

test('a steady 22 fps render cadence keeps 60 Hz simulation time', () => {
    const frameIntervalMs = 1000 / 22;
    const updateDeltas = [];
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;

    try {
        const loop = new GameLoop((dt) => updateDeltas.push(dt), () => {});
        loop.running = true;
        loop.lastTime = 0;
        loop._pendingDeltaReset = false;

        // Fill the existing dt smoother, then measure a steady cadence without startup warmup.
        for (let frame = 1; frame <= loop._dtBuf.length; frame += 1) {
            loop._loop(frame * frameIntervalMs);
        }
        loop.accumulator = 0;
        updateDeltas.length = 0;

        const measurementStartMs = loop.lastTime;
        for (let frame = 1; frame <= 220; frame += 1) {
            loop._loop(measurementStartMs + frame * frameIntervalMs);
        }
        loop.running = false;

        assert.ok(
            Math.abs(updateDeltas.length - 600) <= 1,
            `220 frames at 22 fps should produce 600 fixed updates, got ${updateDeltas.length}`
        );
        assert.ok(updateDeltas.every((dt) => dt === loop.fixedStep));
    } finally {
        if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
});
