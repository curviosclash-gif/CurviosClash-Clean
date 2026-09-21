import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';
import { resolveLocalPlayerIndexes } from '../src/ui/postmatch/PostMatchStandingsBlock.js';

function createCamera(id) {
    return {
        id,
        aspect: 0,
        updateProjectionMatrix() {},
    };
}

test('hybrid LAN rendering uses only the host two local cameras in two columns', () => {
    const rendered = [];
    const renderer = {
        setSize() {},
        setViewport() {},
        setScissor() {},
        setScissorTest() {},
        render(_scene, camera) { rendered.push(camera.id); },
    };
    const cameras = [createCamera('host-1'), createCamera('host-2'), createCamera('guest')];
    const viewport = new RenderViewportSystem(renderer, { width: 1920, height: 1080 });

    viewport.setNetworkMode(true, 0, cameras, 2, 'two_columns');
    viewport.render({}, cameras);

    assert.equal(viewport.getAspect(), 960 / 1080);
    assert.equal(viewport.splitScreen, true);
    assert.deepEqual(rendered, ['host-1', 'host-2']);
});

test('a LAN guest still receives one fullscreen camera', () => {
    const rendered = [];
    const renderer = {
        setSize() {},
        setViewport() {},
        setScissor() {},
        setScissorTest() {},
        render(_scene, camera) { rendered.push(camera.id); },
    };
    const cameras = [createCamera('host-1'), createCamera('host-2'), createCamera('guest')];
    const viewport = new RenderViewportSystem(renderer, { width: 1920, height: 1080 });

    viewport.setNetworkMode(true, 2, cameras, 1, 'single');
    viewport.render({}, cameras);

    assert.equal(viewport.getAspect(), 1920 / 1080);
    assert.equal(viewport.splitScreen, false);
    assert.deepEqual(rendered, ['guest']);
});

test('split-screen render diagnostics aggregate every local camera into one logical frame', () => {
    let resets = 0;
    const renderer = {
        info: {
            autoReset: true,
            render: { calls: 0 },
            reset() {
                resets += 1;
                this.render.calls = 0;
            },
        },
        setSize() {},
        setViewport() {},
        setScissor() {},
        setScissorTest() {},
        render() {
            if (this.info.autoReset) this.info.reset();
            this.info.render.calls += 5;
        },
    };
    const cameras = [createCamera('host-1'), createCamera('host-2')];
    const viewport = new RenderViewportSystem(renderer, { width: 1920, height: 1080 });

    viewport.setNetworkMode(true, 0, cameras, 2, 'two_columns');
    viewport.render({}, cameras);

    assert.equal(renderer.info.autoReset, false);
    assert.equal(resets, 1);
    assert.equal(renderer.info.render.calls, 10);
});

test('post-match standings mark both hybrid host seats as local', () => {
    assert.deepEqual(resolveLocalPlayerIndexes({
        networkEnabled: true,
        localPlayerIndex: 0,
        localHumanCount: 2,
    }), [0, 1]);
    assert.deepEqual(resolveLocalPlayerIndexes({
        networkEnabled: true,
        localPlayerIndex: 2,
        localHumanCount: 1,
    }), [2]);
});
