import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayingStateSystem } from '../src/core/PlayingStateSystem.js';
import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';
import { VIEWPORT_LAYOUTS } from '../src/shared/contracts/ViewportLayoutContract.js';

function createPlayingState(timing) {
    const receivedTimings = [];
    const system = new PlayingStateSystem({
        getEntityManager: () => ({
            renderInterpolatedTransforms() {},
            updateCameras() {},
        }),
        getRenderTiming: () => timing.current,
        getFixedStep: () => 1 / 60,
        getRenderer: () => ({
            cameraRigSystem: {
                setFrameTiming(value) { receivedTimings.push(value); },
            },
        }),
        getVisualsActive: () => true,
        getRuntimeProjectionPort: () => ({
            getMatchRenderProjection: ({ renderAlpha }) => ({ renderAlpha }),
        }),
    });
    return { system, receivedTimings };
}

test('playing renders reuse an instance-owned camera timing record and refresh every field', () => {
    const timing = {
        current: { frameId: 8, rawDt: 0.016, stabilizedDt: 0.016, reset: false, resetReason: '' },
    };
    const first = createPlayingState(timing);
    first.system.render(0.25);
    const timingRecord = first.receivedTimings[0];

    timing.current = {
        frameId: 11,
        rawDt: 0.21,
        stabilizedDt: 0.09,
        reset: true,
        resetReason: 'visibility-resume',
    };
    first.system.render(0.75);

    assert.strictEqual(first.receivedTimings[1], timingRecord, 'one mutable timing record belongs to this PlayingStateSystem');
    assert.deepEqual({ ...timingRecord }, {
        frameId: 11,
        rawDt: 0.21,
        dt: 0.05,
        reset: true,
        reason: 'visibility-resume',
    });

    timing.current = { frameId: 12, rawDt: 0.02, stabilizedDt: 0.02, reset: false, resetReason: '' };
    first.system.render(0.5);
    assert.strictEqual(first.receivedTimings[2], timingRecord);
    assert.deepEqual({ ...timingRecord }, {
        frameId: 12,
        rawDt: 0.02,
        dt: 0.02,
        reset: false,
        reason: '',
    });

    const second = createPlayingState({
        current: { frameId: 3, rawDt: 0.03, stabilizedDt: 0.03, reset: false, resetReason: '' },
    });
    second.system.render(1);
    assert.notStrictEqual(second.receivedTimings[0], timingRecord, 'different playing instances must not alias their timing records');
    assert.equal(timingRecord.frameId, 12, 'rendering another instance must leave this instance state intact');
});

function createViewportHarness(width = 1283, height = 721) {
    const calls = [];
    const pipelineCalls = [];
    const renderer = {
        info: { reset() { calls.push(['resetInfo']); } },
        setSize(...args) { calls.push(['setSize', ...args]); },
        setViewport(...args) { calls.push(['setViewport', ...args]); },
        setScissor(...args) { calls.push(['setScissor', ...args]); },
        setScissorTest(...args) { calls.push(['setScissorTest', ...args]); },
        render(_scene, camera) { calls.push(['render', camera.id]); },
    };
    const pipeline = {
        setSize(...args) { calls.push(['pipelineSize', ...args]); },
        render(_scene, camera) {
            pipelineCalls.push(camera.id);
            return true;
        },
    };
    const viewport = new RenderViewportSystem(renderer, {
        width,
        height,
        postProcessingPipeline: pipeline,
    });
    const cameras = Array.from({ length: 4 }, (_, index) => ({
        id: `P${index + 1}`,
        aspect: 0,
        updateProjectionMatrix() {},
    }));
    return { viewport, cameras, calls, pipelineCalls };
}

function renderedCameraIds(calls) {
    return calls.filter(([kind]) => kind === 'render').map(([, id]) => id);
}

function viewportCalls(calls) {
    return calls.filter(([kind]) => kind === 'setViewport');
}

function scissorCalls(calls) {
    return calls.filter(([kind]) => kind === 'setScissor');
}

test('split viewport layouts reuse per-instance geometry while preserving odd-size panes and rendering paths', () => {
    const first = createViewportHarness();
    const second = createViewportHarness();
    const { viewport, cameras, calls, pipelineCalls } = first;
    const { viewport: otherViewport } = second;

    const fourGrid = viewport._fourGridViewports;
    const threeColumns = viewport._threeColumnViewports;
    const threeRows = viewport._threeRowViewports;
    assert.equal(fourGrid.length, 4);
    assert.equal(threeColumns.length, 3);
    assert.equal(threeRows.length, 3);
    assert.notStrictEqual(fourGrid, otherViewport._fourGridViewports, 'layout storage must be owned by each viewport instance');
    assert.ok(fourGrid.every((pane, index) => pane !== otherViewport._fourGridViewports[index]));
    const fourGridRows = [...fourGrid];
    const columnRows = [...threeColumns];
    const rowRows = [...threeRows];

    const scene = {};
    fourGrid[0].fill(-1);
    viewport.setViewportLayout(VIEWPORT_LAYOUTS.FOUR_GRID, cameras);
    viewport.render(scene, cameras);
    assert.deepEqual(renderedCameraIds(calls), ['P1', 'P2', 'P3', 'P4']);
    assert.deepEqual(viewportCalls(calls).slice(0, 4), [
        ['setViewport', 0, 360, 641, 361],
        ['setViewport', 641, 360, 642, 361],
        ['setViewport', 0, 0, 641, 360],
        ['setViewport', 641, 0, 642, 360],
    ]);
    assert.deepEqual(scissorCalls(calls).slice(0, 4), [
        ['setScissor', 0, 360, 641, 361],
        ['setScissor', 641, 360, 642, 361],
        ['setScissor', 0, 0, 641, 360],
        ['setScissor', 641, 0, 642, 360],
    ]);
    for (let index = 0; index < fourGridRows.length; index += 1) {
        assert.strictEqual(viewport._fourGridViewports[index], fourGridRows[index]);
    }
    assert.deepEqual(fourGrid[0], [0, 360, 641, 361], 'the reusable pane keeps geometry only');
    assert.strictEqual(viewport._fourGridViewports, fourGrid);

    calls.length = 0;
    threeColumns[0].fill(-1);
    viewport.setViewportLayout(VIEWPORT_LAYOUTS.THREE_COLUMNS, cameras);
    viewport.render(scene, cameras);
    assert.deepEqual(renderedCameraIds(calls), ['P1', 'P2', 'P3']);
    assert.deepEqual(viewportCalls(calls).slice(0, 3), [
        ['setViewport', 0, 0, 427, 721],
        ['setViewport', 427, 0, 427, 721],
        ['setViewport', 854, 0, 429, 721],
    ]);
    assert.deepEqual(scissorCalls(calls).slice(0, 3), viewportCalls(calls).slice(0, 3).map(([, ...args]) => ['setScissor', ...args]));
    for (let index = 0; index < columnRows.length; index += 1) {
        assert.strictEqual(viewport._threeColumnViewports[index], columnRows[index]);
    }
    assert.deepEqual(threeColumns[2], [854, 0, 429, 721]);
    assert.strictEqual(viewport._threeColumnViewports, threeColumns);

    calls.length = 0;
    threeRows[0].fill(-1);
    viewport.setViewportLayout(VIEWPORT_LAYOUTS.THREE_ROWS, cameras);
    viewport.render(scene, cameras);
    assert.deepEqual(renderedCameraIds(calls), ['P1', 'P2', 'P3']);
    assert.deepEqual(viewportCalls(calls).slice(0, 3), [
        ['setViewport', 0, 480, 1283, 241],
        ['setViewport', 0, 240, 1283, 240],
        ['setViewport', 0, 0, 1283, 240],
    ]);
    assert.deepEqual(scissorCalls(calls).slice(0, 3), viewportCalls(calls).slice(0, 3).map(([, ...args]) => ['setScissor', ...args]));
    for (let index = 0; index < rowRows.length; index += 1) {
        assert.strictEqual(viewport._threeRowViewports[index], rowRows[index]);
    }
    assert.deepEqual(threeRows[0], [0, 480, 1283, 241]);
    assert.strictEqual(viewport._threeRowViewports, threeRows);

    calls.length = 0;
    viewport.setNetworkMode(true, 0, cameras, 2, VIEWPORT_LAYOUTS.TWO_COLUMNS);
    viewport.render(scene, cameras);
    assert.deepEqual(renderedCameraIds(calls), ['P1', 'P2']);
    assert.deepEqual(viewportCalls(calls).slice(0, 2), [
        ['setViewport', 0, 0, 641, 721],
        ['setViewport', 641, 0, 642, 721],
    ]);
    assert.deepEqual(pipelineCalls, [], 'split and local-network panes keep their existing direct render path');

    calls.length = 0;
    viewport.setNetworkMode(true, 2, cameras, 1);
    viewport.render(scene, cameras);
    assert.deepEqual(pipelineCalls, ['P3'], 'single-seat network rendering retains post-processing');
    assert.deepEqual(renderedCameraIds(calls), []);
    assert.deepEqual(viewportCalls(calls)[0], ['setViewport', 0, 0, 1283, 721]);
});
function reachableCameraIds(root, cameras) {
    const cameraIds = new Set(cameras.map((camera) => [camera, camera.id]));
    const visited = new WeakSet();
    const ids = new Set();
    const visit = (value) => {
        if (!value || (typeof value !== 'object' && typeof value !== 'function') || visited.has(value)) return;
        visited.add(value);
        for (const [camera, id] of cameraIds) {
            if (value === camera) ids.add(id);
        }
        for (const key of Reflect.ownKeys(value)) {
            visit(value[key]);
        }
    };
    visit(root);
    return [...ids].sort();
}

test('viewport layout caches do not retain rendered cameras across layout switch or camera reset', () => {
    const { viewport, cameras } = createViewportHarness();
    const scene = {};
    viewport.setViewportLayout(VIEWPORT_LAYOUTS.FOUR_GRID, cameras);
    viewport.render(scene, cameras);
    viewport.setViewportLayout(VIEWPORT_LAYOUTS.THREE_COLUMNS, cameras);
    viewport.render(scene, cameras);
    assert.deepEqual(reachableCameraIds(viewport, cameras), [], 'changing layouts must not retain cameras from the prior layout');

    const oldCameras = [...cameras];
    cameras.length = 0; // CameraRigSystem.resetCameras() clears the source array this way.
    assert.deepEqual(reachableCameraIds(viewport, oldCameras), [], 'camera reset must leave no stale camera reachable from the viewport');
});
