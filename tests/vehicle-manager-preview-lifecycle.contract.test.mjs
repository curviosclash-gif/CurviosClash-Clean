import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createVehicleManagerPreview3d } from '../src/ui/arcade/vehicle-manager/VehicleManagerPreview3d.js';

function createElement(tagName = 'div') {
    return {
        tagName,
        className: '',
        dataset: {},
        style: {},
        clientWidth: 320,
        clientHeight: 240,
        parentElement: null,
        children: [],
        attributes: {},
        listeners: new Map(),
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            this.children = this.children.filter((entry) => entry !== child);
            child.parentElement = null;
        },
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (this.listeners.get(type) === listener) this.listeners.delete(type);
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
    };
}

function withBrowserGlobals(run) {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    let webglContextRequests = 0;
    const frames = new Map();
    const cancelledFrames = [];
    let nextFrameId = 1;
    const windowListeners = new Map();
    globalThis.document = {
        createElement: (tagName) => createElement(tagName),
        createElementNS: (_namespace, tagName) => {
            const canvas = createElement(tagName);
            canvas.getContext = () => { webglContextRequests += 1; return null; };
            return canvas;
        },
    };
    globalThis.window = {
        devicePixelRatio: 1,
        requestAnimationFrame(callback) {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) { cancelledFrames.push(id); frames.delete(id); },
        addEventListener(type, listener) { windowListeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (windowListeners.get(type) === listener) windowListeners.delete(type);
        },
    };
    try {
        return run({
            webglContextRequests: () => webglContextRequests,
            frames,
            cancelledFrames,
            windowListeners,
        });
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

test('hidden vehicle manager preview defers WebGL renderer construction until activation', () => {
    withBrowserGlobals(({ webglContextRequests, frames, cancelledFrames, windowListeners }) => {
        const mount = createElement();
        let rendererCreations = 0;
        let controlsCreations = 0;
        const vehicleSelections = [];
        const vehicle = new THREE.Group();
        vehicle.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshBasicMaterial()));
        let vehicleTicks = 0;
        vehicle.tick = () => { vehicleTicks += 1; };
        vehicle.dispose = () => {};
        let rendererDisposals = 0;
        let contextLosses = 0;
        let renderCalls = 0;
        let controlDisposals = 0;
        const preview = createVehicleManagerPreview3d({
            mount,
            rendererFactory: () => {
                rendererCreations += 1;
                return {
                    domElement: createElement('canvas'),
                    setPixelRatio() {},
                    setSize() {},
                    render() { renderCalls += 1; },
                    dispose() { rendererDisposals += 1; },
                    forceContextLoss() { contextLosses += 1; },
                };
            },
            controlsFactory: () => {
                controlsCreations += 1;
                return {
                    autoRotate: true,
                    target: { set() {} },
                    addEventListener() {},
                    removeEventListener() {},
                    update() {},
                    dispose() { controlDisposals += 1; },
                };
            },
            vehicleFactory: (vehicleId, color) => {
                vehicleSelections.push([vehicleId, color]);
                return vehicle;
            },
        });

        assert.equal(webglContextRequests(), 0);
        assert.equal(frames.size, 0);
        assert.equal(rendererCreations, 0);
        assert.equal(controlsCreations, 0);
        assert.equal(mount.listeners.size, 0);
        assert.equal(windowListeners.size, 0);

        preview.setVehicle('ship5', '#123abc');
        assert.deepEqual(vehicleSelections, [], 'vehicle updates before activation are deferred');
        preview.setActive(true);
        assert.equal(rendererCreations, 1);
        assert.equal(controlsCreations, 1);
        assert.deepEqual(vehicleSelections, [['ship5', 0x123abc]]);
        assert.equal(frames.size, 1);
        assert.equal(windowListeners.size, 4);

        const firstFrame = frames.entries().next().value;
        frames.delete(firstFrame[0]);
        firstFrame[1](100);
        assert.equal(renderCalls, 1);
        assert.equal(vehicleTicks, 1);
        assert.equal(frames.size, 1);

        const pendingFrameId = frames.keys().next().value;
        preview.setActive(false);
        assert.equal(frames.size, 0);
        assert.ok(cancelledFrames.includes(pendingFrameId), 'hiding cancels the pending animation frame');
        preview.setActive(true);
        assert.equal(rendererCreations, 1, 'showing again reuses the renderer');
        assert.equal(controlsCreations, 1, 'showing again reuses the controls');
        assert.equal(frames.size, 1);

        preview.dispose();
        assert.equal(rendererDisposals, 1);
        assert.equal(contextLosses, 1);
        assert.equal(controlDisposals, 1);
        assert.equal(frames.size, 0);
        assert.equal(mount.listeners.size, 0);
        assert.equal(windowListeners.size, 0);
        preview.setActive(true);
        assert.equal(rendererCreations, 1, 'disposed previews cannot reinitialize');
    });
});

test('disposing a hidden vehicle preview never creates renderer, controls, frame, or global listeners', () => {
    withBrowserGlobals(({ frames, windowListeners }) => {
        const mount = createElement();
        let rendererCreations = 0;
        const preview = createVehicleManagerPreview3d({
            mount,
            rendererFactory() { rendererCreations += 1; throw new Error('must remain unused'); },
        });

        preview.setVehicle('ship5');
        preview.dispose();

        assert.equal(rendererCreations, 0);
        assert.equal(frames.size, 0);
        assert.equal(windowListeners.size, 0);
        assert.equal(mount.listeners.size, 0);
        assert.equal(preview.getStatus(), 'disposed');
    });
});
