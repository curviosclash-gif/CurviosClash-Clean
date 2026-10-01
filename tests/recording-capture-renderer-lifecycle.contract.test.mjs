import assert from 'node:assert/strict';
import test from 'node:test';

import { RecordingCapturePipeline } from '../src/core/renderer/RecordingCapturePipeline.js';

class FakeScheduler {
    nowMs = 0;
    nextId = 1;
    timers = new Map();

    now = () => this.nowMs;

    setTimeout = (callback, delayMs) => {
        const id = this.nextId++;
        this.timers.set(id, { callback, at: this.nowMs + delayMs });
        return id;
    };

    clearTimeout = (id) => this.timers.delete(id);

    advance(milliseconds) {
        const target = this.nowMs + milliseconds;
        while (true) {
            const next = [...this.timers.entries()]
                .filter(([, timer]) => timer.at <= target)
                .sort((left, right) => left[1].at - right[1].at)[0];
            if (!next) break;
            const [id, timer] = next;
            this.timers.delete(id);
            this.nowMs = timer.at;
            timer.callback();
        }
        this.nowMs = target;
    }
}

function createRenderer(events, label) {
    return {
        shadowMap: {},
        setPixelRatio() {},
        setClearColor() {},
        setSize() {},
        dispose() { events.push(`${label}:dispose`); },
        forceContextLoss() { events.push(`${label}:forceContextLoss`); },
    };
}

function createPipeline(scheduler = new FakeScheduler()) {
    return { pipeline: new RecordingCapturePipeline({ rendererScheduler: scheduler }), scheduler };
}

test('shorts and cinematic renderers release at the 60-second idle boundary', () => {
    const { pipeline, scheduler } = createPipeline();
    const events = [];
    pipeline._shortsCanvas = {};
    pipeline._shortsRenderer = createRenderer(events, 'shorts');
    pipeline._cinematicCanvas = {};
    pipeline._cinematicRenderer = createRenderer(events, 'cinematic');
    pipeline._cinematicPostProcessingPipeline = { dispose() { events.push('post:dispose'); } };

    pipeline.setActive(true);
    pipeline.setActive(false);
    scheduler.advance(59_999);
    assert.deepEqual(events, []);
    assert.ok(pipeline._shortsRenderer);
    assert.ok(pipeline._cinematicRenderer);

    scheduler.advance(1);
    assert.deepEqual(events, [
        'shorts:dispose', 'shorts:forceContextLoss',
        'post:dispose', 'cinematic:dispose', 'cinematic:forceContextLoss',
    ]);
    assert.equal(pipeline._shortsRenderer, null);
    assert.equal(pipeline._shortsCanvas, null);
    assert.equal(pipeline._cinematicRenderer, null);
    assert.equal(pipeline._cinematicCanvas, null);
    assert.equal(pipeline._cinematicPostProcessingPipeline, null);
    pipeline.dispose();
    assert.equal(events.length, 5, 'released resources are not disposed twice');
});

test('reactivation cancels idle disposal and a later inactive edge gets a fresh 60-second window', () => {
    const { pipeline, scheduler } = createPipeline();
    const events = [];
    pipeline._shortsCanvas = {};
    pipeline._shortsRenderer = createRenderer(events, 'shorts');

    pipeline.setActive(true);
    pipeline.setActive(false);
    scheduler.advance(30_000);
    pipeline.setActive(true);
    scheduler.advance(60_000);
    assert.deepEqual(events, []);
    assert.ok(pipeline._shortsRenderer);

    pipeline.setActive(false);
    scheduler.advance(59_999);
    assert.deepEqual(events, []);
    scheduler.advance(1);
    assert.deepEqual(events, ['shorts:dispose', 'shorts:forceContextLoss']);
});

test('a released shorts renderer can be recreated for a later recording session', () => {
    const { pipeline, scheduler } = createPipeline();
    const events = [];
    pipeline._shortsCanvas = {};
    pipeline._shortsRenderer = createRenderer(events, 'first');
    pipeline.setActive(true);
    pipeline.setActive(false);
    scheduler.advance(60_000);

    assert.equal(pipeline._shortsRenderer, null);
    assert.equal(pipeline._shortsRendererUnavailable, false);
    pipeline.setActive(true);
    const recreated = createRenderer(events, 'recreated');
    recreated.setSize = (width, height) => events.push(`recreated:size:${width}x${height}`);
    pipeline._shortsCanvas = {};
    pipeline._shortsRenderer = recreated;
    assert.equal(pipeline._ensureShortsRenderer(32, 24), recreated);
    assert.ok(events.includes('recreated:size:32x24'));

    pipeline.dispose();
    assert.deepEqual(events, [
        'first:dispose', 'first:forceContextLoss', 'recreated:size:32x24',
        'recreated:dispose', 'recreated:forceContextLoss',
    ]);
});

test('dispose cancels a pending timer and immediately releases each renderer once', () => {
    const { pipeline, scheduler } = createPipeline();
    const events = [];
    pipeline._shortsRenderer = createRenderer(events, 'shorts');
    pipeline._cinematicRenderer = createRenderer(events, 'cinematic');
    pipeline._cinematicPostProcessingPipeline = { dispose() { events.push('post:dispose'); } };
    pipeline.setActive(true);
    pipeline.setActive(false);

    pipeline.dispose();
    scheduler.advance(60_000);
    pipeline.dispose();
    assert.deepEqual(events, [
        'shorts:dispose', 'shorts:forceContextLoss',
        'post:dispose', 'cinematic:dispose', 'cinematic:forceContextLoss',
    ]);
    assert.equal(scheduler.timers.size, 0);
});

test('shorts setSize failure disposes and loses the context before clearing renderer references', () => {
    const { pipeline } = createPipeline();
    const events = [];
    const renderer = createRenderer(events, 'shorts');
    renderer.setSize = () => { throw new Error('size failed'); };
    renderer.dispose = () => {
        events.push(`dispose:${pipeline._shortsRenderer === renderer}`);
    };
    renderer.forceContextLoss = () => {
        events.push(`force:${pipeline._shortsRenderer === renderer}`);
    };
    pipeline._shortsCanvas = {};
    pipeline._shortsRenderer = renderer;

    assert.equal(pipeline._ensureShortsRenderer(32, 32), null);
    assert.deepEqual(events, ['dispose:true', 'force:true']);
    assert.equal(pipeline._shortsRenderer, null);
    assert.equal(pipeline._shortsCanvas, null);
    assert.equal(pipeline._shortsRendererUnavailable, true);
    pipeline.dispose();
    assert.deepEqual(events, ['dispose:true', 'force:true']);
});

test('cinematic setSize failure disposes post processing and loses the context before clearing references', () => {
    const { pipeline } = createPipeline();
    const events = [];
    const renderer = createRenderer(events, 'cinematic');
    renderer.setSize = () => { throw new Error('size failed'); };
    renderer.dispose = () => {
        events.push(`dispose:${pipeline._cinematicRenderer === renderer}`);
    };
    renderer.forceContextLoss = () => {
        events.push(`force:${pipeline._cinematicRenderer === renderer}`);
    };
    pipeline._cinematicCanvas = {};
    pipeline._cinematicRenderer = renderer;
    pipeline._cinematicPostProcessingPipeline = { dispose() { events.push('post:dispose'); } };

    assert.equal(pipeline._ensureCinematicRenderer(32, 32), null);
    assert.deepEqual(events, ['post:dispose', 'dispose:true', 'force:true']);
    assert.equal(pipeline._cinematicRenderer, null);
    assert.equal(pipeline._cinematicCanvas, null);
    assert.equal(pipeline._cinematicPostProcessingPipeline, null);
    assert.equal(pipeline._cinematicRendererUnavailable, true);
    pipeline.dispose();
    assert.deepEqual(events, ['post:dispose', 'dispose:true', 'force:true']);
});
